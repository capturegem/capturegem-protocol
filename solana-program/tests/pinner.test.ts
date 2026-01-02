import { expect } from "chai";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  program,
  pinner,
  user,
  setupAccounts,
  getCollectionPDA,
  getPinnerStatePDA,
} from "./helpers/setup";
import { COLLECTION_ID } from "./helpers/constants";

describe("Pinner Operations", () => {
  let collectionPDA: any;
  let pinnerStatePDA: any;

  before(async () => {
    await setupAccounts();
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    [pinnerStatePDA] = getPinnerStatePDA(pinner.publicKey, collectionPDA);
  });

  describe("Register Collection Host", () => {
    it("Successfully registers pinner for collection", async () => {
      const tx = await program.methods
        .registerCollectionHost()
        .accounts({
          pinner: pinner.publicKey,
          collection: collectionPDA,
          pinnerState: pinnerStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([pinner])
        .rpc();

      const pinnerState = await program.account.pinnerState.fetch(pinnerStatePDA);
      expect(pinnerState.pinner.toString()).to.equal(pinner.publicKey.toString());
      expect(pinnerState.collection.toString()).to.equal(collectionPDA.toString());
      expect(pinnerState.isActive).to.be.true;
      expect(pinnerState.shares.toString()).to.equal("1");
      expect(pinnerState.lastAuditPass.toNumber()).to.be.greaterThan(0);

      const collection = await program.account.collectionState.fetch(collectionPDA);
      expect(collection.totalShares.toString()).to.equal("1");
    });

    it("Fails if pinner already registered for same collection", async () => {
      try {
        await program.methods
          .registerCollectionHost()
          .accounts({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([pinner])
          .rpc();
        expect.fail("Should have failed - already registered");
      } catch (err: any) {
        expect(err.toString()).to.include("already in use");
      }
    });
  });

  describe("Submit Audit Result", () => {
    it("Successfully submits successful audit", async () => {
      const authority = Keypair.generate(); // In production, this would be a verified auditor

      const tx = await program.methods
        .submitAuditResult(true)
        .accounts({
          authority: authority.publicKey,
          pinnerState: pinnerStatePDA,
        })
        .signers([authority])
        .rpc();

      const pinnerState = await program.account.pinnerState.fetch(pinnerStatePDA);
      expect(pinnerState.isActive).to.be.true;
      expect(pinnerState.lastAuditPass.toNumber()).to.be.greaterThan(0);
    });

    it("Successfully submits failed audit", async () => {
      const authority = Keypair.generate();

      const tx = await program.methods
        .submitAuditResult(false)
        .accounts({
          authority: authority.publicKey,
          pinnerState: pinnerStatePDA,
        })
        .signers([authority])
        .rpc();

      const pinnerState = await program.account.pinnerState.fetch(pinnerStatePDA);
      expect(pinnerState.isActive).to.be.false;
    });
  });

  describe("Claim Rewards", () => {
    it("Fails if no rewards available", async () => {
      // Ensure audit is recent
      const authority = Keypair.generate();
      await program.methods
        .submitAuditResult(true)
        .accounts({
          authority: authority.publicKey,
          pinnerState: pinnerStatePDA,
        })
        .signers([authority])
        .rpc();

      // Try to claim (should fail if no rewards)
      try {
        await program.methods
          .claimRewards()
          .accounts({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
          })
          .signers([pinner])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        // Expected if no rewards in pool
        expect(err.toString()).to.include("InsufficientFunds");
      }
    });

    it("Fails if pinner is not active", async () => {
      // Deactivate pinner
      const authority = Keypair.generate();
      await program.methods
        .submitAuditResult(false)
        .accounts({
          authority: authority.publicKey,
          pinnerState: pinnerStatePDA,
        })
        .signers([authority])
        .rpc();

      // Try to claim
      try {
        await program.methods
          .claimRewards()
          .accounts({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
          })
          .signers([pinner])
          .rpc();
        expect.fail("Should have failed - not active");
      } catch (err: any) {
        expect(err.toString()).to.include("AuditWindowExpired");
      }
    });
  });
});
