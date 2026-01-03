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
describe("Mint Collection Tokens", () => {
    let collectionPDA;
    let mint;
    let creatorTokenAccount;
    let orcaPoolTokenAccount;
    let orcaProgram;
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.setupAccounts)();
        // Ensure protocol and user account are initialized
        const { ensureProtocolInitialized, ensureUserAccountInitialized } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
        yield ensureProtocolInitialized();
        yield ensureUserAccountInitialized(setup_1.user);
        // Create a collection for testing
        const { SystemProgram } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        [collectionPDA] = (0, setup_1.getCollectionPDA)(setup_1.user.publicKey, constants_1.COLLECTION_ID);
        const [mintPDA] = (0, setup_1.getMintPDA)(collectionPDA);
        // Check if collection exists, if not create it
        try {
            yield setup_1.program.account.collectionState.fetch(collectionPDA);
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            mint = collection.mint;
        }
        catch (_a) {
            // Collection doesn't exist, create it
            const { SystemProgram, SYSVAR_CLOCK_PUBKEY } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
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
                systemProgram: SystemProgram.programId,
                clock: SYSVAR_CLOCK_PUBKEY,
                rent: web3_js_1.SYSVAR_RENT_PUBKEY,
            })
                .signers([setup_1.user])
                .rpc();
            mint = mintPDA;
        }
        // Get or create creator's token account
        creatorTokenAccount = yield (0, spl_token_1.getAssociatedTokenAddress)(mint, setup_1.user.publicKey);
        // Create creator's token account if it doesn't exist
        try {
            yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
        }
        catch (_b) {
            const createATAInstruction = (0, spl_token_1.createAssociatedTokenAccountInstruction)(setup_1.user.publicKey, creatorTokenAccount, setup_1.user.publicKey, mint);
            const tx = yield setup_1.provider.sendAndConfirm(new (yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")))).Transaction().add(createATAInstruction), [setup_1.user]);
        }
        // Create a mock Orca pool token account
        // For testing, we'll use an associated token account owned by a test keypair
        const orcaPoolOwner = web3_js_1.Keypair.generate();
        yield setup_1.provider.connection.requestAirdrop(orcaPoolOwner.publicKey, 10 * 1e9);
        yield new Promise(resolve => setTimeout(resolve, 500));
        orcaPoolTokenAccount = yield (0, spl_token_1.getAssociatedTokenAddress)(mint, orcaPoolOwner.publicKey);
        // Create the Orca pool token account if it doesn't exist
        try {
            yield (0, spl_token_1.getAccount)(setup_1.provider.connection, orcaPoolTokenAccount);
        }
        catch (_c) {
            const createOrcaATAInstruction = (0, spl_token_1.createAssociatedTokenAccountInstruction)(orcaPoolOwner.publicKey, orcaPoolTokenAccount, orcaPoolOwner.publicKey, mint);
            const tx = yield setup_1.provider.sendAndConfirm(new (yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")))).Transaction().add(createOrcaATAInstruction), [orcaPoolOwner]);
        }
        // For testing, we'll use a dummy Orca program ID
        // In production, this would be the actual Orca Whirlpool or StableSwap program ID
        orcaProgram = web3_js_1.Keypair.generate().publicKey;
    }));
    it("Successfully mints collection tokens with correct distribution", () => __awaiter(void 0, void 0, void 0, function* () {
        const mintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(1000000000); // 1000 tokens (6 decimals)
        const expectedCreatorAmount = mintAmount.toNumber() * 0.1; // 10%
        const expectedClaimVaultAmount = mintAmount.toNumber() * 0.1; // 10%
        const expectedOrcaAmount = mintAmount.toNumber() * 0.8; // 80%
        // Get initial balances
        let creatorBalance = 0;
        let claimVaultBalance = 0;
        let orcaBalance = 0;
        try {
            const account = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
            creatorBalance = Number(account.amount);
        }
        catch (_a) {
            creatorBalance = 0;
        }
        // Note: claim_vault account would need to be set up properly in a real test
        // For now, we'll just verify the Orca amount
        try {
            const account = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, orcaPoolTokenAccount);
            orcaBalance = Number(account.amount);
        }
        catch (_b) {
            orcaBalance = 0;
        }
        // Get initial mint supply
        const mintInfoBefore = yield (0, spl_token_1.getMint)(setup_1.provider.connection, mint);
        const supplyBefore = Number(mintInfoBefore.supply);
        // Execute mint instruction
        const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
        const claimVault = collection.claimVault;
        yield setup_1.program.methods
            .mintCollectionTokens(mintAmount)
            .accountsPartial({
            creator: setup_1.user.publicKey,
            collection: collectionPDA,
            mint: mint,
            creatorTokenAccount: creatorTokenAccount,
            claimVault: claimVault,
            orcaLiquidityPool: orcaPoolTokenAccount,
            orcaProgram: orcaProgram,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([setup_1.user])
            .rpc();
        // Verify creator received 10% (with small tolerance for rounding)
        const creatorAccount = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
        const newCreatorBalance = Number(creatorAccount.amount);
        const creatorReceived = newCreatorBalance - creatorBalance;
        // Allow for rounding differences (should be within 1 token)
        (0, chai_1.expect)(creatorReceived).to.be.at.least(expectedCreatorAmount - 1000000);
        (0, chai_1.expect)(creatorReceived).to.be.at.most(expectedCreatorAmount + 1000000);
        // Verify Orca pool received 80% (with small tolerance for rounding)
        const orcaAccount = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, orcaPoolTokenAccount);
        const newOrcaBalance = Number(orcaAccount.amount);
        const orcaReceived = newOrcaBalance - orcaBalance;
        // Allow for rounding differences
        (0, chai_1.expect)(orcaReceived).to.be.at.least(expectedOrcaAmount - 1000000);
        (0, chai_1.expect)(orcaReceived).to.be.at.most(expectedOrcaAmount + 1000000);
        // Verify the sum equals the total minted amount (accounting for rounding)
        // Creator (10%) + Claim Vault (10%) + Orca (80%) = 100%
        const totalDistributed = creatorReceived + expectedClaimVaultAmount + orcaReceived;
        (0, chai_1.expect)(totalDistributed).to.equal(mintAmount.toNumber());
        // Verify mint supply increased by the full amount
        const mintInfoAfter = yield (0, spl_token_1.getMint)(setup_1.provider.connection, mint);
        const supplyAfter = Number(mintInfoAfter.supply);
        (0, chai_1.expect)(supplyAfter - supplyBefore).to.equal(mintAmount.toNumber());
    }));
    it("Fails if called by non-owner", () => __awaiter(void 0, void 0, void 0, function* () {
        const unauthorizedUser = web3_js_1.Keypair.generate();
        yield setup_1.provider.connection.requestAirdrop(unauthorizedUser.publicKey, 10 * 1e9);
        yield new Promise(resolve => setTimeout(resolve, 500));
        const mintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(1000000000);
        try {
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            const claimVault = collection.claimVault;
            yield setup_1.program.methods
                .mintCollectionTokens(mintAmount)
                .accountsPartial({
                creator: unauthorizedUser.publicKey,
                collection: collectionPDA,
                mint: mint,
                creatorTokenAccount: creatorTokenAccount,
                claimVault: claimVault,
                orcaLiquidityPool: orcaPoolTokenAccount,
                orcaProgram: orcaProgram,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([unauthorizedUser])
                .rpc();
            chai_1.expect.fail("Should have failed - unauthorized user");
        }
        catch (err) {
            const errStr = err.toString();
            (0, chai_1.expect)(errStr.includes("Unauthorized") || errStr.includes("constraint")).to.be.true;
        }
    }));
    it("Fails if amount is 0", () => __awaiter(void 0, void 0, void 0, function* () {
        const mintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(0);
        try {
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            const claimVault = collection.claimVault;
            yield setup_1.program.methods
                .mintCollectionTokens(mintAmount)
                .accountsPartial({
                creator: setup_1.user.publicKey,
                collection: collectionPDA,
                mint: mint,
                creatorTokenAccount: creatorTokenAccount,
                claimVault: claimVault,
                orcaLiquidityPool: orcaPoolTokenAccount,
                orcaProgram: orcaProgram,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([setup_1.user])
                .rpc();
            chai_1.expect.fail("Should have failed - amount is 0");
        }
        catch (err) {
            const errStr = err.toString();
            (0, chai_1.expect)(errStr.includes("InvalidFeeConfig") || errStr.includes("amount")).to.be.true;
        }
    }));
    it("Fails if collection doesn't exist", () => __awaiter(void 0, void 0, void 0, function* () {
        const fakeCollection = web3_js_1.Keypair.generate().publicKey;
        const [fakeMintPDA] = (0, setup_1.getMintPDA)(fakeCollection);
        const mintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(1000000000);
        try {
            // For fake collection, we need a fake claim vault too
            const fakeClaimVault = web3_js_1.Keypair.generate().publicKey;
            yield setup_1.program.methods
                .mintCollectionTokens(mintAmount)
                .accountsPartial({
                creator: setup_1.user.publicKey,
                collection: fakeCollection,
                mint: fakeMintPDA,
                creatorTokenAccount: creatorTokenAccount,
                claimVault: fakeClaimVault,
                orcaLiquidityPool: orcaPoolTokenAccount,
                orcaProgram: orcaProgram,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([setup_1.user])
                .rpc();
            chai_1.expect.fail("Should have failed - collection doesn't exist");
        }
        catch (err) {
            const errStr = err.toString();
            (0, chai_1.expect)(errStr.includes("AccountNotInitialized") ||
                errStr.includes("constraint") ||
                errStr.includes("Unauthorized")).to.be.true;
        }
    }));
    it("Fails if mint doesn't match collection's mint", () => __awaiter(void 0, void 0, void 0, function* () {
        const fakeMint = web3_js_1.Keypair.generate().publicKey;
        const mintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(1000000000);
        try {
            const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
            const claimVault = collection.claimVault;
            yield setup_1.program.methods
                .mintCollectionTokens(mintAmount)
                .accountsPartial({
                creator: setup_1.user.publicKey,
                collection: collectionPDA,
                mint: fakeMint,
                creatorTokenAccount: creatorTokenAccount,
                claimVault: claimVault,
                orcaLiquidityPool: orcaPoolTokenAccount,
                orcaProgram: orcaProgram,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([setup_1.user])
                .rpc();
            chai_1.expect.fail("Should have failed - mint doesn't match");
        }
        catch (err) {
            const errStr = err.toString();
            (0, chai_1.expect)(errStr.includes("Unauthorized") || errStr.includes("constraint")).to.be.true;
        }
    }));
    it("Handles rounding correctly for odd amounts", () => __awaiter(void 0, void 0, void 0, function* () {
        // Test with an amount that doesn't divide evenly by 100
        const mintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(1000000003); // 1000.000003 tokens
        // Get initial balances
        let creatorBalance = 0;
        try {
            const account = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
            creatorBalance = Number(account.amount);
        }
        catch (_a) {
            creatorBalance = 0;
        }
        const mintInfoBefore = yield (0, spl_token_1.getMint)(setup_1.provider.connection, mint);
        const supplyBefore = Number(mintInfoBefore.supply);
        // Execute mint instruction
        const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
        const claimVault = collection.claimVault;
        yield setup_1.program.methods
            .mintCollectionTokens(mintAmount)
            .accountsPartial({
            creator: setup_1.user.publicKey,
            collection: collectionPDA,
            mint: mint,
            creatorTokenAccount: creatorTokenAccount,
            claimVault: claimVault,
            orcaLiquidityPool: orcaPoolTokenAccount,
            orcaProgram: orcaProgram,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([setup_1.user])
            .rpc();
        // Verify total supply increased by exact amount
        const mintInfoAfter = yield (0, spl_token_1.getMint)(setup_1.provider.connection, mint);
        const supplyAfter = Number(mintInfoAfter.supply);
        (0, chai_1.expect)(supplyAfter - supplyBefore).to.equal(mintAmount.toNumber());
        // Verify creator received approximately 10% (with remainder handling)
        const creatorAccount = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
        const newCreatorBalance = Number(creatorAccount.amount);
        const creatorReceived = newCreatorBalance - creatorBalance;
        // Creator should get 10% + any rounding remainder
        // For 1000000003, 10% = 100000000.3, which rounds to 100000000
        // Remainder = 3, so creator gets 100000003 total
        const expectedCreatorMin = 100000000; // 10% rounded down
        const expectedCreatorMax = 100000003; // 10% + remainder
        (0, chai_1.expect)(creatorReceived).to.be.at.least(expectedCreatorMin);
        (0, chai_1.expect)(creatorReceived).to.be.at.most(expectedCreatorMax);
    }));
    it("Can mint multiple times and accumulates correctly", () => __awaiter(void 0, void 0, void 0, function* () {
        const firstMintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(500000000); // 500 tokens
        const secondMintAmount = new (yield Promise.resolve().then(() => __importStar(require("@coral-xyz/anchor")))).BN(300000000); // 300 tokens
        // Get initial balances
        let creatorBalance = 0;
        try {
            const account = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
            creatorBalance = Number(account.amount);
        }
        catch (_a) {
            creatorBalance = 0;
        }
        const mintInfoBefore = yield (0, spl_token_1.getMint)(setup_1.provider.connection, mint);
        const supplyBefore = Number(mintInfoBefore.supply);
        // Get claim vault from collection
        const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
        const claimVault = collection.claimVault;
        // First mint
        yield setup_1.program.methods
            .mintCollectionTokens(firstMintAmount)
            .accountsPartial({
            creator: setup_1.user.publicKey,
            collection: collectionPDA,
            mint: mint,
            creatorTokenAccount: creatorTokenAccount,
            claimVault: claimVault,
            orcaLiquidityPool: orcaPoolTokenAccount,
            orcaProgram: orcaProgram,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([setup_1.user])
            .rpc();
        // Second mint
        yield setup_1.program.methods
            .mintCollectionTokens(secondMintAmount)
            .accountsPartial({
            creator: setup_1.user.publicKey,
            collection: collectionPDA,
            mint: mint,
            creatorTokenAccount: creatorTokenAccount,
            claimVault: claimVault,
            orcaLiquidityPool: orcaPoolTokenAccount,
            orcaProgram: orcaProgram,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([setup_1.user])
            .rpc();
        // Verify total supply increased by both amounts
        const mintInfoAfter = yield (0, spl_token_1.getMint)(setup_1.provider.connection, mint);
        const supplyAfter = Number(mintInfoAfter.supply);
        const totalMinted = firstMintAmount.toNumber() + secondMintAmount.toNumber();
        (0, chai_1.expect)(supplyAfter - supplyBefore).to.equal(totalMinted);
        // Verify creator received approximately 10% of total
        const creatorAccount = yield (0, spl_token_1.getAccount)(setup_1.provider.connection, creatorTokenAccount);
        const newCreatorBalance = Number(creatorAccount.amount);
        const creatorReceived = newCreatorBalance - creatorBalance;
        const expectedCreatorTotal = totalMinted * 0.1;
        // Allow for rounding differences
        (0, chai_1.expect)(creatorReceived).to.be.at.least(expectedCreatorTotal - 1000000);
        (0, chai_1.expect)(creatorReceived).to.be.at.most(expectedCreatorTotal + 1000000);
    }));
});
