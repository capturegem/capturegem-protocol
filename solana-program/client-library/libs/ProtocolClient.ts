// client-library/libs/ProtocolClient.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { WalletManager, RiskLevel } from "./WalletManager";
import { SolanaProgram } from "../../target/types/solana_program";

// Seeds must match Rust constants
const SEED_COLLECTION_STATE = Buffer.from("collection_state");
const SEED_VIEW_RIGHT = Buffer.from("view_right");

export class ProtocolClient {
  program: anchor.Program<SolanaProgram>;
  walletManager: WalletManager;

  constructor(program: anchor.Program<SolanaProgram>, walletManager: WalletManager) {
    this.program = program;
    this.walletManager = walletManager;
  }

  /**
   * Creates a new content collection and mints the Token-2022 asset.
   */
  async createCollection(
    collectionId: string, 
    name: string,
    contentCid: string,
    accessThresholdUsd: number,
    oracleFeed: PublicKey
  ) {
    const owner = this.walletManager.getPublicKey();
    const [collectionStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection"), owner.toBuffer(), Buffer.from(collectionId)],
      this.program.programId
    );

    // Hash the CID for storage
    const { hashCID } = await import("./CryptoUtils");
    const cidHash = Array.from(hashCID(contentCid));

    // Derive mint PDA (would be created by the instruction)
    // In production, the mint is created via CPI in the instruction

    const tx = await this.program.methods
      .createCollection(
        collectionId, 
        name,
        cidHash,
        new anchor.BN(accessThresholdUsd)
      )
      .accounts({
        owner: owner,
        oracleFeed: oracleFeed,
        // collection PDA is auto-resolved by Anchor
        // mint, token_program, system_program, rent are handled by Anchor
      })
      .transaction();

    return this.walletManager.signTransaction(tx, RiskLevel.HIGH);
  }

  /**
   * Checks USD value of holdings and mints/renews access.
   * Note: This method may need to be updated to match actual program instructions.
   */
  async buyAccessToken(collectionId: string, ownerPubkey: PublicKey): Promise<string> {
    const user = this.walletManager.getPublicKey();
    
    // Derive Collection State
    const [collectionStatePda] = PublicKey.findProgramAddressSync(
        [SEED_COLLECTION_STATE, ownerPubkey.toBuffer(), Buffer.from(collectionId)],
        this.program.programId
    );

    // Derive View Rights PDA
    const [viewRightsPda] = PublicKey.findProgramAddressSync(
        [SEED_VIEW_RIGHT, user.toBuffer(), collectionStatePda.toBuffer()],
        this.program.programId
    );

    // Fetch collection to get Mint address and Oracle feed
    const colAccount = await this.program.account.collectionState.fetch(collectionStatePda);

    // Derive buyer's token account
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const buyerTokenAccount = await getAssociatedTokenAddress(
      colAccount.mint,
      user
    );

    // TODO: This instruction may not exist in the current program
    // Use purchaseAccess from AccessClient instead
    throw new Error("buyAccessToken is deprecated. Use AccessClient.purchaseAccess() instead");
  }

  private getUserAccountPda(authority: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_account"), authority.toBuffer()],
      this.program.programId
    );
    return pda;
  }
}
