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
exports.getPeerTrustStatePDA = exports.getAccessEscrowPDA = exports.getModeratorStakePDA = exports.getModTicketPDA = exports.getPerformerEscrowPDA = exports.getPinnerStatePDA = exports.getViewRightsPDA = exports.getMintPDA = exports.getCollectionPDA = exports.getUserAccountPDA = exports.getGlobalStatePDA = exports.oracleFeed = exports.capgmMint = exports.treasury = exports.moderator = exports.performer = exports.pinner = exports.user = exports.admin = exports.program = exports.provider = void 0;
exports.setupAccounts = setupAccounts;
exports.accountExists = accountExists;
exports.mintExistsAndValid = mintExistsAndValid;
exports.ensureProtocolInitialized = ensureProtocolInitialized;
exports.ensureUserAccountInitialized = ensureUserAccountInitialized;
exports.ensureCollectionExists = ensureCollectionExists;
exports.airdropAndConfirm = airdropAndConfirm;
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
// Configure the client to use the local cluster
exports.provider = anchor.AnchorProvider.env();
anchor.setProvider(exports.provider);
exports.program = anchor.workspace.SolanaProgram;
// Test accounts - exported for use across test files
exports.admin = web3_js_1.Keypair.generate();
exports.user = web3_js_1.Keypair.generate();
exports.pinner = web3_js_1.Keypair.generate();
exports.performer = web3_js_1.Keypair.generate();
exports.moderator = web3_js_1.Keypair.generate();
exports.treasury = web3_js_1.Keypair.generate();
exports.capgmMint = web3_js_1.Keypair.generate();
exports.oracleFeed = web3_js_1.Keypair.generate();
// Setup: Airdrop SOL to test accounts
function setupAccounts() {
    return __awaiter(this, void 0, void 0, function* () {
        const airdropAmount = 10 * web3_js_1.LAMPORTS_PER_SOL;
        yield Promise.all([
            exports.provider.connection.requestAirdrop(exports.admin.publicKey, airdropAmount),
            exports.provider.connection.requestAirdrop(exports.user.publicKey, airdropAmount),
            exports.provider.connection.requestAirdrop(exports.pinner.publicKey, airdropAmount),
            exports.provider.connection.requestAirdrop(exports.performer.publicKey, airdropAmount),
            exports.provider.connection.requestAirdrop(exports.moderator.publicKey, airdropAmount),
            exports.provider.connection.requestAirdrop(exports.treasury.publicKey, airdropAmount),
        ]);
        // Wait for confirmations
        yield new Promise(resolve => setTimeout(resolve, 1000));
    });
}
// PDA derivation helpers
const getGlobalStatePDA = () => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("global_state")], exports.program.programId);
};
exports.getGlobalStatePDA = getGlobalStatePDA;
const getUserAccountPDA = (authority) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("user_account"), authority.toBuffer()], exports.program.programId);
};
exports.getUserAccountPDA = getUserAccountPDA;
const getCollectionPDA = (owner, collectionId) => {
    // Ensure collectionId doesn't exceed 32 bytes for PDA seed
    const collectionIdBuffer = Buffer.from(collectionId);
    const truncatedId = collectionIdBuffer.length > 32
        ? collectionIdBuffer.slice(0, 32)
        : collectionIdBuffer;
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("collection"), owner.toBuffer(), truncatedId], exports.program.programId);
};
exports.getCollectionPDA = getCollectionPDA;
const getMintPDA = (collection) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("mint"), collection.toBuffer()], exports.program.programId);
};
exports.getMintPDA = getMintPDA;
const getViewRightsPDA = (payer, collection) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("view_right"), payer.toBuffer(), collection.toBuffer()], exports.program.programId);
};
exports.getViewRightsPDA = getViewRightsPDA;
const getPinnerStatePDA = (pinner, collection) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("host_bond"), pinner.toBuffer(), collection.toBuffer()], exports.program.programId);
};
exports.getPinnerStatePDA = getPinnerStatePDA;
const getPerformerEscrowPDA = (collection) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("performer_escrow"), collection.toBuffer()], exports.program.programId);
};
exports.getPerformerEscrowPDA = getPerformerEscrowPDA;
const getModTicketPDA = (targetId) => {
    // Ensure targetId doesn't exceed 32 bytes for PDA seed
    const targetIdBuffer = Buffer.from(targetId);
    const truncatedId = targetIdBuffer.length > 32
        ? targetIdBuffer.slice(0, 32)
        : targetIdBuffer;
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("ticket"), truncatedId], exports.program.programId);
};
exports.getModTicketPDA = getModTicketPDA;
const getModeratorStakePDA = (moderator) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("moderator_stake"), moderator.toBuffer()], exports.program.programId);
};
exports.getModeratorStakePDA = getModeratorStakePDA;
const getAccessEscrowPDA = (purchaser, collection) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("access_escrow"), purchaser.toBuffer(), collection.toBuffer()], exports.program.programId);
};
exports.getAccessEscrowPDA = getAccessEscrowPDA;
const getPeerTrustStatePDA = (peerWallet) => {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("peer_trust"), peerWallet.toBuffer()], exports.program.programId);
};
exports.getPeerTrustStatePDA = getPeerTrustStatePDA;
// Helper to check if an account exists
function accountExists(accountPubkey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const accountInfo = yield exports.provider.connection.getAccountInfo(accountPubkey);
            return accountInfo !== null;
        }
        catch (_a) {
            return false;
        }
    });
}
// Helper to check if a mint account exists and is valid
function mintExistsAndValid(mintPubkey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const accountInfo = yield exports.provider.connection.getAccountInfo(mintPubkey);
            if (!accountInfo || accountInfo.data.length === 0) {
                return false;
            }
            // Try to parse as mint - if it fails, the account is invalid
            const { getMint } = yield Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
            yield getMint(exports.provider.connection, mintPubkey);
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
// Helper to initialize protocol if not already initialized
function ensureProtocolInitialized() {
    return __awaiter(this, void 0, void 0, function* () {
        const [globalStatePDA] = (0, exports.getGlobalStatePDA)();
        const exists = yield accountExists(globalStatePDA);
        if (!exists) {
            const { SystemProgram } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
            const { INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS } = yield Promise.resolve().then(() => __importStar(require("./constants")));
            yield exports.program.methods
                .initializeProtocol(INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS)
                .accountsPartial({
                admin: exports.admin.publicKey,
                globalState: globalStatePDA,
                treasury: exports.treasury.publicKey,
                capgmMint: exports.capgmMint.publicKey,
                systemProgram: SystemProgram.programId,
            })
                .signers([exports.admin])
                .rpc();
        }
    });
}
// Helper to initialize user account if not already initialized
function ensureUserAccountInitialized(userKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const [userAccountPDA] = (0, exports.getUserAccountPDA)(userKey.publicKey);
        const exists = yield accountExists(userAccountPDA);
        if (!exists) {
            const { SystemProgram } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
            const { IPNS_KEY } = yield Promise.resolve().then(() => __importStar(require("./constants")));
            yield exports.program.methods
                .initializeUserAccount(IPNS_KEY)
                .accountsPartial({
                authority: userKey.publicKey,
                userAccount: userAccountPDA,
                systemProgram: SystemProgram.programId,
            })
                .signers([userKey])
                .rpc();
        }
    });
}
// Helper to ensure collection exists, handling invalid mint accounts
function ensureCollectionExists(owner, collectionId, collectionName, contentCid, accessThresholdUsd) {
    return __awaiter(this, void 0, void 0, function* () {
        const [collectionPDA] = (0, exports.getCollectionPDA)(owner, collectionId);
        const [mintPDA] = (0, exports.getMintPDA)(collectionPDA);
        // Check if collection exists
        const collectionExists = yield accountExists(collectionPDA);
        if (collectionExists) {
            return collectionPDA;
        }
        // Check if mint exists and is valid
        const mintValid = yield mintExistsAndValid(mintPDA);
        if (mintValid) {
            // Mint exists and is valid, but collection doesn't - this shouldn't happen
            // Try to create collection anyway - init_if_needed should handle it
        }
        else if (yield accountExists(mintPDA)) {
            // Mint exists but is invalid - we need to close it first
            // This is complex, so for now we'll just try to create the collection
            // and let init_if_needed handle it (it should fail gracefully)
        }
        // Create collection
        const { SystemProgram, SYSVAR_RENT_PUBKEY } = yield Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = yield Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        try {
            yield exports.program.methods
                .createCollection(collectionId, collectionName, contentCid, accessThresholdUsd)
                .accountsPartial({
                owner: owner,
                collection: collectionPDA,
                oracleFeed: exports.oracleFeed.publicKey,
                mint: mintPDA,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
            })
                .rpc();
        }
        catch (err) {
            // If it fails due to invalid mint, we might need to handle it differently
            // For now, just throw the error
            throw err;
        }
        return collectionPDA;
    });
}
// Helper to airdrop and wait for confirmation
function airdropAndConfirm(publicKey_1) {
    return __awaiter(this, arguments, void 0, function* (publicKey, amount = 2 * 1e9) {
        var _a, _b;
        // Check if already has sufficient balance
        let currentBalance = yield exports.provider.connection.getBalance(publicKey);
        if (currentBalance >= amount) {
            return; // Already has enough
        }
        // Request airdrop
        let sig;
        try {
            sig = yield exports.provider.connection.requestAirdrop(publicKey, amount);
        }
        catch (e) {
            // If airdrop request fails, wait and retry
            yield new Promise(resolve => setTimeout(resolve, 1000));
            sig = yield exports.provider.connection.requestAirdrop(publicKey, amount);
        }
        // Get latest blockhash for confirmation
        const latestBlockhash = yield exports.provider.connection.getLatestBlockhash('confirmed');
        // Wait for confirmation - poll both signature status and balance
        let balance = 0;
        let confirmed = false;
        for (let i = 0; i < 60; i++) {
            // Check balance first (faster and more reliable)
            balance = yield exports.provider.connection.getBalance(publicKey);
            if (balance >= amount) {
                // Balance is sufficient, verify signature status
                try {
                    const status = yield exports.provider.connection.getSignatureStatus(sig);
                    if (((_a = status === null || status === void 0 ? void 0 : status.value) === null || _a === void 0 ? void 0 : _a.confirmationStatus) === 'confirmed' ||
                        ((_b = status === null || status === void 0 ? void 0 : status.value) === null || _b === void 0 ? void 0 : _b.confirmationStatus) === 'finalized' ||
                        status === null) { // null means finalized and removed from recent
                        confirmed = true;
                        break;
                    }
                }
                catch (e) {
                    // If we have balance, that's good enough
                    if (balance >= amount) {
                        confirmed = true;
                        break;
                    }
                }
            }
            // Wait before next check
            yield new Promise(resolve => setTimeout(resolve, 250));
        }
        // If still not confirmed, try confirming explicitly
        if (!confirmed || balance < amount) {
            try {
                yield exports.provider.connection.confirmTransaction({
                    signature: sig,
                    blockhash: latestBlockhash.blockhash,
                    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
                }, 'confirmed');
                yield new Promise(resolve => setTimeout(resolve, 1000));
                balance = yield exports.provider.connection.getBalance(publicKey);
            }
            catch (e) {
                // Continue to check balance
            }
        }
        // Final check - if still 0, try one more airdrop
        balance = yield exports.provider.connection.getBalance(publicKey);
        if (balance < amount) {
            // Last resort: try one more airdrop
            try {
                const sig2 = yield exports.provider.connection.requestAirdrop(publicKey, amount);
                const latestBlockhash2 = yield exports.provider.connection.getLatestBlockhash('confirmed');
                // Wait longer for second attempt
                for (let i = 0; i < 40; i++) {
                    yield new Promise(resolve => setTimeout(resolve, 300));
                    balance = yield exports.provider.connection.getBalance(publicKey);
                    if (balance >= amount) {
                        break;
                    }
                }
                // Try to confirm explicitly
                if (balance < amount) {
                    yield exports.provider.connection.confirmTransaction({
                        signature: sig2,
                        blockhash: latestBlockhash2.blockhash,
                        lastValidBlockHeight: latestBlockhash2.lastValidBlockHeight
                    }, 'confirmed');
                    yield new Promise(resolve => setTimeout(resolve, 2000));
                    balance = yield exports.provider.connection.getBalance(publicKey);
                }
            }
            catch (e) {
                // Ignore errors, check balance one more time
                balance = yield exports.provider.connection.getBalance(publicKey);
            }
            if (balance < amount) {
                // One final check after longer wait
                yield new Promise(resolve => setTimeout(resolve, 3000));
                balance = yield exports.provider.connection.getBalance(publicKey);
                if (balance < amount) {
                    throw new Error(`Failed to airdrop ${amount} lamports to ${publicKey.toString()} - balance is ${balance} after all retries (need at least ${amount})`);
                }
            }
        }
        // Extra safety: wait a bit more to ensure transaction can use the funds
        yield new Promise(resolve => setTimeout(resolve, 300));
        // Final verification
        const finalCheck = yield exports.provider.connection.getBalance(publicKey);
        if (finalCheck < amount) {
            throw new Error(`Airdrop verification failed for ${publicKey.toString()} - balance is ${finalCheck} (need at least ${amount})`);
        }
    });
}
