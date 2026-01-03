// client-library/libs/AccessClient.ts

/**
 * AccessClient - Client library for purchasers to buy access and decrypt CIDs
 * 
 * Handles the complete purchase flow:
 * 1. Purchase access (mints non-transferable NFT)
 * 2. Monitor for CID revelation
 * 3. Decrypt and verify CID
 * 4. Create NFT proof for pinner connections
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { SolanaProgram } from "../../solana-program/target/types/solana_program";
import {
  decryptCID,
  verifyCIDHash,
  hashCID,
  createAccessProofMessage,
} from "./CryptoUtils";

/**
 * Access Escrow account structure (matches Rust program)
 */
export interface AccessEscrow {
  purchaser: PublicKey;
  collection: PublicKey;
  accessNftMint: PublicKey;
  cidHash: Uint8Array;
  amountLocked: BN;
  createdAt: BN;
  isCidRevealed: boolean;
  bump: number;
}

/**
 * CID Reveal account structure (matches Rust program)
 */
export interface CidReveal {
  escrow: PublicKey;
  pinner: PublicKey;
  encryptedCid: Uint8Array;
  revealedAt: BN;
  bump: number;
}

/**
 * Collection Manifest structure (from IPFS)
 */
export interface CollectionManifest {
  collection_id: string;
  version: number;
  videos: Array<{
    title: string;
    cid: string;
    duration: number;
  }>;
}

/**
 * Purchase result containing all relevant information
 */
export interface PurchaseResult {
  accessEscrow: PublicKey;
  accessNftMint: PublicKey;
  transaction: string;
  collectionId: string;
}

/**
 * Revealed CID with verification status
 */
export interface RevealedCID {
  cid: string;
  verified: boolean;
  pinner: PublicKey;
  revealedAt: Date;
}

export class AccessClient {
  constructor(
    private program: Program<SolanaProgram>,
    private connection: Connection,
    private provider: AnchorProvider
  ) {}

