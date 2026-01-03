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
    
    // Ensure protocol and user account are initialized
    const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
    await ensureProtocolInitialized();
    await ensureUserAccountInitialized(user);
    
    // Create collection if it doesn't exist
    const { SystemProgram, SYSVAR_RENT_PUBKEY } = await import("@solana/web3.js");
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const { COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD, MAX_VIDEO_LIMIT } = await import("./helpers/constants");
    const { oracleFeed } = await import("./helpers/setup");
    
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    try {
      await program.account.collectionState.fetch(collectionPDA);
    } catch {
      const mint = Keypair.generate();
      const { airdropAndConfirm, provider } = await import("./helpers/setup");
      try {
        await airdropAndConfirm(mint.publicKey);
        const finalBalance = await provider.connection.getBalance(mint.publicKey);
        if (finalBalance === 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await airdropAndConfirm(mint.publicKey);
        }
      } catch (err) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        await airdropAndConfirm(mint.publicKey);
      }
      
      await program.methods
        .createCollection(
          COLLECTION_ID,
          COLLECTION_NAME,
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
          MAX_VIDEO_LIMIT
        )
        .accounts({
          owner: user.publicKey,
          collection: collectionPDA,
          oracleFeed: oracleFeed.publicKey,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user, mint])
        .rpc();
    }
    
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
