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
Object.defineProperty(exports, "__esModule", { value: true });
exports.REASON = exports.TARGET_ID = exports.ACCESS_THRESHOLD_USD = exports.CONTENT_CID = exports.COLLECTION_NAME = exports.COLLECTION_ID = exports.IPNS_KEY = exports.FEE_BASIS_POINTS = exports.MOD_STAKE_MIN = exports.REGISTRY_URL = exports.INDEXER_URL = void 0;
const anchor = __importStar(require("@coral-xyz/anchor"));
// Test constants
exports.INDEXER_URL = "https://indexer.example.com";
exports.REGISTRY_URL = "https://registry.example.com";
exports.MOD_STAKE_MIN = new anchor.BN(10000);
exports.FEE_BASIS_POINTS = 1000; // 10%
exports.IPNS_KEY = "k51qzi5uqu5dtest123";
exports.COLLECTION_ID = "test-collection-1";
exports.COLLECTION_NAME = "Test Collection";
exports.CONTENT_CID = "QmTest123";
exports.ACCESS_THRESHOLD_USD = new anchor.BN(1000); // $10.00 in cents
exports.TARGET_ID = "target-123";
exports.REASON = "Test reason";
