import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  program,
  performer,
  user,
  setupAccounts,
  getCollectionPDA,
  getPerformerEscrowPDA,
} from "./helpers/setup";
import { COLLECTION_ID } from "./helpers/constants";

describe("Performer Escrow", () => {
  let collectionPDA: any;
  let performerEscrowPDA: any;

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
      const [mintPDA] = getMintPDA(collectionPDA);
      
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
          mint: mintPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
    }
    
    [performerEscrowPDA] = getPerformerEscrowPDA(collectionPDA);
  });

  it("Fails if escrow balance is 0", async () => {
    const performerTokenAccount = Keypair.generate().publicKey;

    try {
      await program.methods
        .claimPerformerEscrow()
        .accounts({
          performer: performer.publicKey,
          collection: collectionPDA,
          performerEscrow: performerEscrowPDA,
          performerTokenAccount: performerTokenAccount,
        })
        .signers([performer])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("InsufficientFunds");
    }
  });

  it("Fails if performer_wallet doesn't match signer", async () => {
    const wrongPerformer = Keypair.generate();
    const { airdropAndConfirm } = await import("./helpers/setup");
    await airdropAndConfirm(wrongPerformer.publicKey);
    
    const performerTokenAccount = Keypair.generate().publicKey;

    try {
      await program.methods
        .claimPerformerEscrow()
        .accounts({
          performer: wrongPerformer.publicKey,
          collection: collectionPDA,
          performerEscrow: performerEscrowPDA,
          performerTokenAccount: performerTokenAccount,
        })
        .signers([wrongPerformer])
        .rpc();
      expect.fail("Should have failed - wrong performer");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });
});
