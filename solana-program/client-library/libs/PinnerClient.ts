// client-library/libs/PinnerClient.ts

/**
 * PinnerClient - Client library for pinners to monitor purchases and reveal CIDs
 * 
 * Handles the pinner's workflow:
 * 1. Monitor for new AccessEscrow creations
 * 2. Encrypt CID with purchaser's public key
 * 3. Submit reveal_cid transaction
 * 4. Verify NFT ownership before serving content
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { SolanaProgram } from "../../target/types/solana_program";
import {
  encryptCID,
  verifyAccessProofMessage,
  isProofMessageFresh,
  generateEncryptionKeypair,
} from "./CryptoUtils";

/**
 * New purchase notification from monitoring
 */
export interface PurchaseNotification {
  accessEscrow: PublicKey;
  purchaser: PublicKey;
  collection: PublicKey;
  collectionId: string;
  cidHash: Uint8Array;
  createdAt: Date;
  isCidRevealed: boolean;
}

/**
 * NFT verification result
 */
export interface NFTVerificationResult {
  valid: boolean;
  reason?: string;
  cached: boolean;
}

/**
 * Access proof message structure
 */
export interface AccessProofMessage {
  wallet_address: string;
  collection_id: string;
  access_nft_mint: string;
  timestamp: number;
  signature: string;
}

export class PinnerClient {
  // Cache for NFT verifications to reduce RPC load
  private nftVerificationCache: Map<string, { valid: boolean; expiresAt: number }> =
    new Map();
  private cacheExpirySeconds = 30;

  constructor(
    private program: Program<SolanaProgram>,
    private connection: Connection,
    private provider: AnchorProvider
  ) {}

  /**
   * Monitor for new AccessEscrow creations that haven't been revealed yet
   * 
   * @param collectionPubkey - Optional: filter by specific collection
   * @param onNewPurchase - Callback when a new purchase is detected
   */
  async monitorNewPurchases(
    onNewPurchase: (purchase: PurchaseNotification) => void,
    collectionPubkey?: PublicKey
  ): Promise<void> {
    console.log("🔍 Monitoring for new purchases...");
    
    // Get all AccessEscrow accounts that haven't been revealed
    const filters: any[] = [];
    
    if (collectionPubkey) {
      filters.push({
        memcmp: {
          offset: 8 + 32, // Skip discriminator + purchaser
          bytes: collectionPubkey.toBase58(),
        },
      });
    }
    
    // Filter for unrevealed escrows (is_cid_revealed = false)
    filters.push({
      memcmp: {
        offset: 8 + 32 + 32 + 32 + 32 + 8 + 8, // Skip to is_cid_revealed field
        bytes: "1", // false = 0, true = 1
      },
    });
    
    const escrows = await this.program.account.accessEscrow.all(filters);
    
    for (const escrow of escrows) {
      const account = escrow.account as any;
      
      // Get collection state for collection_id
      const collectionState = await this.program.account.collectionState.fetch(
        account.collection
      );
      
      const notification: PurchaseNotification = {
        accessEscrow: escrow.publicKey,
        purchaser: account.purchaser,
        collection: account.collection,
        collectionId: collectionState.collectionId,
        cidHash: new Uint8Array(account.cidHash),
        createdAt: new Date(account.createdAt.toNumber() * 1000),
        isCidRevealed: account.isCidRevealed,
      };
      
      onNewPurchase(notification);
    }
  }

