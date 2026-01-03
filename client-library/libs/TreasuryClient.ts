// client-library/libs/TreasuryClient.ts
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { WalletManager, RiskLevel } from "./WalletManager";
import { SolanaProgram } from "../../solana-program/target/types/solana_program";
import { PDAUtils } from "./PDAUtils";

/**
 * TreasuryClient - Utility client for treasury-related operations
 * 
 * Note: Fee harvesting functionality has been removed. Pinners receive payment
 * directly when purchasers release escrow funds via the release_escrow instruction.
 */
export class TreasuryClient {
  program: anchor.Program<SolanaProgram>;
  walletManager: WalletManager;
  connection: anchor.web3.Connection;

  constructor(
    program: anchor.Program<SolanaProgram>,
    walletManager: WalletManager,
    connection: anchor.web3.Connection
  ) {
    this.program = program;
    this.walletManager = walletManager;
    this.connection = connection;
  }


  /**
   * Get fee vault balance
   * 
   * @param feeVault - Token account to check
   * @returns Balance in base units
   */
  async getFeeVaultBalance(feeVault: PublicKey): Promise<bigint> {
    const accountInfo = await this.connection.getTokenAccountBalance(feeVault);
    return BigInt(accountInfo.value.amount);
  }
}

