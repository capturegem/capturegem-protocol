// client-library/index.ts

/**
 * CaptureGem Protocol - Client Library
 * 
 * Main entry point for the TypeScript client library
 */

// Core clients
export { OrcaClient } from "./libs/OrcaClient";
export { ProtocolClient } from "./libs/ProtocolClient";
export { WalletManager, RiskLevel } from "./libs/WalletManager";
export { IpfsManager } from "./libs/IpfsManager";
export { IndexerClient } from "./libs/IndexerClient";
export { AccessClient } from "./libs/AccessClient";
export { PinnerClient } from "./libs/PinnerClient";

// NEW: Economic clients
export { EscrowClient } from "./libs/EscrowClient";
export { StakingClient } from "./libs/StakingClient";

// NEW: Moderation client
export { ModerationClient } from "./libs/ModerationClient";

// NEW: Infrastructure clients
export { IPFSTrustMonitor } from "./libs/IPFSTrustMonitor";

// NEW: Integrated workflows (high-level orchestration)
export { IntegratedWorkflow } from "./libs/IntegratedWorkflow";

// Crypto utilities
export * from "./libs/CryptoUtils";

// NEW: Collection Manifest utilities
export {
  CollectionManifestBuilder,
  VideoMetadataBuilder,
  createStandardVideoSpecs,
  createVRVideoSpecs,
  validateCollectionManifest,
  parseCollectionManifest,
  hashCollectionManifest,
  verifyManifestHash,
  MANIFEST_SCHEMA_VERSION,
} from "./libs/CollectionManifestBuilder";

// NEW: PDA utilities
export { PDAUtils } from "./libs/PDAUtils";

// Types
export * from "./libs/types";

// Constants
export * from "./libs/constants";

// Re-export useful types from dependencies
export type {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  Connection,
} from "@solana/web3.js";

export type { Program, BN, AnchorProvider } from "@coral-xyz/anchor";

// Re-export Orca types for convenience
export {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  TickUtil,
  PDAUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
} from "@orca-so/whirlpools-sdk";

export { Percentage } from "@orca-so/common-sdk";

