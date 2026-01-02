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
} from "./helpers/setup";
import { MOD_STAKE_MIN } from "./helpers/constants";
import * as anchor from "@coral-xyz/anchor";

describe("Moderator Staking", () => {
  let globalStatePDA: any;

  before(async () => {
    await setupAccounts();
    [globalStatePDA] = getGlobalStatePDA();
  });

  describe("Stake Moderator", () => {
    it("Successfully stakes CAPGM as moderator", async () => {
      const [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);
      const moderatorTokenAccount = Keypair.generate().publicKey; // Mock token account

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
      expect(moderatorStake.stakeAmount.toString()).to.equal(stakeAmount.toString());
      expect(moderatorStake.isActive).to.be.true;
    });

    it("Fails if stake_amount < moderator_stake_minimum", async () => {
      const [moderatorStakePDA] = getModeratorStakePDA(Keypair.generate().publicKey);
      const moderatorTokenAccount = Keypair.generate().publicKey;
      const insufficientStake = MOD_STAKE_MIN.sub(new anchor.BN(1));

      try {
        await program.methods
          .stakeModerator(insufficientStake)
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
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("InsufficientModeratorStake");
      }
    });
  });

  describe("Slash Moderator", () => {
    let moderatorStakePDA: any;

    before(async () => {
      [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);
    });

    it("Successfully slashes moderator (admin only)", async () => {
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