  /**
   * Reveal CID to a purchaser by encrypting it with their public key
   * 
   * @param accessEscrowPubkey - The AccessEscrow to reveal CID for
   * @param collectionCID - The actual collection CID to reveal
   * @param pinnerKeypair - Pinner's keypair (will be used as signer)
   * @param encryptionKeypair - Optional: separate keypair for encryption
   * @returns Transaction signature
   */
  async revealCID(
    accessEscrowPubkey: PublicKey,
    collectionCID: string,
    pinnerKeypair: Keypair,
    encryptionKeypair?: { publicKey: Uint8Array; secretKey: Uint8Array }
  ): Promise<string> {
    // Fetch AccessEscrow to get purchaser's public key
    const accessEscrow = await this.program.account.accessEscrow.fetch(
      accessEscrowPubkey
    );
    
    // Check if already revealed
    if (accessEscrow.isCidRevealed) {
      throw new Error("CID already revealed for this purchase");
    }
    
    // Fetch collection state
    const collectionState = await this.program.account.collectionState.fetch(
      accessEscrow.collection
    );
    
    // Use encryption keypair or generate ephemeral one
    const encKeys = encryptionKeypair || generateEncryptionKeypair();
    
    // Encrypt the CID with purchaser's public key
    console.log(`🔐 Encrypting CID for purchaser: ${accessEscrow.purchaser.toBase58()}`);
    const encryptedCID = encryptCID(
      collectionCID,
      accessEscrow.purchaser,
      encKeys.secretKey
    );
    
    console.log(`📦 Encrypted CID length: ${encryptedCID.length} bytes`);
    
    // Derive CidReveal PDA
    const [cidRevealPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("cid_reveal"),
        accessEscrowPubkey.toBuffer(),
        pinnerKeypair.publicKey.toBuffer(),
      ],
      this.program.programId
    );
    
    // Submit reveal_cid transaction
    const tx = await this.program.methods
      .revealCid(Buffer.from(encryptedCID))
      .accounts({
        pinner: pinnerKeypair.publicKey,
        collection: accessEscrow.collection,
        accessEscrow: accessEscrowPubkey,
        cidReveal: cidRevealPDA,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([pinnerKeypair])
      .rpc();
    
    console.log(`✅ CID revealed! Transaction: ${tx}`);
    console.log(`📍 CidReveal PDA: ${cidRevealPDA.toBase58()}`);
    
    return tx;
  }

  /**
   * Verify that a purchaser owns the required Access NFT
   * Uses on-chain RPC query with caching
   * 
   * @param proofMessage - The access proof message from purchaser
   * @param collectionId - Expected collection ID
   * @returns Verification result
   */
  async verifyNFTOwnership(
    proofMessage: AccessProofMessage,
    collectionId: string
  ): Promise<NFTVerificationResult> {
    // Check cache first
    const cacheKey = `${proofMessage.wallet_address}:${proofMessage.access_nft_mint}`;
    const cached = this.nftVerificationCache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      return {
        valid: cached.valid,
        cached: true,
      };
    }
    
    // 1. Verify signature
    const signatureValid = verifyAccessProofMessage(proofMessage);
    if (!signatureValid) {
      return {
        valid: false,
        reason: "Invalid signature",
        cached: false,
      };
    }
    
    // 2. Check timestamp freshness (prevent replay attacks)
    if (!isProofMessageFresh(proofMessage.timestamp, 300)) {
      return {
        valid: false,
        reason: "Timestamp too old (> 5 minutes)",
        cached: false,
      };
    }
    
    // 3. Verify collection ID matches
    if (proofMessage.collection_id !== collectionId) {
      return {
        valid: false,
        reason: "Collection ID mismatch",
        cached: false,
      };
    }
    
    // 4. Check NFT ownership on-chain
    try {
      const purchaserPubkey = new PublicKey(proofMessage.wallet_address);
      const nftMintPubkey = new PublicKey(proofMessage.access_nft_mint);
      
      // Get token accounts owned by purchaser for this NFT mint
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        purchaserPubkey,
        {
          mint: nftMintPubkey,
          programId: TOKEN_2022_PROGRAM_ID,
        }
      );
      
      if (tokenAccounts.value.length === 0) {
        return {
          valid: false,
          reason: "Purchaser does not own the Access NFT",
          cached: false,
        };
      }
      
      // Verify they own exactly 1 token (NFT has supply of 1)
      const account = await getAccount(
        this.connection,
        tokenAccounts.value[0].pubkey,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      
      if (account.amount !== 1n) {
        return {
          valid: false,
          reason: `Invalid token amount: ${account.amount} (expected 1)`,
          cached: false,
        };
      }
      
      // All checks passed - cache the result
      this.nftVerificationCache.set(cacheKey, {
        valid: true,
        expiresAt: Date.now() + this.cacheExpirySeconds * 1000,
      });
      
      return {
        valid: true,
        cached: false,
      };
    } catch (error) {
      console.error("NFT verification error:", error);
      return {
        valid: false,
        reason: `RPC error: ${error}`,
        cached: false,
      };
    }
  }

