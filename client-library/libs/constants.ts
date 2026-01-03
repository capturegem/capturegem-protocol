// client-library/libs/constants.ts

/**
 * Constants for CaptureGem Protocol Client Library
 */

import { PublicKey } from "@solana/web3.js";

// ============================================================================
// Program & Network Constants
// ============================================================================

/** Devnet Program ID */
export const CAPTUREGEM_PROGRAM_ID_DEVNET = new PublicKey(
  "YOUR_DEVNET_PROGRAM_ID"
);

/** Mainnet Program ID */
export const CAPTUREGEM_PROGRAM_ID_MAINNET = new PublicKey(
  "YOUR_MAINNET_PROGRAM_ID"
);

// ============================================================================
// PDA Seeds (must match Rust constants)
// ============================================================================

export const SEED_COLLECTION = "collection";
export const SEED_ACCESS_ESCROW = "access_escrow";
export const SEED_STAKING_POOL = "staking_pool";
export const SEED_STAKER_POSITION = "staker_position";
export const SEED_PEER_TRUST = "peer_trust";
export const SEED_CID_REVEAL = "cid_reveal";

// ============================================================================
// Timeouts & Intervals
// ============================================================================

/** Default timeout for CID revelation (5 minutes) */
export const DEFAULT_REVELATION_TIMEOUT_MS = 5 * 60 * 1000;

/** Default polling interval for checking CID revelation (2 seconds) */
export const DEFAULT_REVELATION_POLL_INTERVAL_MS = 2 * 1000;

/** Default NFT verification cache expiry (30 seconds) */
export const DEFAULT_NFT_CACHE_EXPIRY_SECONDS = 30;

/** Maximum age for access proof timestamps (5 minutes) */
export const MAX_ACCESS_PROOF_AGE_SECONDS = 5 * 60;

/** Default monitoring interval for pinner client (5 seconds) */
export const DEFAULT_MONITORING_INTERVAL_MS = 5 * 1000;

// ============================================================================
// IPFS Constants
// ============================================================================

/** Default IPFS gateway */
export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/** Alternative IPFS gateways for redundancy */
export const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
];

/** Maximum collection manifest size (1 MB) */
export const MAX_MANIFEST_SIZE_BYTES = 1024 * 1024;

// ============================================================================
// Cryptographic Constants
// ============================================================================

/** Length of X25519 public key (32 bytes) */
export const X25519_PUBLIC_KEY_LENGTH = 32;

/** Length of X25519 secret key (32 bytes) */
export const X25519_SECRET_KEY_LENGTH = 32;

/** Length of XSalsa20 nonce (24 bytes) */
export const XSALSA20_NONCE_LENGTH = 24;

/** Length of SHA-256 hash (32 bytes) */
export const SHA256_HASH_LENGTH = 32;

/** Length of Poly1305 MAC tag (16 bytes) */
export const POLY1305_TAG_LENGTH = 16;

/** Maximum encrypted CID size (200 bytes - matches Rust) */
export const MAX_ENCRYPTED_CID_LENGTH = 200;

// ============================================================================
// Token Constants
// ============================================================================

/** Token-2022 Program ID */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** SPL Token Program ID */
export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// ============================================================================
// Account Size Constants (must match Rust)
// ============================================================================

/** CollectionState account size */
export const COLLECTION_STATE_SIZE = 8 + 32 + 64 + 64 + 32 + 256 + 32 + 8 + 8 + 8 + 1;

/** AccessEscrow account size */
export const ACCESS_ESCROW_SIZE = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1;

/** CidReveal account size */
export const CID_REVEAL_SIZE = 8 + 32 + 32 + 4 + 200 + 8 + 1;

/** StakingPool account size */
export const STAKING_POOL_SIZE = 8 + 32 + 8 + 8 + 8 + 8 + 1;

/** StakerPosition account size */
export const STAKER_POSITION_SIZE = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1;

/** PeerTrustState account size */
export const PEER_TRUST_STATE_SIZE = 8 + 32 + 2 + 8 + 8 + 8 + 8 + 1;

// ============================================================================
// Economic Constants
// ============================================================================

/** Percentage of purchase amount that goes to staking pool (50%) */
export const STAKING_POOL_PERCENTAGE = 0.5;

