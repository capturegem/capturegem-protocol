// library-source/libs/types.ts

/**
 * Shared TypeScript types for CaptureGem Protocol
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ============================================================================
// On-Chain Account Types (match Rust structs)
// ============================================================================

export interface CollectionState {
  owner: PublicKey;
  collectionId: string;
  name: string;
  mint: PublicKey;
  contentCid: string; // Legacy - now empty
  cidHash: Uint8Array; // SHA-256 hash of collection CID
  accessThresholdUsd: BN;
  totalSupply: BN;
  claimVaultBalance: BN;
  bump: number;
}

export interface AccessEscrow {
  purchaser: PublicKey;
  collection: PublicKey;
  accessNftMint: PublicKey; // Non-transferable Token-2022 NFT
  cidHash: Uint8Array; // SHA-256 hash for verification
  amountLocked: BN;
  createdAt: BN;
  isCidRevealed: boolean;
  bump: number;
}

export interface CidReveal {
  escrow: PublicKey;
  pinner: PublicKey;
  encryptedCid: Uint8Array; // X25519-XSalsa20-Poly1305 encrypted
  revealedAt: BN;
  bump: number;
}

export interface CollectionStakingPool {
  collection: PublicKey;
  totalStaked: BN;
  rewardRate: BN;
  lastUpdateTime: BN;
  rewardPerTokenStored: BN;
  bump: number;
}

export interface StakerPosition {
  staker: PublicKey;
  pool: PublicKey;
  stakedAmount: BN;
  rewardPerTokenPaid: BN;
  rewardsEarned: BN;
  stakedAt: BN;
  bump: number;
}

export interface PeerTrustState {
  peer: PublicKey;
  trustScore: number; // 0-100
  successfulDeliveries: BN;
  failedDeliveries: BN;
  totalRewardsEarned: BN;
  lastDeliveryTime: BN;
  bump: number;
}

// ============================================================================
// IPFS & Collection Types
// ============================================================================

export interface CollectionManifest {
  collection_id: string;
  version: number;
  created_at: string; // ISO 8601
  videos: VideoMetadata[];
}

export interface VideoMetadata {
  title: string;
  description?: string;
  cid: string; // IPFS CID of the video file
  duration: number; // Seconds
  thumbnail_cid?: string;
  tags?: string[];
  created_at?: string;
}

// ============================================================================
// Client Library Types
// ============================================================================

export interface PurchaseResult {
  accessEscrow: PublicKey;
  accessNftMint: PublicKey;
  transaction: string;
  collectionId: string;
}

export interface RevealedCID {
  cid: string;
  verified: boolean; // Hash matches on-chain commitment
  pinner: PublicKey;
  revealedAt: Date;
}

export interface PurchaseNotification {
  accessEscrow: PublicKey;
  purchaser: PublicKey;
  collection: PublicKey;
  collectionId: string;
  cidHash: Uint8Array;
  createdAt: Date;
  isCidRevealed: boolean;
}

export interface NFTVerificationResult {
  valid: boolean;
  reason?: string;
  cached: boolean;
}

export interface AccessProofMessage {
  wallet_address: string;
  collection_id: string;
  access_nft_mint: string;
  timestamp: number; // Unix timestamp
  signature: string; // Base64 encoded
}

// ============================================================================
// Cryptographic Types
// ============================================================================

export interface EncryptionKeypair {
  publicKey: Uint8Array; // X25519 public key
  secretKey: Uint8Array; // X25519 secret key
}

export interface EncryptedData {
  nonce: Uint8Array; // 24 bytes for XSalsa20
  ciphertext: Uint8Array;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ClientConfig {
  programId: PublicKey;
  rpcUrl: string;
  commitment?: "processed" | "confirmed" | "finalized";
}

export interface PinnerConfig extends ClientConfig {
  collections: PinnerCollectionConfig[];
  nftCacheExpirySeconds?: number;
  monitoringInterval?: number; // Milliseconds
}

export interface PinnerCollectionConfig {
  collectionId: string;
  collectionPubkey: PublicKey;
  cid: string; // The actual IPFS CID
  autoReveal?: boolean;
}

export interface AccessClientConfig extends ClientConfig {
  ipfsGateway?: string;
  revelationTimeoutMs?: number;
  revelationPollIntervalMs?: number;
}

// ============================================================================
// Event Types (for indexers and monitoring)
// ============================================================================

export interface CollectionCreatedEvent {
  owner: PublicKey;
  collection: PublicKey;
  collectionId: string;
  name: string;
  mint: PublicKey;
  cidHash: Uint8Array;
  timestamp: Date;
}

export interface AccessPurchasedEvent {
  purchaser: PublicKey;
  collection: PublicKey;
  accessEscrow: PublicKey;
  accessNftMint: PublicKey;
  amount: BN;
  cidHash: Uint8Array;
  timestamp: Date;
}

export interface CIDRevealedEvent {
  pinner: PublicKey;
  accessEscrow: PublicKey;
  cidReveal: PublicKey;
  encryptedCidLength: number;
  timestamp: Date;
}

export interface EscrowReleasedEvent {
  purchaser: PublicKey;
  accessEscrow: PublicKey;
  amount: BN;
  recipient: "purchaser" | "creator";
  timestamp: Date;
}

// ============================================================================
// Utility Types
// ============================================================================

export type Cluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";

export interface TokenAccount {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amount: BN;
  programId: PublicKey;
}

export interface CollectionInfo {
  state: CollectionState;
  publicKey: PublicKey;
  stakingPool?: CollectionStakingPool;
  totalStakers?: number;
  currentPrice?: BN; // From Orca pool
}

// ============================================================================
// Error Types
// ============================================================================

export class CIDVerificationError extends Error {
  constructor(
    message: string,
    public expectedHash: Uint8Array,
    public actualCid: string
  ) {
    super(message);
    this.name = "CIDVerificationError";
  }
}

export class EncryptionError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = "EncryptionError";
  }
}

export class NFTVerificationError extends Error {
  constructor(
    message: string,
    public reason: string,
    public proofMessage?: AccessProofMessage
  ) {
    super(message);
    this.name = "NFTVerificationError";
  }
}

export class RevelationTimeoutError extends Error {
  constructor(
    message: string,
    public accessEscrow: PublicKey,
    public timeoutMs: number
  ) {
    super(message);
    this.name = "RevelationTimeoutError";
  }
}

