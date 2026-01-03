// library-source/index.ts

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

