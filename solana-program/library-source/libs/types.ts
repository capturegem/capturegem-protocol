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
// NEW: Escrow & Payment Types
// ============================================================================

export interface PinnerDistribution {
  pinner: PublicKey;
  weight: number;
}

export interface PeerPerformanceReport {
  peerWallet: PublicKey;
  peerId?: string;
  bytesDelivered: number;
  blocksDelivered?: number;
  latencyMs: number;
  throughputMBps?: number;
  successful: boolean;
  startTime?: Date;
  endTime?: Date;
  errors?: string[];
}

export interface EscrowReleaseResult {
  transaction: string;
  amountReleased: BN;
  recipientCount: number;
  trustScoresUpdated: boolean;
}

// ============================================================================
// NEW: Staking Types
// ============================================================================

export interface StakingPoolInfo {
  collection: PublicKey;
  totalStaked: BN;
  rewardRate: BN;
  lastUpdateTime: BN;
  rewardPerTokenStored: BN;
  totalStakers: number;
  apy?: number;
}

export interface StakerPositionInfo {
  staker: PublicKey;
  pool: PublicKey;
  stakedAmount: BN;
  rewardPerTokenPaid: BN;
  rewardsEarned: BN;
  stakedAt: BN;
  pendingRewards?: BN;
}

export interface StakeResult {
  transaction: string;
  stakerPosition: PublicKey;
  amountStaked: BN;
  newTotalStaked: BN;
}

export interface UnstakeResult {
  transaction: string;
  amountUnstaked: BN;
  rewardsClaimed: BN;
  positionClosed: boolean;
}

export interface ClaimResult {
  transaction: string;
  rewardsClaimed: BN;
}

// ============================================================================
// NEW: Moderation Types
// ============================================================================

export interface OffChainProof {
  originalUploadUrl?: string;
  socialMediaProfile?: string;
  timestampProof?: string;
  additionalEvidence?: string[];
  description: string;
}

export interface CopyrightClaim {
  collection: PublicKey;
  claimant: PublicKey;
  proofHash: Uint8Array;
  submittedAt: BN;
  status: "pending" | "approved" | "rejected";
  moderator?: PublicKey;
  resolvedAt?: BN;
}

export interface ContentReport {
  collection: PublicKey;
  reporter: PublicKey;
  reason: string;
  category: "illegal" | "copyright" | "tos_violation" | "spam";
  submittedAt: BN;
  status: "pending" | "approved" | "rejected";
  moderator?: PublicKey;
}

export interface ClaimSubmissionResult {
  transaction: string;
  claimPDA: PublicKey;
  proofHash: Uint8Array;
}

// ============================================================================
// NEW: IPFS Trust Monitor Types
// ============================================================================

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  percentage: number;
  peerContributions: Map<string, number>;
  startTime: Date;
  elapsedMs: number;
}

export interface ProofOfDelivery {
  cid: string;
  totalBytes: number;
  downloadDurationMs: number;
  peerReports: PeerPerformanceReport[];
  pinners: PublicKey[];
  weights: number[];
  timestamp: Date;
}

export interface PeerMapping {
  peerId: string;
  walletAddress: PublicKey;
  multiaddr?: string;
}

// ============================================================================
// IPFS & Collection Types
// ============================================================================

/**
 * Collection Manifest - The master catalog stored on IPFS
 * 
 * This document contains the complete catalog of all videos in a collection.
 * The CID of this manifest is hashed (SHA-256) and stored on-chain in CollectionState.
 * Only after purchasing access is the real CID revealed to the buyer.
 * 
 * Schema Version: 1.0
 */
export interface CollectionManifest {
  /** Protocol schema version for forward compatibility */
  schema_version: number;
  
  /** Unique collection identifier (matches on-chain collectionId) */
  collection_id: string;
  
  /** Human-readable collection name */
  name: string;
  
  /** Collection description/bio */
  description?: string;
  
  /** Creator/performer information */
  creator: CreatorMetadata;
  
  /** ISO 8601 timestamp of manifest creation */
  created_at: string;
  
  /** ISO 8601 timestamp of last manifest update */
  updated_at?: string;
  
  /** Total number of videos in collection */
  total_videos: number;
  
  /** Total duration of all videos in seconds */
  total_duration_seconds: number;
  
