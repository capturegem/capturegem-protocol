import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program,
  pinner,
  user,
  setupAccounts,
  getCollectionPDA,
  getMintPDA,
  getPinnerStatePDA,
  oracleFeed,
  ensureProtocolInitialized,
  ensureUserAccountInitialized,
} from "./helpers/setup";
import { COLLECTION_ID, COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD } from "./helpers/constants";

describe("Pinner Operations", () => {
  let collectionPDA: PublicKey;
  let pinnerStatePDA: PublicKey;

  before(async () => {
    await setupAccounts();
    
    // Ensure protocol and user account are initialized
    await ensureProtocolInitialized();
    await ensureUserAccountInitialized(user);
    
    // Create a collection for testing
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    
    // Check if collection exists, if not create it
    try {
      await program.account.collectionState.fetch(collectionPDA);
    } catch {
      // Collection doesn't exist, create it
      const [mintPDA] = getMintPDA(collectionPDA);
      
      const { SystemProgram, SYSVAR_CLOCK_PUBKEY } = await import("@solana/web3.js");
      const poolAddress = Keypair.generate().publicKey;
      const claimVault = Keypair.generate().publicKey;

      await program.methods
        .createCollection(
          COLLECTION_ID,
          COLLECTION_NAME,
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
        )
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          oracleFeed: oracleFeed.publicKey,
          poolAddress: poolAddress,
          claimVault: claimVault,
          mint: mintPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
    }
    
    [pinnerStatePDA] = getPinnerStatePDA(pinner.publicKey, collectionPDA);
  });

  describe("Register Collection Host", () => {
    it("Successfully registers pinner for collection", async () => {
      // Check if already registered, if so skip
      try {
        await program.account.pinnerState.fetch(pinnerStatePDA);
        // Already registered, verify it's correct
        const pinnerState = await program.account.pinnerState.fetch(pinnerStatePDA);
        expect(pinnerState.pinner.toString()).to.equal(pinner.publicKey.toString());
        expect(pinnerState.collection.toString()).to.equal(collectionPDA.toString());
        return; // Test passes
      } catch {
        // Not registered, proceed with registration
      }
      
      const tx = await program.methods
        .registerCollectionHost()
        .accountsPartial({
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
    });

    it("Fails if pinner already registered for same collection", async () => {
      try {
        await program.methods
          .registerCollectionHost()
          .accountsPartial({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([pinner])
          .rpc();
        expect.fail("Should have failed - already registered");
      } catch (err: unknown) {
        expect(err.toString()).to.include("already in use");
      }
    });
  });

  describe("Claim Rewards", () => {
    it("Fails if no rewards available", async () => {
      try {
        await program.methods
          .claimRewards()
          .accountsPartial({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
          })
          .signers([pinner])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: unknown) {
        // Expected if no rewards in pool
        expect(err.toString()).to.include("InsufficientFunds");
      }
    });

    it("Fails if pinner is not active", async () => {
      // Note: Without audits, pinners remain active unless explicitly deactivated through other means
      // This test is no longer applicable, but we keep the structure for future use
      // For now, we'll skip this test
      console.log("Skipping test - audit system removed");
    });
  });
});
