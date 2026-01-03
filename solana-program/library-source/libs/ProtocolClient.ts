// library-source/libs/ProtocolClient.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { WalletManager, RiskLevel } from "./WalletManager";

// Seeds must match Rust constants
const SEED_COLLECTION_STATE = Buffer.from("collection_state");
const SEED_VIEW_RIGHT = Buffer.from("view_right");

export class ProtocolClient {
  program: anchor.Program;
  walletManager: WalletManager;

  constructor(program: anchor.Program, walletManager: WalletManager) {
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

    // Derive mint PDA (would be created by the instruction)
    // In production, the mint is created via CPI in the instruction

    const tx = await this.program.methods
      .createCollection(
        collectionId, 
        name,
        contentCid,
        new anchor.BN(accessThresholdUsd)
      )
      .accounts({
        owner: owner,
        collection: collectionStatePda,
        oracleFeed: oracleFeed,
        // mint, token_program, system_program, rent are handled by Anchor
      })
      .transaction();

    return this.walletManager.signTransaction(tx, RiskLevel.HIGH);
  }

  /**
   * Checks USD value of holdings and mints/renews access.
   */
  async buyAccessToken(collectionId: string, ownerPubkey: PublicKey) {
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
    // const colAccount = await this.program.account.collectionState.fetch(collectionStatePda);

    const tx = await this.program.methods
      .buyAccessToken()
      .accounts({
        payer: user,
        collection: collectionStatePda,
        buyerTokenAccount: PublicKey.default, // TODO: Derive actual token account
        oracleFeed: PublicKey.default, // TODO: Get from collection state
        viewRights: viewRightsPda,
      })
      .transaction();

    return this.walletManager.signTransaction(tx, RiskLevel.HIGH); // Moving assets is High Risk
  }

  private getUserAccountPda(authority: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_account"), authority.toBuffer()],
      this.program.programId
    );
    return pda;
  }
}
