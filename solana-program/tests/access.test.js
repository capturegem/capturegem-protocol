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
describe("Access Escrow", () => {
    let collectionPDA;
    let mint;
    let purchaser;
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.setupAccounts)();
        // Ensure protocol and user account are initialized
        const { ensureProtocolInitialized, ensureUserAccountInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
        yield ensureProtocolInitialized();
        yield ensureUserAccountInitialized(setup_1.user);
        // Create a collection for testing
        [collectionPDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, constants_1.COLLECTION_ID);
        const [mintPDA] = (0, setup_1.getMintPDA)(collectionPDA);
        // Check if collection exists, if not create it
        try {
            yield setup_1.program.account.collectionState.fetch(collectionPDA);
            // Get the actual mint from the collection
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            mint = collection.mint;
        }
        catch (_a) {
            // Collection doesn't exist, create it
            yield setup_1.program.methods
                .createCollection(constants_1.COLLECTION_ID, constants_1.COLLECTION_NAME, constants_1.CONTENT_CID, constants_1.ACCESS_THRESHOLD_USD)
                .accountsPartial({
                owner: setup_1.user.publicKey,
                collection: collectionPDA,
                oracleFeed: setup_1.oracleFeed.publicKey,
                poolAddress: web3_js_1.Keypair.generate().publicKey, // Mock pool address
                claimVault: web3_js_1.Keypair.generate().publicKey, // Mock claim vault
                mint: mintPDA,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
                clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                rent: web3_js_1.SYSVAR_RENT_PUBKEY,
            })
                .signers([setup_1.user])
                .rpc();
            mint = mintPDA;
        }
        // Create a purchaser for testing
        purchaser = web3_js_1.Keypair.generate();
        yield setup_1.provider.connection.requestAirdrop(purchaser.publicKey, 10 * 1e9);
        yield new Promise(resolve => setTimeout(resolve, 500));
    }));
    describe("Create Access Escrow", () => {
        it("Fails if amount_locked is 0", () => __awaiter(void 0, void 0, void 0, function* () {
            const [accessEscrowPDA] = (0, setup_1.getAccessEscrowPDA)(purchaser.publicKey, collectionPDA);
            const purchaserTokenAccount = yield (0, spl_token_1.getAssociatedTokenAddress)(mint, purchaser.publicKey);
            const escrowTokenAccount = web3_js_1.Keypair.generate().publicKey; // Mock escrow token account
            try {
                yield setup_1.program.methods
                    .createAccessEscrow(new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(0))
                    .accountsPartial({
                    purchaser: purchaser.publicKey,
                    collection: collectionPDA,
                    purchaserTokenAccount: purchaserTokenAccount,
                    escrowTokenAccount: escrowTokenAccount,
                    accessEscrow: accessEscrowPDA,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                })
                    .signers([purchaser])
                    .rpc();
                chai_1.expect.fail("Should have failed - amount is 0");
            }
            catch (err) {
                const errStr = err.toString();
                (0, chai_1.expect)(errStr.includes("InsufficientFunds")).to.be.true;
            }
        }));
        it("Fails if collection doesn't exist", () => __awaiter(void 0, void 0, void 0, function* () {
            const fakeCollection = web3_js_1.Keypair.generate().publicKey;
            const [accessEscrowPDA] = (0, setup_1.getAccessEscrowPDA)(purchaser.publicKey, fakeCollection);
            const purchaserTokenAccount = yield (0, spl_token_1.getAssociatedTokenAddress)(mint, purchaser.publicKey);
            const escrowTokenAccount = web3_js_1.Keypair.generate().publicKey;
            try {
                yield setup_1.program.methods
                    .createAccessEscrow(new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(1000))
                    .accountsPartial({
                    purchaser: purchaser.publicKey,
                    collection: fakeCollection,
                    purchaserTokenAccount: purchaserTokenAccount,
                    escrowTokenAccount: escrowTokenAccount,
                    accessEscrow: accessEscrowPDA,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                })
                    .signers([purchaser])
                    .rpc();
                chai_1.expect.fail("Should have failed - collection doesn't exist");
            }
            catch (err) {
                // Should fail because collection doesn't exist
                (0, chai_1.expect)(err.toString()).to.include("AccountNotInitialized");
            }
        }));
    });
    describe("Release Escrow", () => {
        it("Fails if access escrow doesn't exist", () => __awaiter(void 0, void 0, void 0, function* () {
            const fakePurchaser = web3_js_1.Keypair.generate();
            const [accessEscrowPDA] = (0, setup_1.getAccessEscrowPDA)(fakePurchaser.publicKey, collectionPDA);
            const escrowTokenAccount = web3_js_1.Keypair.generate().publicKey;
            try {
                yield setup_1.program.methods
                    .releaseEscrow([web3_js_1.Keypair.generate().publicKey], [new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(100)])
                    .accountsPartial({
                    purchaser: fakePurchaser.publicKey,
                    collection: collectionPDA,
                    accessEscrow: accessEscrowPDA,
                    escrowTokenAccount: escrowTokenAccount,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                })
                    .signers([fakePurchaser])
                    .rpc();
                chai_1.expect.fail("Should have failed - escrow doesn't exist");
            }
            catch (err) {
                (0, chai_1.expect)(err.toString()).to.include("AccountNotInitialized");
            }
        }));
        it("Fails if peer_wallets and peer_weights length mismatch", () => __awaiter(void 0, void 0, void 0, function* () {
            const [accessEscrowPDA] = (0, setup_1.getAccessEscrowPDA)(purchaser.publicKey, collectionPDA);
            const escrowTokenAccount = web3_js_1.Keypair.generate().publicKey;
            try {
                yield setup_1.program.methods
                    .releaseEscrow([web3_js_1.Keypair.generate().publicKey, web3_js_1.Keypair.generate().publicKey], [new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(100)])
                    .accountsPartial({
                    purchaser: purchaser.publicKey,
                    collection: collectionPDA,
                    accessEscrow: accessEscrowPDA,
                    escrowTokenAccount: escrowTokenAccount,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                })
                    .signers([purchaser])
                    .rpc();
                chai_1.expect.fail("Should have failed - length mismatch");
            }
            catch (err) {
                const errStr = err.toString();
                (0, chai_1.expect)(errStr.includes("InvalidFeeConfig") || errStr.includes("constraint")).to.be.true;
            }
        }));
        it("Fails if peer_wallets is empty", () => __awaiter(void 0, void 0, void 0, function* () {
            const [accessEscrowPDA] = (0, setup_1.getAccessEscrowPDA)(purchaser.publicKey, collectionPDA);
            const escrowTokenAccount = web3_js_1.Keypair.generate().publicKey;
            try {
                yield setup_1.program.methods
                    .releaseEscrow([], [])
                    .accountsPartial({
                    purchaser: purchaser.publicKey,
                    collection: collectionPDA,
                    accessEscrow: accessEscrowPDA,
                    escrowTokenAccount: escrowTokenAccount,
                    tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    clock: web3_js_1.SYSVAR_CLOCK_PUBKEY,
                })
                    .signers([purchaser])
                    .rpc();
                chai_1.expect.fail("Should have failed - empty peer list");
            }
            catch (err) {
                const errStr = err.toString();
                (0, chai_1.expect)(errStr.includes("InvalidFeeConfig") || errStr.includes("constraint")).to.be.true;
            }
        }));
    });
});
