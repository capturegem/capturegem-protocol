import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SolanaProgram } from "../../target/types/solana_program";

// Configure the client to use the local cluster
export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export const program = anchor.workspace.SolanaProgram as Program<SolanaProgram>;

// Test accounts - exported for use across test files
export const admin = Keypair.generate();
export const user = Keypair.generate();
export const pinner = Keypair.generate();
export const performer = Keypair.generate();
export const moderator = Keypair.generate();
export const treasury = Keypair.generate();
export const capgmMint = Keypair.generate();
export const oracleFeed = Keypair.generate();

// Setup: Airdrop SOL to test accounts
export async function setupAccounts(): Promise<void> {
  const airdropAmount = 10 * LAMPORTS_PER_SOL;
  await Promise.all([
    provider.connection.requestAirdrop(admin.publicKey, airdropAmount),
    provider.connection.requestAirdrop(user.publicKey, airdropAmount),
    provider.connection.requestAirdrop(pinner.publicKey, airdropAmount),
    provider.connection.requestAirdrop(performer.publicKey, airdropAmount),
    provider.connection.requestAirdrop(moderator.publicKey, airdropAmount),
    provider.connection.requestAirdrop(treasury.publicKey, airdropAmount),
  ]);

  // Wait for confirmations
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// PDA derivation helpers
export const getGlobalStatePDA = (): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    program.programId
  );
};

export const getUserAccountPDA = (authority: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_account"), authority.toBuffer()],
    program.programId
  );
};

export const getCollectionPDA = (owner: PublicKey, collectionId: string): [PublicKey, number] => {
  // Ensure collectionId doesn't exceed 32 bytes for PDA seed
  const collectionIdBuffer = Buffer.from(collectionId);
  const truncatedId = collectionIdBuffer.length > 32 
    ? collectionIdBuffer.slice(0, 32) 
    : collectionIdBuffer;
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection"), owner.toBuffer(), truncatedId],
    program.programId
  );
};

export const getMintPDA = (collection: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), collection.toBuffer()],
    program.programId
  );
};

export const getViewRightsPDA = (payer: PublicKey, collection: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("view_right"), payer.toBuffer(), collection.toBuffer()],
    program.programId
  );
};

export const getPinnerStatePDA = (pinner: PublicKey, collection: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("host_bond"), pinner.toBuffer(), collection.toBuffer()],
    program.programId
  );
};

export const getPerformerEscrowPDA = (collection: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("performer_escrow"), collection.toBuffer()],
    program.programId
  );
};

export const getModTicketPDA = (targetId: string): [PublicKey, number] => {
  // Ensure targetId doesn't exceed 32 bytes for PDA seed
  const targetIdBuffer = Buffer.from(targetId);
  const truncatedId = targetIdBuffer.length > 32 
    ? targetIdBuffer.slice(0, 32) 
    : targetIdBuffer;
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), truncatedId],
    program.programId
  );
};

export const getModeratorStakePDA = (moderator: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("moderator_stake"), moderator.toBuffer()],
    program.programId
  );
};

export const getAccessEscrowPDA = (purchaser: PublicKey, collection: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("access_escrow"), purchaser.toBuffer(), collection.toBuffer()],
    program.programId
  );
};

export const getPeerTrustStatePDA = (peerWallet: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("peer_trust"), peerWallet.toBuffer()],
    program.programId
  );
};

// Helper to check if an account exists
export async function accountExists(accountPubkey: PublicKey): Promise<boolean> {
  try {
    const accountInfo = await provider.connection.getAccountInfo(accountPubkey);
    return accountInfo !== null;
  } catch {
    return false;
  }
}

// Helper to check if a mint account exists and is valid
export async function mintExistsAndValid(mintPubkey: PublicKey): Promise<boolean> {
  try {
    const accountInfo = await provider.connection.getAccountInfo(mintPubkey);
    if (!accountInfo || accountInfo.data.length === 0) {
      return false;
    }
    // Try to parse as mint - if it fails, the account is invalid
    const { getMint } = await import("@solana/spl-token");
    await getMint(provider.connection, mintPubkey);
    return true;
  } catch {
    return false;
  }
}

