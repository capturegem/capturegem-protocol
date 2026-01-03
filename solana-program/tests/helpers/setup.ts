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
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection"), owner.toBuffer(), Buffer.from(collectionId)],
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

export const getVideoPDA = (collection: PublicKey, videoId: string): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("video"), collection.toBuffer(), Buffer.from(videoId)],
    program.programId
  );
};

export const getModTicketPDA = (targetId: string): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), Buffer.from(targetId)],
    program.programId
  );
};

export const getModeratorStakePDA = (moderator: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("moderator_stake"), moderator.toBuffer()],
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

// Helper to initialize protocol if not already initialized
export async function ensureProtocolInitialized(): Promise<void> {
  const [globalStatePDA] = getGlobalStatePDA();
  const exists = await accountExists(globalStatePDA);
  
  if (!exists) {
    const { SystemProgram } = await import("@solana/web3.js");
    const { INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS } = await import("./constants");
    
    await program.methods
      .initializeProtocol(INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS)
      .accounts({
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
      .accounts({
        authority: userKey.publicKey,
        userAccount: userAccountPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([userKey])
      .rpc();
  }
}
