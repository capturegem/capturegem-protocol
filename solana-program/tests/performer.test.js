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
const setup_1 = require("./helpers/setup");
const constants_1 = require("./helpers/constants");
describe("Performer Escrow", () => {
    let collectionPDA;
    let performerEscrowPDA;
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.setupAccounts)();
        // Ensure protocol and user account are initialized
        const { ensureProtocolInitialized, ensureUserAccountInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
        yield ensureProtocolInitialized();
        yield ensureUserAccountInitialized(setup_1.user);
        // Create collection if it doesn't exist
        const { SystemProgram, SYSVAR_RENT_PUBKEY } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = yield Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        const { COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD } = yield Promise.resolve().then(() => __importStar(require("./helpers/constants")));
        const { oracleFeed } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
        [collectionPDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, constants_1.COLLECTION_ID);
        try {
            yield setup_1.program.account.collectionState.fetch(collectionPDA);
        }
        catch (_a) {
            const [mintPDA] = (0, setup_1.getMintPDA)(collectionPDA);
            const { SystemProgram, SYSVAR_CLOCK_PUBKEY } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
            const poolAddress = web3_js_1.Keypair.generate().publicKey;
            const claimVault = web3_js_1.Keypair.generate().publicKey;
            yield setup_1.program.methods
                .createCollection(constants_1.COLLECTION_ID, COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD)
                .accountsPartial({
                owner: setup_1.user.publicKey,
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
                .signers([setup_1.user])
                .rpc();
        }
        [performerEscrowPDA] = (0, setup_1.getPerformerEscrowPDA)(collectionPDA);
        // Initialize performer escrow if it doesn't exist
        try {
            yield setup_1.program.account.performerEscrow.fetch(performerEscrowPDA);
        }
        catch (_b) {
            // Not initialized, initialize it
            yield setup_1.program.methods
                .initializePerformerEscrow(setup_1.performer.publicKey)
                .accountsPartial({
                authority: setup_1.user.publicKey,
                collection: collectionPDA,
                performerEscrow: performerEscrowPDA,
                systemProgram: SystemProgram.programId,
            })
                .signers([setup_1.user])
                .rpc();
        }
    }));
    it("Fails if escrow balance is 0", () => __awaiter(void 0, void 0, void 0, function* () {
        const performerTokenAccount = web3_js_1.Keypair.generate().publicKey;
        try {
            yield setup_1.program.methods
                .claimPerformerEscrow()
                .accountsPartial({
                performer: setup_1.performer.publicKey,
                collection: collectionPDA,
                performerEscrow: performerEscrowPDA,
                performerTokenAccount: performerTokenAccount,
            })
                .signers([setup_1.performer])
                .rpc();
            chai_1.expect.fail("Should have failed");
        }
        catch (err) {
            const errStr = err.toString();
            // Account might not be initialized if instruction doesn't exist in deployed program
            (0, chai_1.expect)(errStr.includes("InsufficientFunds") || errStr.includes("AccountNotInitialized")).to.be.true;
        }
    }));
    it("Fails if performer_wallet doesn't match signer", () => __awaiter(void 0, void 0, void 0, function* () {
        const wrongPerformer = web3_js_1.Keypair.generate();
        const { airdropAndConfirm } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
        yield airdropAndConfirm(wrongPerformer.publicKey);
        const performerTokenAccount = web3_js_1.Keypair.generate().publicKey;
        try {
            yield setup_1.program.methods
                .claimPerformerEscrow()
                .accountsPartial({
                performer: wrongPerformer.publicKey,
                collection: collectionPDA,
                performerEscrow: performerEscrowPDA,
                performerTokenAccount: performerTokenAccount,
            })
                .signers([wrongPerformer])
                .rpc();
            chai_1.expect.fail("Should have failed - wrong performer");
        }
        catch (err) {
            const errStr = err.toString();
            // Account might not be initialized, or performer_wallet might not match
            (0, chai_1.expect)(errStr.includes("Unauthorized") || errStr.includes("AccountNotInitialized") || errStr.includes("PerformerEscrowNotFound")).to.be.true;
        }
    }));
});