// Helper to initialize protocol if not already initialized
export async function ensureProtocolInitialized(): Promise<void> {
  const [globalStatePDA] = getGlobalStatePDA();
  const exists = await accountExists(globalStatePDA);
  
  if (!exists) {
    const { SystemProgram } = await import("@solana/web3.js");
    const { INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS } = await import("./constants");
    
    await program.methods
      .initializeProtocol(INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS)
      .accountsPartial({
        admin: admin.publicKey,
        globalState: globalStatePDA,
        treasury: treasury.publicKey,
        capgmMint: capgmMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  }
}

// Helper to initialize user account if not already initialized
export async function ensureUserAccountInitialized(userKey: Keypair): Promise<void> {
  const [userAccountPDA] = getUserAccountPDA(userKey.publicKey);
  const exists = await accountExists(userAccountPDA);
  
  if (!exists) {
    const { SystemProgram } = await import("@solana/web3.js");
    const { IPNS_KEY } = await import("./constants");
    
    await program.methods
      .initializeUserAccount(IPNS_KEY)
      .accountsPartial({
        authority: userKey.publicKey,
        userAccount: userAccountPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([userKey])
      .rpc();
  }
}

// Helper to ensure collection exists, handling invalid mint accounts
export async function ensureCollectionExists(
  owner: PublicKey,
  collectionId: string,
  collectionName: string,
  contentCid: string,
  accessThresholdUsd: anchor.BN,
): Promise<PublicKey> {
  const [collectionPDA] = getCollectionPDA(owner, collectionId);
  const [mintPDA] = getMintPDA(collectionPDA);
  
  // Check if collection exists
  const collectionExists = await accountExists(collectionPDA);
  if (collectionExists) {
    return collectionPDA;
  }
  
  // Check if mint exists and is valid
  const mintValid = await mintExistsAndValid(mintPDA);
  if (mintValid) {
    // Mint exists and is valid, but collection doesn't - this shouldn't happen
    // Try to create collection anyway - init_if_needed should handle it
  } else if (await accountExists(mintPDA)) {
    // Mint exists but is invalid - we need to close it first
    // This is complex, so for now we'll just try to create the collection
    // and let init_if_needed handle it (it should fail gracefully)
  }
  
  // Create collection
  const { SystemProgram, SYSVAR_RENT_PUBKEY } = await import("@solana/web3.js");
  const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
  
  try {
    await program.methods
      .createCollection(
        collectionId,
        collectionName,
        contentCid,
        accessThresholdUsd
      )
      .accountsPartial({
        owner: owner,
        collection: collectionPDA,
        oracleFeed: oracleFeed.publicKey,
        mint: mintPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  } catch (err: any) {
    // If it fails due to invalid mint, we might need to handle it differently
    // For now, just throw the error
    throw err;
  }
  
  return collectionPDA;
}

// Helper to airdrop and wait for confirmation
export async function airdropAndConfirm(publicKey: PublicKey, amount: number = 2 * 1e9): Promise<void> {
  // Check if already has sufficient balance
  let currentBalance = await provider.connection.getBalance(publicKey);
  if (currentBalance >= amount) {
    return; // Already has enough
  }
  
  // Request airdrop
  let sig: string;
  try {
    sig = await provider.connection.requestAirdrop(publicKey, amount);
  } catch (e: unknown) {
    // If airdrop request fails, wait and retry
    await new Promise(resolve => setTimeout(resolve, 1000));
    sig = await provider.connection.requestAirdrop(publicKey, amount);
  }
  
  // Get latest blockhash for confirmation
  const latestBlockhash = await provider.connection.getLatestBlockhash('confirmed');
  
  // Wait for confirmation - poll both signature status and balance
  let balance = 0;
  let confirmed = false;
  
  for (let i = 0; i < 60; i++) {
    // Check balance first (faster and more reliable)
    balance = await provider.connection.getBalance(publicKey);
    if (balance >= amount) {
      // Balance is sufficient, verify signature status
      try {
        const status = await provider.connection.getSignatureStatus(sig);
        if (status?.value?.confirmationStatus === 'confirmed' || 
            status?.value?.confirmationStatus === 'finalized' ||
            status === null) { // null means finalized and removed from recent
          confirmed = true;
          break;
        }
      } catch (e) {
        // If we have balance, that's good enough
        if (balance >= amount) {
          confirmed = true;
          break;
        }
      }
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  
  // If still not confirmed, try confirming explicitly
  if (!confirmed || balance < amount) {
    try {
      await provider.connection.confirmTransaction({
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed');
      await new Promise(resolve => setTimeout(resolve, 1000));
      balance = await provider.connection.getBalance(publicKey);
    } catch (e) {
      // Continue to check balance
    }
  }
  
  // Final check - if still 0, try one more airdrop
  balance = await provider.connection.getBalance(publicKey);
  if (balance < amount) {
    // Last resort: try one more airdrop
    try {
      const sig2 = await provider.connection.requestAirdrop(publicKey, amount);
      const latestBlockhash2 = await provider.connection.getLatestBlockhash('confirmed');
      
      // Wait longer for second attempt
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        balance = await provider.connection.getBalance(publicKey);
        if (balance >= amount) {
          break;
        }
      }
      
      // Try to confirm explicitly
      if (balance < amount) {
        await provider.connection.confirmTransaction({
          signature: sig2,
          blockhash: latestBlockhash2.blockhash,
          lastValidBlockHeight: latestBlockhash2.lastValidBlockHeight
        }, 'confirmed');
        await new Promise(resolve => setTimeout(resolve, 2000));
        balance = await provider.connection.getBalance(publicKey);
      }
    } catch (e) {
      // Ignore errors, check balance one more time
      balance = await provider.connection.getBalance(publicKey);
    }
    
    if (balance < amount) {
      // One final check after longer wait
      await new Promise(resolve => setTimeout(resolve, 3000));
      balance = await provider.connection.getBalance(publicKey);
      if (balance < amount) {
        throw new Error(`Failed to airdrop ${amount} lamports to ${publicKey.toString()} - balance is ${balance} after all retries (need at least ${amount})`);
      }
    }
  }
  
  // Extra safety: wait a bit more to ensure transaction can use the funds
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Final verification
  const finalCheck = await provider.connection.getBalance(publicKey);
  if (finalCheck < amount) {
    throw new Error(`Airdrop verification failed for ${publicKey.toString()} - balance is ${finalCheck} (need at least ${amount})`);
  }
}
