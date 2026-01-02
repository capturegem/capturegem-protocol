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
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
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