  /** Array of video entries with full metadata */
  videos: VideoMetadata[];
  
  /** Collection-level tags/categories */
  tags?: string[];
  
  /** Cover image CID for collection */
  cover_image_cid?: string;
  
  /** Trailer/preview video CID (accessible without purchase) */
  preview_cid?: string;
  
  /** Content rating (e.g., "explicit", "adult") */
  content_rating: ContentRating;
  
  /** Additional custom metadata */
  custom_metadata?: Record<string, any>;
}

/**
 * Creator/Performer metadata
 */
export interface CreatorMetadata {
  /** On-chain wallet address */
  wallet_address?: string;
  
  /** Stage name/username */
  username: string;
  
  /** Display name */
  display_name?: string;
  
  /** Creator bio */
  bio?: string;
  
  /** Profile picture CID */
  avatar_cid?: string;
  
  /** Social media links */
  social_links?: {
    twitter?: string;
    instagram?: string;
    onlyfans?: string;
    website?: string;
    [key: string]: string | undefined;
  };
  
  /** Verification status */
  verified?: boolean;
}

/**
 * Individual video metadata within a collection
 */
export interface VideoMetadata {
  /** Unique identifier within the collection */
  video_id: string;
  
  /** Video title */
  title: string;
  
  /** Video description */
  description?: string;
  
  /** IPFS CID of the video file */
  cid: string;
  
  /** Duration in seconds */
  duration_seconds: number;
  
  /** ISO 8601 timestamp of when video was recorded */
  recorded_at: string;
  
  /** ISO 8601 timestamp of when video was uploaded */
  uploaded_at?: string;
  
  /** Performer username (stage name) */
  performer_username: string;
  
  /** Additional performers if applicable */
  additional_performers?: string[];
  
  /** Video technical specifications */
  technical_specs: VideoTechnicalSpecs;
  
  /** Thumbnail image CID */
  thumbnail_cid?: string;
  
  /** Preview clip CID (short sample) */
  preview_clip_cid?: string;
  
  /** Video-specific tags */
  tags?: string[];
  
  /** Content warnings */
  content_warnings?: string[];
  
  /** File size in bytes */
  file_size_bytes?: number;
  
  /** File format (e.g., "mp4", "webm") */
  file_format?: string;
  
  /** Custom metadata for this video */
  custom_metadata?: Record<string, any>;
}

/**
 * Video technical specifications
 */
export interface VideoTechnicalSpecs {
  /** Video resolution (e.g., "1920x1080", "3840x2160") */
  resolution: VideoResolution;
  
  /** Frame rate (e.g., 30, 60) */
  fps?: number;
  
  /** Video codec (e.g., "h264", "h265", "vp9") */
  codec?: string;
  
  /** Bitrate in kbps */
  bitrate_kbps?: number;
  
  /** Is this a VR/360 video? */
  is_vr: boolean;
  
  /** VR format if applicable */
  vr_format?: VRFormat;
  
  /** Stereo mode for VR */
  vr_stereo_mode?: VRStereoMode;
  
  /** Audio codec */
  audio_codec?: string;
  
  /** Audio bitrate in kbps */
  audio_bitrate_kbps?: number;
  
  /** HDR support */
  hdr?: boolean;
}

/**
 * Standard video resolutions
 */
export type VideoResolution =
  | "720x480"    // SD
  | "1280x720"   // HD / 720p
  | "1920x1080"  // Full HD / 1080p
  | "2560x1440"  // QHD / 1440p
  | "3840x2160"  // 4K / UHD
  | "7680x4320"  // 8K
  | string;      // Custom resolution

/**
 * VR video formats
 */
export type VRFormat =
  | "equirectangular"  // 360° video
  | "cubemap"          // 6-face cube mapping
  | "dome"             // 180° dome
  | "fisheye"          // Fisheye lens
  | string;            // Custom format

/**
 * VR stereo modes
 */
export type VRStereoMode =
  | "mono"             // Single view
  | "side-by-side"     // Left/right eye side by side
  | "top-bottom"       // Left/right eye stacked
  | "anaglyph"         // Red/cyan 3D
  | string;            // Custom mode

/**
 * Content rating system
 */
export type ContentRating =
  | "explicit"         // Adult/sexual content
  | "mature"           // Mature themes
  | "general"          // General audiences
  | string;            // Custom rating

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

