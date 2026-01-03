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
describe("Integration Tests", () => {
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.setupAccounts)();
    }));
    describe("Complete User Flow", () => {
        it("Initialize protocol → Create user → Create collection", () => __awaiter(void 0, void 0, void 0, function* () {
            // 1. Initialize protocol (if not already initialized)
            const [globalStatePDA] = (0, setup_1.getGlobalStatePDA)();
            try {
                yield setup_1.program.account.globalState.fetch(globalStatePDA);
            }
            catch (_a) {
                yield setup_1.program.methods
                    .initializeProtocol(constants_1.INDEXER_URL, constants_1.REGISTRY_URL, constants_1.MOD_STAKE_MIN, constants_1.FEE_BASIS_POINTS)
                    .accountsPartial({
                    admin: setup_1.admin.publicKey,
                    globalState: globalStatePDA,
                    treasury: setup_1.treasury.publicKey,
                    capgmMint: setup_1.capgmMint.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                })
                    .signers([setup_1.admin])
                    .rpc();
            }
            // 2. Initialize user account (if not already initialized)
            const [userAccountPDA] = (0, setup_1.getUserAccountPDA)(setup_1.user.publicKey);
            try {
                yield setup_1.program.account.userAccount.fetch(userAccountPDA);
            }
            catch (_b) {
                yield setup_1.program.methods
                    .initializeUserAccount(constants_1.IPNS_KEY)
                    .accountsPartial({
                    authority: setup_1.user.publicKey,
                    userAccount: userAccountPDA,
                    systemProgram: web3_js_1.SystemProgram.programId,
                })
                    .signers([setup_1.user])
                    .rpc();
            }
            // 3. Create collection (use unique ID to avoid conflicts)
            const uniqueCollectionId = `collection-${Date.now()}`;
            const [collectionPDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, uniqueCollectionId);
            const [mintPDA] = (0, setup_1.getMintPDA)(collectionPDA);
            const poolAddress = web3_js_1.Keypair.generate().publicKey;
            const claimVault = web3_js_1.Keypair.generate().publicKey;
            yield setup_1.program.methods
                .createCollection(uniqueCollectionId, constants_1.COLLECTION_NAME, constants_1.CONTENT_CID, constants_1.ACCESS_THRESHOLD_USD)
                .accountsPartial({
                owner: setup_1.user.publicKey,
                collection: collectionPDA,
                oracleFeed: setup_1.oracleFeed.publicKey,
                poolAddress: poolAddress,
                claimVault: claimVault,
                mint: mintPDA,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
                clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                rent: web3_js_1.SYSVAR_RENT_PUBKEY,
            })
                .signers([setup_1.user])
                .rpc();
            // Verify final state
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            (0, chai_1.expect)(collection.collectionId).to.equal(uniqueCollectionId);
        }));
    });
    describe("Complete Pinner Flow", () => {
        it("Register → Claim rewards", () => __awaiter(void 0, void 0, void 0, function* () {
            // Ensure prerequisites exist
            const { ensureProtocolInitialized, ensureUserAccountInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
            yield ensureProtocolInitialized();
            yield ensureUserAccountInitialized(setup_1.user);
            // Create collection if it doesn't exist
            const [collectionPDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, constants_1.COLLECTION_ID);
            try {
                yield setup_1.program.account.collectionState.fetch(collectionPDA);
            }
            catch (_a) {
                const [mintPDA] = (0, setup_1.getMintPDA)(collectionPDA);
                const poolAddress = web3_js_1.Keypair.generate().publicKey;
                const claimVault = web3_js_1.Keypair.generate().publicKey;
                yield setup_1.program.methods
                    .createCollection(constants_1.COLLECTION_ID, constants_1.COLLECTION_NAME, constants_1.CONTENT_CID, constants_1.ACCESS_THRESHOLD_USD)
                    .accountsPartial({
                    owner: setup_1.user.publicKey,
                    collection: collectionPDA,
                    oracleFeed: setup_1.oracleFeed.publicKey,
                    poolAddress: poolAddress,
                    claimVault: claimVault,
                    mint: mintPDA,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                    rent: web3_js_1.SYSVAR_RENT_PUBKEY,
                })
                    .signers([setup_1.user])
                    .rpc();
            }
            const [pinnerStatePDA] = (0, setup_1.getPinnerStatePDA)(setup_1.pinner.publicKey, collectionPDA);
            // 1. Register pinner
            yield setup_1.program.methods
                .registerCollectionHost()
                .accountsPartial({
                pinner: setup_1.pinner.publicKey,
                collection: collectionPDA,
                pinnerState: pinnerStatePDA,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([setup_1.pinner])
                .rpc();
            // 2. Try to claim rewards (will fail if no rewards, but flow is correct)
            try {
                yield setup_1.program.methods
                    .claimRewards()
                    .accountsPartial({
                    pinner: setup_1.pinner.publicKey,
                    collection: collectionPDA,
                    pinnerState: pinnerStatePDA,
                })
                    .signers([setup_1.pinner])
                    .rpc();
            }
            catch (err) {
                // Expected if no rewards in pool
                (0, chai_1.expect)(err.toString()).to.include("InsufficientFunds");
            }
        }));
    });
    describe("Complete Moderation Flow", () => {
        it("Create ticket → Stake moderator → Resolve ticket", () => __awaiter(void 0, void 0, void 0, function* () {
            // Ensure protocol is initialized
            const { ensureProtocolInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
            yield ensureProtocolInitialized();
            const [globalStatePDA] = (0, setup_1.getGlobalStatePDA)();
            // Use unique target ID to avoid conflicts
            const uniqueTargetId = `target-${Date.now()}`;
            const [ticketPDA] = (0, setup_1.getModTicketPDA)(uniqueTargetId);
            const [moderatorStakePDA] = (0, setup_1.getModeratorStakePDA)(setup_1.moderator.publicKey);
            // 1. Create ticket
            try {
                yield setup_1.program.account.modTicket.fetch(ticketPDA);
            }
            catch (_a) {
                yield setup_1.program.methods
                    .createTicket(uniqueTargetId, { contentReport: {} }, constants_1.REASON)
                    .accountsPartial({
                    reporter: setup_1.user.publicKey,
                    ticket: ticketPDA,
                    systemProgram: web3_js_1.SystemProgram.programId,
                })
                    .signers([setup_1.user])
                    .rpc();
            }
            // 2. Stake moderator (if not already staked)
            try {
                yield setup_1.program.account.moderatorStake.fetch(moderatorStakePDA);
            }
            catch (_b) {
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
            // 3. Resolve ticket
            yield setup_1.program.methods
                .resolveTicket(true)
                .accountsPartial({
                moderator: setup_1.moderator.publicKey,
                globalState: globalStatePDA,
                moderatorStake: moderatorStakePDA,
                ticket: ticketPDA,
            })
                .signers([setup_1.moderator])
                .rpc();
            const ticket = yield setup_1.program.account.modTicket.fetch(ticketPDA);
            (0, chai_1.expect)(ticket.resolved).to.be.true;
            (0, chai_1.expect)(ticket.verdict).to.be.true;
        }));
    });
    describe("Edge Cases", () => {
        it("Multiple collections per owner", () => __awaiter(void 0, void 0, void 0, function* () {
            // Ensure prerequisites
            const { ensureProtocolInitialized, ensureUserAccountInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
            yield ensureProtocolInitialized();
            yield ensureUserAccountInitialized(setup_1.user);
            // Use unique collection IDs to avoid conflicts
            const uniqueId1 = `collection-1-${Date.now()}`;
            const uniqueId2 = `collection-2-${Date.now()}`;
            const [collection1PDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, uniqueId1);
            const [collection2PDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, uniqueId2);
            const [mint1PDA] = (0, setup_1.getMintPDA)(collection1PDA);
            const [mint2PDA] = (0, setup_1.getMintPDA)(collection2PDA);
            const poolAddress1 = web3_js_1.Keypair.generate().publicKey;
            const claimVault1 = web3_js_1.Keypair.generate().publicKey;
            const poolAddress2 = web3_js_1.Keypair.generate().publicKey;
            const claimVault2 = web3_js_1.Keypair.generate().publicKey;
            yield setup_1.program.methods
                .createCollection(uniqueId1, "Collection 1", constants_1.CONTENT_CID, constants_1.ACCESS_THRESHOLD_USD)
                .accountsPartial({
                owner: setup_1.user.publicKey,
                collection: collection1PDA,
                oracleFeed: setup_1.oracleFeed.publicKey,
                poolAddress: poolAddress1,
                claimVault: claimVault1,
                mint: mint1PDA,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
                clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                rent: web3_js_1.SYSVAR_RENT_PUBKEY,
            })
                .signers([setup_1.user])
                .rpc();
            yield setup_1.program.methods
                .createCollection(uniqueId2, "Collection 2", constants_1.CONTENT_CID, constants_1.ACCESS_THRESHOLD_USD)
                .accountsPartial({
                owner: setup_1.user.publicKey,
                collection: collection2PDA,
                oracleFeed: setup_1.oracleFeed.publicKey,
                poolAddress: poolAddress2,
                claimVault: claimVault2,
                mint: mint2PDA,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
                clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                rent: web3_js_1.SYSVAR_RENT_PUBKEY,
            })
                .signers([setup_1.user])
                .rpc();
            const collection1 = yield setup_1.program.account.collectionState.fetch(collection1PDA);
            const collection2 = yield setup_1.program.account.collectionState.fetch(collection2PDA);
            (0, chai_1.expect)(collection1.collectionId).to.equal(uniqueId1);
            (0, chai_1.expect)(collection2.collectionId).to.equal(uniqueId2);
        }));
        it("Multiple pinners per collection", () => __awaiter(void 0, void 0, void 0, function* () {
            // Ensure prerequisites
            const { ensureProtocolInitialized, ensureUserAccountInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
            yield ensureProtocolInitialized();
            yield ensureUserAccountInitialized(setup_1.user);
            // Create collection if it doesn't exist
            const [collectionPDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, constants_1.COLLECTION_ID);
            try {
                yield setup_1.program.account.collectionState.fetch(collectionPDA);
            }
            catch (_a) {
                const [mintPDA] = (0, setup_1.getMintPDA)(collectionPDA);
                const poolAddress = web3_js_1.Keypair.generate().publicKey;
                const claimVault = web3_js_1.Keypair.generate().publicKey;
                yield setup_1.program.methods
                    .createCollection(constants_1.COLLECTION_ID, constants_1.COLLECTION_NAME, constants_1.CONTENT_CID, constants_1.ACCESS_THRESHOLD_USD)
                    .accountsPartial({
                    owner: setup_1.user.publicKey,
                    collection: collectionPDA,
                    oracleFeed: setup_1.oracleFeed.publicKey,
                    poolAddress: poolAddress,
                    claimVault: claimVault,
                    mint: mintPDA,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                    rent: web3_js_1.SYSVAR_RENT_PUBKEY,
                })
                    .signers([setup_1.user])
                    .rpc();
            }
            const pinner2 = web3_js_1.Keypair.generate();
            yield setup_1.provider.connection.requestAirdrop(pinner2.publicKey, 10 * 1e9);
            yield new Promise(resolve => setTimeout(resolve, 500));
            const [pinner1StatePDA] = (0, setup_1.getPinnerStatePDA)(setup_1.pinner.publicKey, collectionPDA);
            const [pinner2StatePDA] = (0, setup_1.getPinnerStatePDA)(pinner2.publicKey, collectionPDA);
            // Register first pinner (check if already registered)
            try {
                yield setup_1.program.account.pinnerState.fetch(pinner1StatePDA);
                // Already registered, skip
            }
            catch (_b) {
                // Not registered, proceed with registration
                yield setup_1.program.methods
                    .registerCollectionHost()
                    .accountsPartial({
                    pinner: setup_1.pinner.publicKey,
                    collection: collectionPDA,
                    pinnerState: pinner1StatePDA,
                    systemProgram: web3_js_1.SystemProgram.programId,
                })
                    .signers([setup_1.pinner])
                    .rpc();
            }
            // Register second pinner
            yield setup_1.program.methods
                .registerCollectionHost()
                .accountsPartial({
                pinner: pinner2.publicKey,
                collection: collectionPDA,
                pinnerState: pinner2StatePDA,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([pinner2])
                .rpc();
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            (0, chai_1.expect)(collection.totalShares.toString()).to.equal("2");
        }));
    });
});
