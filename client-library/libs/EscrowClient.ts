// client-library/libs/EscrowClient.ts

/**
 * EscrowClient - Client library for managing access escrow operations
 * 
 * Handles:
 * 1. Releasing escrowed funds to pinners after content delivery
 * 2. Burning expired escrows (24-hour deflationary mechanism)
 * 3. Updating peer trust scores
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { SolanaProgram } from "../../solana-program/target/types/solana_program";

/**
 * Pinner payment distribution
 */
export interface PinnerDistribution {
  pinner: PublicKey;
  weight: number; // Relative weight (e.g., bytes delivered)
}

/**
 * Peer performance report from IPFS Trust Monitor
 */
export interface PeerPerformanceReport {
  peerWallet: PublicKey;
  bytesDelivered: number;
  latencyMs: number;
  successful: boolean;
}

/**
 * Escrow release result
 */
export interface EscrowReleaseResult {
  transaction: string;
  amountReleased: BN;
  recipientCount: number;
  trustScoresUpdated: boolean;
}

export class EscrowClient {
  constructor(
    private program: Program<SolanaProgram>,
    private connection: Connection,
    private provider: AnchorProvider
  ) {}

  /**
   * Release escrowed funds to pinners after content delivery
   * This is the core "Trust-Based Payment" mechanism
   * 
   * @param accessEscrowPubkey - The AccessEscrow PDA
   * @param pinnerDistribution - Array of pinners and their payment weights
   * @param purchaserKeypair - Purchaser's keypair (only they can release)
   * @returns Release result with transaction signature
   */
  async releaseEscrowToPinners(
    accessEscrowPubkey: PublicKey,
    pinnerDistribution: PinnerDistribution[],
    purchaserKeypair: Keypair
  ): Promise<EscrowReleaseResult> {
    console.log("💰 Releasing escrow to pinners...");
    
    // Validate that purchaser owns this escrow
    const escrowAccount = await this.program.account.accessEscrow.fetch(
      accessEscrowPubkey
    );
    
    if (!escrowAccount.purchaser.equals(purchaserKeypair.publicKey)) {
      throw new Error("Only the purchaser can release escrow funds");
    }
    
    // Validate distribution weights
    const totalWeight = pinnerDistribution.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) {
      throw new Error("Total weight must be greater than 0");
    }
    
    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      escrowAccount.collection
    );
    
    // Get escrow token account
    const escrowTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      accessEscrowPubkey,
      true // Allow PDA owner
    );
    
    // Prepare pinner accounts and weights
    const pinnerPubkeys = pinnerDistribution.map(p => p.pinner);
    const weights = pinnerDistribution.map(p => p.weight);
    
    // Derive PeerTrustState PDAs for each pinner
    const peerTrustPDAs = pinnerPubkeys.map(pinner => {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("peer_trust"), pinner.toBuffer()],
        this.program.programId
      );
      return pda;
    });
    
    // Get pinner token accounts
    const pinnerTokenAccounts = await Promise.all(
      pinnerPubkeys.map(pinner =>
        getAssociatedTokenAddress(collectionState.mint, pinner)
      )
    );
    
    console.log(`📊 Distributing to ${pinnerPubkeys.length} pinners`);
    console.log(`   Total weight: ${totalWeight}`);
    pinnerDistribution.forEach((p, i) => {
      const percentage = ((p.weight / totalWeight) * 100).toFixed(2);
      console.log(`   ${i + 1}. ${p.pinner.toBase58().slice(0, 8)}... (${percentage}%)`);
    });
    
    // Build release transaction
    const tx = await this.program.methods
      .releaseEscrow(
        pinnerPubkeys,
        weights.map(w => new BN(w))
      )
      .accounts({
        purchaser: purchaserKeypair.publicKey,
        escrowTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      // Add remaining accounts for pinners and their trust states
      .remainingAccounts([
        ...pinnerTokenAccounts.map(account => ({
          pubkey: account,
          isWritable: true,
          isSigner: false,
        })),
        ...peerTrustPDAs.map(pda => ({
          pubkey: pda,
          isWritable: true,
          isSigner: false,
        })),
      ])
      .signers([purchaserKeypair])
      .rpc();
    
    console.log(`✅ Escrow released! Transaction: ${tx}`);
    
    return {
      transaction: tx,
      amountReleased: escrowAccount.amountLocked,
      recipientCount: pinnerPubkeys.length,
      trustScoresUpdated: true,
    };
  }

  /**
   * Burn expired escrow (permissionless, callable by anyone)
   * Implements the 24-hour deflationary mechanism
   * 
   * @param accessEscrowPubkey - The AccessEscrow PDA to burn
   * @param callerKeypair - Any keypair (permissionless)
   * @returns Transaction signature
   */
  async burnExpiredEscrow(
    accessEscrowPubkey: PublicKey,
    callerKeypair: Keypair
  ): Promise<string> {
    console.log("🔥 Burning expired escrow...");
    
    // Fetch escrow
    const escrowAccount = await this.program.account.accessEscrow.fetch(
      accessEscrowPubkey
    );
    
    // Check if expired (24 hours = 86400 seconds)
    const currentTime = Math.floor(Date.now() / 1000);
    const createdAt = escrowAccount.createdAt.toNumber();
    const expiryTime = createdAt + 86400; // 24 hours
    
    if (currentTime < expiryTime) {
      const timeRemaining = expiryTime - currentTime;
      throw new Error(
        `Escrow not yet expired. Time remaining: ${Math.floor(timeRemaining / 3600)} hours`
      );
    }
    
    console.log(`   Created: ${new Date(createdAt * 1000).toISOString()}`);
    console.log(`   Expired: ${new Date(expiryTime * 1000).toISOString()}`);
    console.log(`   Amount to burn: ${escrowAccount.amountLocked.toString()} tokens`);
    
    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      escrowAccount.collection
    );
    
    // Get escrow token account
    const escrowTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      accessEscrowPubkey,
      true // Allow PDA owner
    );
    
    // Build burn transaction
    const tx = await this.program.methods
      .burnExpiredEscrow()
      .accounts({
        caller: callerKeypair.publicKey,
        escrowTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([callerKeypair])
      .rpc();
    
    console.log(`✅ Escrow burned! Transaction: ${tx}`);
    console.log(`   Deflationary effect: -${escrowAccount.amountLocked.toString()} tokens`);
    
    return tx;
  }

  /**
   * Calculate pinner distribution from peer performance reports
   * Helper method to convert IPFS performance data to payment weights
   * 
   * @param performanceReports - Reports from IPFS Trust Monitor
   * @returns Distribution array ready for releaseEscrowToPinners
   */
  calculatePinnerDistribution(
    performanceReports: PeerPerformanceReport[]
  ): PinnerDistribution[] {
    // Filter only successful deliveries
    const successful = performanceReports.filter(r => r.successful && r.bytesDelivered > 0);
    
    if (successful.length === 0) {
      throw new Error("No successful peer deliveries to distribute payment to");
    }
    
    // Use bytes delivered as weight
    return successful.map(report => ({
      pinner: report.peerWallet,
      weight: report.bytesDelivered,
    }));
  }

  /**
   * Check if an escrow is expired
   * 
   * @param accessEscrowPubkey - The AccessEscrow PDA
   * @returns true if expired (> 24 hours old)
   */
  async isEscrowExpired(accessEscrowPubkey: PublicKey): Promise<boolean> {
    const escrowAccount = await this.program.account.accessEscrow.fetch(
      accessEscrowPubkey
    );
    
    const currentTime = Math.floor(Date.now() / 1000);
    const createdAt = escrowAccount.createdAt.toNumber();
    const expiryTime = createdAt + 86400; // 24 hours
    
    return currentTime >= expiryTime;
  }

  /**
   * Get escrow details
   * 
   * @param accessEscrowPubkey - The AccessEscrow PDA
   * @returns Escrow account data with computed fields
   */
  async getEscrowDetails(accessEscrowPubkey: PublicKey): Promise<{
    escrow: any;
    isExpired: boolean;
    timeRemainingSeconds: number;
    expiryDate: Date;
  }> {
    const escrowAccount = await this.program.account.accessEscrow.fetch(
      accessEscrowPubkey
    );
    
    const currentTime = Math.floor(Date.now() / 1000);
    const createdAt = escrowAccount.createdAt.toNumber();
    const expiryTime = createdAt + 86400;
    const timeRemaining = Math.max(0, expiryTime - currentTime);
    
    return {
      escrow: escrowAccount,
      isExpired: currentTime >= expiryTime,
      timeRemainingSeconds: timeRemaining,
      expiryDate: new Date(expiryTime * 1000),
    };
  }

  /**
   * Find all expired escrows (for batch burning)
   * 
   * @returns Array of expired escrow public keys
   */
  async findExpiredEscrows(): Promise<PublicKey[]> {
    const allEscrows = await this.program.account.accessEscrow.all();
    const currentTime = Math.floor(Date.now() / 1000);
    
    const expired = allEscrows.filter(escrow => {
      const createdAt = escrow.account.createdAt.toNumber();
      const expiryTime = createdAt + 86400;
      return currentTime >= expiryTime;
    });
    
    console.log(`Found ${expired.length} expired escrows out of ${allEscrows.length} total`);
    
    return expired.map(e => e.publicKey);
  }
}

