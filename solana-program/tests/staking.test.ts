import { expect } from "chai";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program,
  admin,
  moderator,
  setupAccounts,
  getGlobalStatePDA,
  getModeratorStakePDA,
  provider,
} from "./helpers/setup";
import { MOD_STAKE_MIN } from "./helpers/constants";
import * as anchor from "@coral-xyz/anchor";

describe("Moderator Staking", () => {
  let globalStatePDA: any;

  before(async () => {
    await setupAccounts();
    
    // Ensure protocol is initialized
    const { ensureProtocolInitialized } = await import("./helpers/setup");
    await ensureProtocolInitialized();
    
    [globalStatePDA] = getGlobalStatePDA();
  });

  describe("Stake Moderator", () => {
    it("Successfully stakes CAPGM as moderator", async () => {
      const [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);
      const moderatorTokenAccount = Keypair.generate().publicKey; // Mock token account

      // Check if stake already exists (from previous test run)
      let existingStake = new anchor.BN(0);
      try {
        const existing = await program.account.moderatorStake.fetch(moderatorStakePDA);
        existingStake = existing.stakeAmount;
      } catch {
        // Account doesn't exist yet
      }

      const stakeAmount = MOD_STAKE_MIN;

      const tx = await program.methods
        .stakeModerator(stakeAmount)
        .accounts({
          moderator: moderator.publicKey,
          globalState: globalStatePDA,
          moderatorTokenAccount: moderatorTokenAccount,
          moderatorStake: moderatorStakePDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([moderator])
        .rpc();

      const moderatorStake = await program.account.moderatorStake.fetch(moderatorStakePDA);
      expect(moderatorStake.moderator.toString()).to.equal(moderator.publicKey.toString());
      expect(moderatorStake.stakeAmount.toString()).to.equal(existingStake.add(stakeAmount).toString());
      expect(moderatorStake.isActive).to.be.true;
    });

    it("Fails if stake_amount < moderator_stake_minimum", async () => {
      // Use a different moderator to avoid conflicts
      const testModerator = Keypair.generate();
      await provider.connection.requestAirdrop(testModerator.publicKey, 10 * 1e9);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const [moderatorStakePDA] = getModeratorStakePDA(testModerator.publicKey);
      const moderatorTokenAccount = Keypair.generate().publicKey;
      const insufficientStake = MOD_STAKE_MIN.sub(new anchor.BN(1));

      try {
        await program.methods
          .stakeModerator(insufficientStake)
          .accounts({
            moderator: testModerator.publicKey,
            globalState: globalStatePDA,
            moderatorTokenAccount: moderatorTokenAccount,
            moderatorStake: moderatorStakePDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([testModerator])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("InsufficientModeratorStake");
      }
    });

    it("Successfully adds additional stake to existing moderator", async () => {
      const [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);
      const moderatorTokenAccount = Keypair.generate().publicKey;
      // Must add at least MOD_STAKE_MIN because the Rust code requires stake_amount >= minimum
      const additionalStake = MOD_STAKE_MIN;

      const moderatorStakeBefore = await program.account.moderatorStake.fetch(moderatorStakePDA);
      const stakeBefore = moderatorStakeBefore.stakeAmount;

      await program.methods
        .stakeModerator(additionalStake)
        .accounts({
          moderator: moderator.publicKey,
          globalState: globalStatePDA,
          moderatorTokenAccount: moderatorTokenAccount,
          moderatorStake: moderatorStakePDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([moderator])
        .rpc();

      const moderatorStakeAfter = await program.account.moderatorStake.fetch(moderatorStakePDA);
      expect(moderatorStakeAfter.stakeAmount.toString()).to.equal(
        stakeBefore.add(additionalStake).toString()
      );
    });
  });

  describe("Slash Moderator", () => {
    let moderatorStakePDA: any;

    before(async () => {
      [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);
      
      // Ensure moderator is staked before slashing
      try {
        await program.account.moderatorStake.fetch(moderatorStakePDA);
      } catch {
        // Moderator not staked, stake them first
        const moderatorTokenAccount = Keypair.generate().publicKey;
        await program.methods
          .stakeModerator(MOD_STAKE_MIN)
          .accounts({
            moderator: moderator.publicKey,
            globalState: globalStatePDA,
            moderatorTokenAccount: moderatorTokenAccount,
            moderatorStake: moderatorStakePDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([moderator])
          .rpc();
      }
    });

    it("Successfully slashes moderator (admin only)", async function() {
      // Verify admin matches the protocol admin
      const globalState = await program.account.globalState.fetch(globalStatePDA);
      if (globalState.admin.toString() !== admin.publicKey.toString()) {
        // Protocol was initialized with different admin, skip this test
        this.skip();
        return;
      }
      
      const tx = await program.methods
        .slashModerator()
        .accounts({
          superModerator: admin.publicKey,
          globalState: globalStatePDA,
          moderatorStake: moderatorStakePDA,
          moderator: moderator.publicKey,
        })
        .signers([admin])
        .rpc();

      const moderatorStake = await program.account.moderatorStake.fetch(moderatorStakePDA);
      expect(moderatorStake.stakeAmount.toString()).to.equal("0");
      expect(moderatorStake.isActive).to.be.false;
      expect(moderatorStake.slashCount).to.be.greaterThan(0);
    });

    it("Fails if caller is not admin", async () => {
      const nonAdmin = Keypair.generate();

      try {
        await program.methods
          .slashModerator()
          .accounts({
            superModerator: nonAdmin.publicKey,
            globalState: globalStatePDA,
            moderatorStake: moderatorStakePDA,
            moderator: moderator.publicKey,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });
});
