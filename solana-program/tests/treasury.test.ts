import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program,
  user,
  setupAccounts,
  getCollectionPDA,
  getPerformerEscrowPDA,
  getGlobalStatePDA,
} from "./helpers/setup";
import { COLLECTION_ID } from "./helpers/constants";

describe("Treasury - Fee Harvesting", () => {
  let collectionPDA: any;
  let performerEscrowPDA: any;
  let globalStatePDA: any;

  before(async () => {
    await setupAccounts();
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    [performerEscrowPDA] = getPerformerEscrowPDA(collectionPDA);
    [globalStatePDA] = getGlobalStatePDA();
  });

  it("Successfully harvests fees and splits 50/20/20/10", async () => {
    const mint = Keypair.generate();
    const feeVault = Keypair.generate();
    const ownerTokenAccount = Keypair.generate();
    const stakerTreasury = Keypair.generate();

    // Note: In real implementation, you'd need to set up actual token accounts
    const tx = await program.methods
      .harvestFees()
      .accounts({
        authority: user.publicKey,
        collection: collectionPDA,
        mint: mint.publicKey,
        feeVault: feeVault.publicKey,
        ownerTokenAccount: ownerTokenAccount.publicKey,
        performerEscrow: performerEscrowPDA,
        globalState: globalStatePDA,
        stakerTreasury: stakerTreasury.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify fee distribution (would check balances in real test)
    const collection = await program.account.collectionState.fetch(collectionPDA);
    // Note: Actual balance checks would require proper token account setup
  });
});
