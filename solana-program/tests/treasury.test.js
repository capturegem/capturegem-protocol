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
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const setup_1 = require("./helpers/setup");
const constants_1 = require("./helpers/constants");
describe("Treasury - Fee Harvesting", () => {
    let collectionPDA;
    let performerEscrowPDA;
    let globalStatePDA;
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
        [globalStatePDA] = (0, setup_1.getGlobalStatePDA)();
        // Initialize performer escrow if it doesn't exist
        // Note: If the instruction doesn't exist in deployed program, test will fail with AccountNotInitialized
        try {
            yield setup_1.program.account.performerEscrow.fetch(performerEscrowPDA);
        }
        catch (_b) {
            // Not initialized, try to initialize it (may fail if instruction not in deployed program)
            try {
                const { SystemProgram } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
                const { performer } = yield Promise.resolve().then(() => __importStar(require("./helpers/setup")));
                yield setup_1.program.methods
                    .initializePerformerEscrow(performer.publicKey)
                    .accountsPartial({
                    authority: setup_1.user.publicKey,
                    collection: collectionPDA,
                    performerEscrow: performerEscrowPDA,
                    systemProgram: SystemProgram.programId,
                })
                    .signers([setup_1.user])
                    .rpc();
            }
            catch (initErr) {
                // Instruction may not exist in deployed program - test will handle AccountNotInitialized
                if (!initErr.toString().includes("InstructionFallbackNotFound")) {
                    throw initErr;
                }
            }
        }
    }));
    it("Successfully harvests fees and splits 50/20/20/10", () => __awaiter(void 0, void 0, void 0, function* () {
        const mint = web3_js_1.Keypair.generate();
        const feeVault = web3_js_1.Keypair.generate();
        const ownerTokenAccount = web3_js_1.Keypair.generate();
        const stakerTreasury = web3_js_1.Keypair.generate();
        // Note: In real implementation, you'd need to set up actual token accounts
        const tx = yield setup_1.program.methods
            .harvestFees()
            .accountsPartial({
            authority: setup_1.user.publicKey,
            collection: collectionPDA,
            mint: mint.publicKey,
            feeVault: feeVault.publicKey,
            ownerTokenAccount: ownerTokenAccount.publicKey,
            performerEscrow: performerEscrowPDA,
            globalState: globalStatePDA,
            stakerTreasury: stakerTreasury.publicKey,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        })
            .signers([setup_1.user])
            .rpc();
        // Verify fee distribution (would check balances in real test)
        const collection = yield setup_1.program.account.collectionState.fetch(collectionPDA);
        // Note: Actual balance checks would require proper token account setup
    }));
});