/** Percentage of purchase amount that goes to escrow (50%) */
export const ESCROW_PERCENTAGE = 0.5;

/** Escrow expiration time (7 days in seconds) */
export const ESCROW_EXPIRATION_SECONDS = 7 * 24 * 60 * 60;

/** Minimum trust score for pinners (0-100) */
export const MIN_PINNER_TRUST_SCORE = 50;

// ============================================================================
// RPC & Connection Constants
// ============================================================================

/** Default commitment level for transactions */
export const DEFAULT_COMMITMENT = "confirmed" as const;

/** Default preflight commitment */
export const DEFAULT_PREFLIGHT_COMMITMENT = "processed" as const;

/** Maximum retries for failed transactions */
export const MAX_TRANSACTION_RETRIES = 3;

/** Transaction confirmation timeout (60 seconds) */
export const TRANSACTION_CONFIRMATION_TIMEOUT_MS = 60 * 1000;

// ============================================================================
// Validation Constants
// ============================================================================

/** Maximum collection ID length */
export const MAX_COLLECTION_ID_LENGTH = 64;

/** Maximum collection name length */
export const MAX_COLLECTION_NAME_LENGTH = 64;

/** Maximum IPFS CID length (base58 encoded) */
export const MAX_IPFS_CID_LENGTH = 64;

/** Minimum access threshold in USD (prevents spam) */
export const MIN_ACCESS_THRESHOLD_USD = 1;

/** Maximum access threshold in USD */
export const MAX_ACCESS_THRESHOLD_USD = 10000;

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  ENCRYPTION_FAILED: "Failed to encrypt CID",
  DECRYPTION_FAILED: "Failed to decrypt CID - invalid keys or corrupted ciphertext",
  HASH_MISMATCH: "CID verification failed - hash mismatch",
  INVALID_SIGNATURE: "Invalid access proof signature",
  TIMESTAMP_TOO_OLD: "Access proof timestamp too old (> 5 minutes)",
  NFT_NOT_OWNED: "Purchaser does not own the Access NFT",
  COLLECTION_NOT_FOUND: "Collection not found",
  REVELATION_TIMEOUT: "Timeout waiting for CID revelation",
  ALREADY_REVEALED: "CID already revealed for this purchase",
  INVALID_CID: "Invalid IPFS CID format",
  MANIFEST_TOO_LARGE: "Collection manifest exceeds maximum size",
  RPC_ERROR: "RPC request failed",
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get program ID for the specified cluster
 */
export function getProgramId(cluster: "devnet" | "mainnet-beta"): PublicKey {
  return cluster === "mainnet-beta"
    ? CAPTUREGEM_PROGRAM_ID_MAINNET
    : CAPTUREGEM_PROGRAM_ID_DEVNET;
}

/**
 * Get RPC URL for the specified cluster
 */
export function getRpcUrl(cluster: "devnet" | "mainnet-beta" | "localnet"): string {
  switch (cluster) {
    case "mainnet-beta":
      return "https://api.mainnet-beta.solana.com";
    case "devnet":
      return "https://api.devnet.solana.com";
    case "localnet":
      return "http://localhost:8899";
  }
}

/**
 * Check if a CID is valid (basic format check)
 */
export function isValidCID(cid: string): boolean {
  // Basic validation - should start with Qm for CIDv0 or b for CIDv1
  return (
    (cid.startsWith("Qm") && cid.length === 46) ||
    (cid.startsWith("b") && cid.length > 40)
  );
}

/**
 * Check if collection ID is valid
 */
export function isValidCollectionId(collectionId: string): boolean {
  return (
    collectionId.length > 0 &&
    collectionId.length <= MAX_COLLECTION_ID_LENGTH &&
    /^[a-z0-9-_]+$/.test(collectionId)
  );
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Calculate escrow expiration timestamp
 */
export function calculateEscrowExpiration(createdAt: number): number {
  return createdAt + ESCROW_EXPIRATION_SECONDS;
}

/**
 * Check if escrow has expired
 */
export function isEscrowExpired(createdAt: number, currentTime?: number): boolean {
  const now = currentTime || Math.floor(Date.now() / 1000);
  return now > calculateEscrowExpiration(createdAt);
}

