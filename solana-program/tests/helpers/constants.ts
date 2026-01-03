import * as anchor from "@coral-xyz/anchor";

// Test constants
export const INDEXER_URL = "https://indexer.example.com";
export const REGISTRY_URL = "https://registry.example.com";
export const MOD_STAKE_MIN = new anchor.BN(10000);
export const FEE_BASIS_POINTS = 1000; // 10%
export const IPNS_KEY = "k51qzi5uqu5dtest123";
export const COLLECTION_ID = "test-collection-1";
export const COLLECTION_NAME = "Test Collection";
export const CONTENT_CID = "QmTest123";
export const ACCESS_THRESHOLD_USD = new anchor.BN(1000); // $10.00 in cents
export const TARGET_ID = "target-123";
export const REASON = "Test reason";