  /**
   * Batch verify multiple access proof messages
   * Useful for pinners handling many simultaneous connections
   * 
   * @param proofMessages - Array of proof messages to verify
   * @param collectionId - Expected collection ID
   * @returns Array of verification results
   */
  async batchVerifyNFTOwnership(
    proofMessages: AccessProofMessage[],
    collectionId: string
  ): Promise<NFTVerificationResult[]> {
    // Verify in parallel for better performance
    return Promise.all(
      proofMessages.map((proof) => this.verifyNFTOwnership(proof, collectionId))
    );
  }

  /**
   * Clear the NFT verification cache
   * Call this periodically or when cache gets too large
   */
  clearCache(): void {
    this.nftVerificationCache.clear();
    console.log("🧹 NFT verification cache cleared");
  }

  /**
   * Set cache expiry time
   * 
   * @param seconds - Cache expiry in seconds (default: 30)
   */
  setCacheExpiry(seconds: number): void {
    this.cacheExpirySeconds = seconds;
  }

  /**
   * Monitor blockchain for AccessEscrow creations in real-time using websocket
   * 
   * @param onNewPurchase - Callback when new purchase detected
   * @param collectionPubkey - Optional: filter by collection
   */
  async subscribeToNewPurchases(
    onNewPurchase: (purchase: PurchaseNotification) => void,
    collectionPubkey?: PublicKey
  ): Promise<number> {
    console.log("📡 Subscribing to new purchases (websocket)...");
    
    // Subscribe to account changes for AccessEscrow accounts
    // Note: This requires knowing the program ID and filtering
    
    const subscriptionId = this.connection.onProgramAccountChange(
      this.program.programId,
      async (accountInfo, context) => {
        try {
          // Decode the account
          const account = this.program.coder.accounts.decode(
            "AccessEscrow",
            accountInfo.accountInfo.data
          );
          
          // Filter by collection if specified
          if (collectionPubkey && !account.collection.equals(collectionPubkey)) {
            return;
          }
          
          // Only process unrevealed escrows
          if (account.isCidRevealed) {
            return;
          }
          
          // Get collection state
          const collectionState = await this.program.account.collectionState.fetch(
            account.collection
          );
          
          const notification: PurchaseNotification = {
            accessEscrow: context.accountId,
            purchaser: account.purchaser,
            collection: account.collection,
            collectionId: collectionState.collectionId,
            cidHash: new Uint8Array(account.cidHash),
            createdAt: new Date(account.createdAt.toNumber() * 1000),
            isCidRevealed: account.isCidRevealed,
          };
          
          onNewPurchase(notification);
        } catch (error) {
          console.error("Error processing account change:", error);
        }
      },
      "confirmed"
    );
    
    console.log(`✅ Subscribed with ID: ${subscriptionId}`);
    
    return subscriptionId;
  }

  /**
   * Unsubscribe from new purchase notifications
   * 
   * @param subscriptionId - The subscription ID to unsubscribe
   */
  async unsubscribeFromNewPurchases(subscriptionId: number): Promise<void> {
    await this.connection.removeProgramAccountChangeListener(subscriptionId);
    console.log(`❌ Unsubscribed from ID: ${subscriptionId}`);
  }
}

