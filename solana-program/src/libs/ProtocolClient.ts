// src/libs/ProtocolClient.ts
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
  async createCollection(collectionId: string, maxVideos: number, accessThreshold: number) {
    const owner = this.walletManager.getPublicKey();
    const [collectionStatePda] = PublicKey.findProgramAddressSync(
      [SEED_COLLECTION_STATE, owner.toBuffer(), Buffer.from(collectionId)],
      this.program.programId
    );

    // Note: Actual implementation would include instructions to mint the token
    const tx = await this.program.methods
      .createCollection(collectionId, maxVideos, PublicKey.default, new anchor.BN(accessThreshold))
      .accounts({
        owner: owner,
        userAccount: this.getUserAccountPda(owner),
        collectionState: collectionStatePda,
        // ... other accounts
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    return this.walletManager.signTransaction(tx, RiskLevel.HIGH);
  }

  /**
   * Checks USD value of holdings and mints/renews access.
   */
  async mintViewRights(collectionId: string, ownerPubkey: PublicKey) {
    const user = this.walletManager.getPublicKey();
    
    // Derive Collection State
    const [collectionStatePda] = PublicKey.findProgramAddressSync(
        [SEED_COLLECTION_STATE, ownerPubkey.toBuffer(), Buffer.from(collectionId)],
        this.program.programId
    );

    // Fetch collection to get Mint address (Mock)
    // const colAccount = await this.program.account.collectionState.fetch(collectionStatePda);

    const tx = await this.program.methods
      .mintViewRight()
      .accounts({
        user: user,
        collectionState: collectionStatePda,
        // viewRight: derived...
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
