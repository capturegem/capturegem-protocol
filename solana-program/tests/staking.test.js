"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const setup_1 = require("./helpers/setup");
const constants_1 = require("./helpers/constants");
const anchor = __importStar(require("@coral-xyz/anchor"));
describe("Moderator Staking", () => {
    let globalStatePDA;
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.setupAccounts)();
        // Ensure protocol is initialized
        const { ensureProtocolInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
        yield ensureProtocolInitialized();
        [globalStatePDA] = (0, setup_1.getGlobalStatePDA)();
    }));
    describe("Stake Moderator", () => {
        it("Successfully stakes CAPGM as moderator", () => __awaiter(void 0, void 0, void 0, function* () {
            const [moderatorStakePDA] = (0, setup_1.getModeratorStakePDA)(setup_1.moderator.publicKey);
            const moderatorTokenAccount = web3_js_1.Keypair.generate().publicKey; // Mock token account
            // Check if stake already exists (from previous test run)
            let existingStake = new anchor.BN(0);
            try {
                const existing = yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
                existingStake = existing.stakeAmount;
            }
            catch (_a) {
                // Account doesn't exist yet
            }
            const stakeAmount = constants_1.MOD_STAKE_MIN;
            const tx = yield setup_1.program.methods
                .stakeModerator(stakeAmount)
                .accountsPartial({
                moderator: setup_1.moderator.publicKey,
                globalState: globalStatePDA,
                moderatorTokenAccount: moderatorTokenAccount,
                moderatorStake: moderatorStakePDA,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([setup_1.moderator])
                .rpc();
            const moderatorStake = yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
            (0, chai_1.expect)(moderatorStake.moderator.toString()).to.equal(setup_1.moderator.publicKey.toString());
            (0, chai_1.expect)(moderatorStake.stakeAmount.toString()).to.equal(existingStake.add(stakeAmount).toString());
            (0, chai_1.expect)(moderatorStake.isActive).to.be.true;
        }));
        it("Fails if stake_amount < moderator_stake_minimum", () => __awaiter(void 0, void 0, void 0, function* () {
            // Use a different moderator to avoid conflicts
            const testModerator = web3_js_1.Keypair.generate();
            yield setup_1.provider.connection.requestAirdrop(testModerator.publicKey, 10 * 1e9);
            yield new Promise(resolve => setTimeout(resolve, 500));
            const [moderatorStakePDA] = (0, setup_1.getModeratorStakePDA)(testModerator.publicKey);
            const moderatorTokenAccount = web3_js_1.Keypair.generate().publicKey;
            const insufficientStake = constants_1.MOD_STAKE_MIN.sub(new anchor.BN(1));
            try {
                yield setup_1.program.methods
                    .stakeModerator(insufficientStake)
                    .accountsPartial({
                    moderator: testModerator.publicKey,
                    globalState: globalStatePDA,
                    moderatorTokenAccount: moderatorTokenAccount,
                    moderatorStake: moderatorStakePDA,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                })
                    .signers([testModerator])
                    .rpc();
                chai_1.expect.fail("Should have failed");
            }
            catch (err) {
                (0, chai_1.expect)(err.toString()).to.include("InsufficientModeratorStake");
            }
        }));
        it("Successfully adds additional stake to existing moderator", () => __awaiter(void 0, void 0, void 0, function* () {
            const [moderatorStakePDA] = (0, setup_1.getModeratorStakePDA)(setup_1.moderator.publicKey);
            const moderatorTokenAccount = web3_js_1.Keypair.generate().publicKey;
            // Must add at least MOD_STAKE_MIN because the Rust code requires stake_amount >= minimum
            const additionalStake = constants_1.MOD_STAKE_MIN;
            const moderatorStakeBefore = yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
            const stakeBefore = moderatorStakeBefore.stakeAmount;
            yield setup_1.program.methods
                .stakeModerator(additionalStake)
                .accountsPartial({
                moderator: setup_1.moderator.publicKey,
                globalState: globalStatePDA,
                moderatorTokenAccount: moderatorTokenAccount,
                moderatorStake: moderatorStakePDA,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([setup_1.moderator])
                .rpc();
            const moderatorStakeAfter = yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
            (0, chai_1.expect)(moderatorStakeAfter.stakeAmount.toString()).to.equal(stakeBefore.add(additionalStake).toString());
        }));
    });
    describe("Slash Moderator", () => {
        let moderatorStakePDA;
        before(() => __awaiter(void 0, void 0, void 0, function* () {
            [moderatorStakePDA] = (0, setup_1.getModeratorStakePDA)(setup_1.moderator.publicKey);
            // Ensure moderator is staked before slashing
            try {
                yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
            }
            catch (_a) {
                // Moderator not staked, stake them first
                const moderatorTokenAccount = web3_js_1.Keypair.generate().publicKey;
                yield setup_1.program.methods
                    .stakeModerator(constants_1.MOD_STAKE_MIN)
                    .accountsPartial({
                    moderator: setup_1.moderator.publicKey,
                    globalState: globalStatePDA,
                    moderatorTokenAccount: moderatorTokenAccount,
                    moderatorStake: moderatorStakePDA,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                })
                    .signers([setup_1.moderator])
                    .rpc();
            }
        }));
        it("Successfully slashes moderator (admin only)", function () {
            return __awaiter(this, void 0, void 0, function* () {
                // Verify admin matches the protocol admin
                const globalState = yield setup_1.program.account.globalState.fetch(globalStatePDA);
                if (globalState.admin.toString() !== setup_1.admin.publicKey.toString()) {
                    // Protocol was initialized with different admin, skip this test
                    this.skip();
                    return;
                }
                const tx = yield setup_1.program.methods
                    .slashModerator()
                    .accountsPartial({
                    superModerator: setup_1.admin.publicKey,
                    globalState: globalStatePDA,
                    moderatorStake: moderatorStakePDA,
                    moderator: setup_1.moderator.publicKey,
                })
                    .signers([setup_1.admin])
                    .rpc();
                const moderatorStake = yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
                (0, chai_1.expect)(moderatorStake.stakeAmount.toString()).to.equal("0");
                (0, chai_1.expect)(moderatorStake.isActive).to.be.false;
                (0, chai_1.expect)(moderatorStake.slashCount).to.be.greaterThan(0);
            });
        });
        it("Fails if caller is not admin", () => __awaiter(void 0, void 0, void 0, function* () {
            const nonAdmin = web3_js_1.Keypair.generate();
            try {
                yield setup_1.program.methods
                    .slashModerator()
                    .accountsPartial({
                    superModerator: nonAdmin.publicKey,
                    globalState: globalStatePDA,
                    moderatorStake: moderatorStakePDA,
                    moderator: setup_1.moderator.publicKey,
                })
                    .signers([nonAdmin])
                    .rpc();
                chai_1.expect.fail("Should have failed");
            }
            catch (err) {
                (0, chai_1.expect)(err.toString()).to.include("Unauthorized");
            }
        }));
    });
});