  /**
   * Purchase access to a collection
   * Mints a non-transferable Access NFT and creates an AccessEscrow
   * 
   * @param collectionId - The collection to purchase
   * @param collectionPubkey - The collection account public key
   * @param totalAmount - Total collection tokens to purchase
   * @param cidHash - SHA-256 hash of the collection CID
   * @param accessNftMintKeypair - New keypair for the Access NFT mint
   * @returns Purchase result
   */
  async purchaseAccess(
    collectionId: string,
    collectionPubkey: PublicKey,
    totalAmount: BN,
    cidHash: Uint8Array,
    accessNftMintKeypair?: Keypair
  ): Promise<PurchaseResult> {
    const purchaser = this.provider.wallet.publicKey;
    
    // Generate NFT mint keypair if not provided
    const nftMint = accessNftMintKeypair || Keypair.generate();
    
    // Derive PDAs
    const [accessEscrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("access_escrow"),
        purchaser.toBuffer(),
        collectionPubkey.toBuffer(),
      ],
      this.program.programId
    );
    
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );
    
    // Get collection state to find the mint
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );
    
    // Get token accounts
    const purchaserTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      purchaser
    );
    
    const poolTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakingPoolPDA,
      true // Allow PDA owner
    );
    
    const escrowTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      accessEscrowPDA,
      true // Allow PDA owner
    );
    
    const purchaserNftAccount = await getAssociatedTokenAddress(
      nftMint.publicKey,
      purchaser,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Build purchase transaction
    const tx = await this.program.methods
      .purchaseAccess(totalAmount, Array.from(cidHash))
      .accountsPartial({
        purchaser,
        collection: collectionPubkey,
        stakingPool: stakingPoolPDA,
        purchaserTokenAccount,
        poolTokenAccount,
        escrowTokenAccount,
        accessEscrow: accessEscrowPDA,
        accessNftMint: nftMint.publicKey,
        purchaserNftAccount,
        tokenProgram: collectionState.mint, // SPL Token program
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([nftMint])
      .rpc();
    
    console.log(`✅ Access purchased! Transaction: ${tx}`);
    console.log(`📍 Access Escrow: ${accessEscrowPDA.toBase58()}`);
    console.log(`🎫 Access NFT Mint: ${nftMint.publicKey.toBase58()}`);
    
    return {
      accessEscrow: accessEscrowPDA,
      accessNftMint: nftMint.publicKey,
      transaction: tx,
      collectionId,
    };
  }

  /**
   * Wait for a pinner to reveal the CID
   * Polls the blockchain for CidReveal accounts
   * 
   * @param accessEscrowPubkey - The AccessEscrow PDA
   * @param timeoutMs - Maximum time to wait (default: 5 minutes)
   * @param pollIntervalMs - How often to check (default: 2 seconds)
   * @returns CidReveal account data
   */
  async waitForCIDReveal(
    accessEscrowPubkey: PublicKey,
    timeoutMs: number = 300000, // 5 minutes
    pollIntervalMs: number = 2000 // 2 seconds
  ): Promise<CidReveal> {
    const startTime = Date.now();
    
    console.log("⏳ Waiting for pinner to reveal CID...");
    
    while (Date.now() - startTime < timeoutMs) {
      // Check if escrow has been marked as revealed
      const escrow = await this.program.account.accessEscrow.fetch(
        accessEscrowPubkey
      );
      
      if (escrow.isCidRevealed) {
        // Find the CidReveal account
        // We need to scan for it since we don't know which pinner revealed it
        const cidReveals = await this.findCIDRevealsForEscrow(accessEscrowPubkey);
        
        if (cidReveals.length > 0) {
          console.log(`✅ CID revealed by pinner: ${cidReveals[0].pinner.toBase58()}`);
          return cidReveals[0];
        }
      }
      
      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error("Timeout waiting for CID revelation");
  }

  /**
   * Find all CidReveal accounts for a given AccessEscrow
   * 
   * @param accessEscrowPubkey - The AccessEscrow PDA
   * @returns Array of CidReveal accounts
   */
  async findCIDRevealsForEscrow(
    accessEscrowPubkey: PublicKey
  ): Promise<CidReveal[]> {
    const reveals = await this.program.account.cidReveal.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: accessEscrowPubkey.toBase58(),
        },
      },
    ]);
    
    return reveals.map((r) => r.account as CidReveal);
  }

  /**
   * Decrypt and verify a revealed CID
   * 
   * @param cidReveal - The CidReveal account
   * @param accessEscrow - The AccessEscrow account
   * @param purchaserKeypair - Purchaser's keypair for decryption
   * @returns Revealed CID with verification status
   */
  decryptAndVerifyCID(
    cidReveal: CidReveal,
    accessEscrow: AccessEscrow,
    purchaserKeypair: Keypair
  ): RevealedCID {
    // Decrypt the CID
    const decryptedCID = decryptCID(
      cidReveal.encryptedCid,
      cidReveal.pinner,
      purchaserKeypair
    );
    
    // Verify the hash matches
    const verified = verifyCIDHash(decryptedCID, accessEscrow.cidHash);
    
    if (!verified) {
      console.warn("⚠️  CID hash mismatch! Pinner may have sent incorrect CID.");
    } else {
      console.log("✅ CID verified! Hash matches on-chain commitment.");
    }
    
    return {
      cid: decryptedCID,
      verified,
      pinner: cidReveal.pinner,
      revealedAt: new Date(cidReveal.revealedAt.toNumber() * 1000),
    };
  }

  /**
   * Complete purchase flow: buy access, wait for reveal, decrypt CID
   * 
   * @param collectionId - Collection to purchase
   * @param collectionPubkey - Collection account
   * @param totalAmount - Amount to purchase
   * @param cidHash - Expected CID hash
   * @param purchaserKeypair - Purchaser's keypair
   * @returns Revealed and verified CID
   */
  async purchaseAndRevealCID(
    collectionId: string,
    collectionPubkey: PublicKey,
    totalAmount: BN,
    cidHash: Uint8Array,
    purchaserKeypair: Keypair
  ): Promise<{
    purchase: PurchaseResult;
    revealed: RevealedCID;
  }> {
    // Step 1: Purchase access
    console.log("1️⃣  Purchasing access...");
    const purchase = await this.purchaseAccess(
      collectionId,
      collectionPubkey,
      totalAmount,
      cidHash
    );
    
    // Step 2: Wait for CID revelation
    console.log("2️⃣  Waiting for pinner to reveal CID...");
    const cidReveal = await this.waitForCIDReveal(purchase.accessEscrow);
    
    // Step 3: Fetch escrow data
    const accessEscrowAccount = await this.program.account.accessEscrow.fetch(
      purchase.accessEscrow
    );
    
    // Convert to AccessEscrow interface format
    const accessEscrow: AccessEscrow = {
      purchaser: accessEscrowAccount.purchaser,
      collection: accessEscrowAccount.collection,
      accessNftMint: accessEscrowAccount.accessNftMint,
      cidHash: new Uint8Array(accessEscrowAccount.cidHash),
      amountLocked: accessEscrowAccount.amountLocked,
      createdAt: accessEscrowAccount.createdAt,
      isCidRevealed: accessEscrowAccount.isCidRevealed,
      bump: accessEscrowAccount.bump,
    };
    
    // Step 4: Decrypt and verify
    console.log("3️⃣  Decrypting and verifying CID...");
    const revealed = this.decryptAndVerifyCID(
      cidReveal,
      accessEscrow,
      purchaserKeypair
    );
    
    if (!revealed.verified) {
      throw new Error("CID verification failed! Hash mismatch.");
    }
    
    console.log("4️⃣  ✅ Purchase complete! CID:", revealed.cid);
    
    return {
      purchase,
      revealed,
    };
  }

  /**
   * Create an NFT access proof message for pinner verification
   * Used when connecting to IPFS peers
   * 
   * @param purchaserKeypair - Purchaser's keypair
   * @param collectionId - Collection being accessed
   * @param nftMintAddress - Access NFT mint address
   * @returns Signed proof message
   */
  createNFTAccessProof(
    purchaserKeypair: Keypair,
    collectionId: string,
    nftMintAddress: PublicKey
  ) {
    return createAccessProofMessage(purchaserKeypair, collectionId, nftMintAddress);
  }

  /**
   * Fetch collection manifest from IPFS
   * 
   * @param collectionCID - The collection manifest CID
   * @param ipfsGateway - IPFS gateway URL (default: ipfs.io)
   * @returns Collection manifest
   */
  async fetchCollectionManifest(
    collectionCID: string,
    ipfsGateway: string = "https://ipfs.io/ipfs/"
  ): Promise<CollectionManifest> {
    const url = `${ipfsGateway}${collectionCID}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.statusText}`);
    }
    
    const manifest = await response.json() as CollectionManifest;
    
    console.log(`📦 Collection manifest loaded: ${manifest.videos.length} videos`);
    
    return manifest;
  }
}

