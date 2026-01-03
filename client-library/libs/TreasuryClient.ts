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
 * TreasuryClient - Handles fee harvesting and distribution
 * 
 * This client manages the collection fee harvesting process:
 * - Harvests withheld fees from Token-2022 accounts
 * - Distributes fees according to 50/20/20/10 split:
 *   - 50% to Pinners (via reward pool)
 *   - 20% to Collection Owner
 *   - 20% to Performer Escrow
 *   - 10% to Staker Treasury
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
   * Harvest fees from Token-2022 withheld fees
   * 
   * This instruction:
   * 1. Reads the actual fee_vault balance (prevents infinite reward exploit)
   * 2. Transfers tokens to destination accounts BEFORE updating balances
   * 3. Updates reward balances only after successful transfers
   * 
   * ⚠️ SECURITY: Only collection owner or protocol admin can call this
   * 
   * @param collectionPubkey - The collection to harvest fees for
   * @param feeVault - Token account containing harvested fees (must be owned by collection PDA)
   * @param ownerTokenAccount - Owner's token account to receive 20% of fees
   * @param performerEscrowTokenAccount - Performer escrow token account to receive 20% of fees
   * @param stakerTreasury - Treasury account to receive 10% of fees
   * @returns Transaction signature
   */
  async harvestFees(
    collectionPubkey: PublicKey,
    feeVault: PublicKey,
    ownerTokenAccount: PublicKey,
    performerEscrowTokenAccount: PublicKey,
    stakerTreasury: PublicKey
  ): Promise<string> {
    const authority = this.walletManager.getActivePublicKey();

    // Fetch collection to verify authority and get mint
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );

    // Verify authority: must be collection owner or protocol admin
    const globalState = await this.program.account.globalState.fetch(
      PDAUtils.deriveGlobalState(this.program.programId)[0]
    );

    if (
      !authority.equals(collectionState.owner) &&
      !authority.equals(globalState.admin)
    ) {
      throw new Error(
        "Unauthorized: Only collection owner or protocol admin can harvest fees"
      );
    }

    // Derive PDAs
    const [performerEscrowPDA] = PDAUtils.derivePerformerEscrow(
      collectionPubkey,
      this.program.programId
    );

    const [globalStatePDA] = PDAUtils.deriveGlobalState(
      this.program.programId
    );

    // Verify fee_vault has tokens
    const feeVaultAccountInfo = await this.connection.getAccountInfo(feeVault);
    if (!feeVaultAccountInfo) {
      throw new Error("Fee vault account does not exist");
    }

    // Build harvest transaction
    // Note: collection and performerEscrow are PDAs that Anchor will resolve automatically
    // We use accountsPartial to let Anchor resolve PDAs while we provide explicit accounts
    const tx = await this.program.methods
      .harvestFees()
      .accountsPartial({
        authority,
        mint: collectionState.mint,
        feeVault: feeVault,
        ownerTokenAccount,
        performerEscrowTokenAccount,
        stakerTreasury,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Fees harvested! Transaction: ${tx}`);
    console.log(`   Collection: ${collectionPubkey.toBase58()}`);
    console.log(`   Fee Vault: ${feeVault.toBase58()}`);

    return tx;
  }

  /**
   * Convenience method: Harvest fees with auto-derived accounts
   * 
   * Automatically derives:
   * - Performer escrow PDA
   * - Global state PDA
   * - Owner token account (if not provided)
   * 
   * @param collectionPubkey - The collection to harvest fees for
   * @param feeVault - Token account containing harvested fees
   * @param options - Optional accounts (will be derived if not provided)
   * @returns Transaction signature
   */
  async harvestFeesAuto(
    collectionPubkey: PublicKey,
    feeVault: PublicKey,
    options?: {
      ownerTokenAccount?: PublicKey;
      performerEscrowTokenAccount?: PublicKey;
      stakerTreasury?: PublicKey;
    }
  ): Promise<string> {
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );
    const authority = this.walletManager.getActivePublicKey();

    // Derive owner token account if not provided
    const ownerTokenAccount =
      options?.ownerTokenAccount ??
      getAssociatedTokenAddressSync(
        collectionState.mint,
        collectionState.owner,
        false,
        TOKEN_2022_PROGRAM_ID
      );

    // Derive performer escrow token account if not provided
    const [performerEscrowPDA] = PDAUtils.derivePerformerEscrow(
      collectionPubkey,
      this.program.programId
    );
    const performerEscrowTokenAccount =
      options?.performerEscrowTokenAccount ??
      getAssociatedTokenAddressSync(
        collectionState.mint,
        performerEscrowPDA,
        false,
        TOKEN_2022_PROGRAM_ID
      );

    // Get staker treasury from global state if not provided
    const [globalStatePDA] = PDAUtils.deriveGlobalState(
      this.program.programId
    );
    const globalState = await this.program.account.globalState.fetch(
      globalStatePDA
    );
    const stakerTreasury =
      options?.stakerTreasury ??
      getAssociatedTokenAddressSync(
        collectionState.mint,
        globalState.treasury,
        false,
        TOKEN_2022_PROGRAM_ID
      );

    return this.harvestFees(
      collectionPubkey,
      feeVault,
      ownerTokenAccount,
      performerEscrowTokenAccount,
      stakerTreasury
    );
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

