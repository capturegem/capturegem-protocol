// client-library/libs/StakingClient.ts

/**
 * StakingClient - Client library for collection token staking operations
 * 
 * Implements the staking mechanism where collection token holders can:
 * 1. Stake tokens to earn passive rewards
 * 2. Earn proportional rewards from access purchases (50% of purchase flows to stakers)
 * 3. Claim accumulated rewards
 * 4. Unstake tokens
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { SolanaProgram } from "../../solana-program/target/types/solana_program";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

/**
 * Staking pool information with computed fields
 */
export interface StakingPoolInfo {
  collection: PublicKey;
  totalStaked: BN;
  rewardPerToken: BN;
  totalStakers: number;
  apy?: number; // Annual Percentage Yield (estimated)
}

/**
 * Staker position information
 */
export interface StakerPositionInfo {
  staker: PublicKey;
  collection: PublicKey;
  amountStaked: BN;
  rewardDebt: BN;
  pendingRewards?: BN; // Computed from current pool state
}

/**
 * Stake operation result
 */
export interface StakeResult {
  transaction: string;
  stakerPosition: PublicKey;
  amountStaked: BN;
  newTotalStaked: BN;
}

/**
 * Unstake operation result
 */
export interface UnstakeResult {
  transaction: string;
  amountUnstaked: BN;
  rewardsClaimed: BN;
  positionClosed: boolean;
}

/**
 * Claim rewards result
 */
export interface ClaimResult {
  transaction: string;
  rewardsClaimed: BN;
}

export class StakingClient {
  constructor(
    private program: Program<SolanaProgram>,
    private connection: Connection,
    private provider: AnchorProvider
  ) {}

  /**
   * Stake collection tokens to earn rewards
   * Creates or updates a staker position
   * 
   * @param collectionPubkey - The collection to stake tokens for
   * @param amount - Amount of collection tokens to stake
   * @param stakerKeypair - Staker's keypair
   * @returns Stake result with transaction signature
   */
  async stakeCollectionTokens(
    collectionPubkey: PublicKey,
    amount: BN,
    stakerKeypair: Keypair
  ): Promise<StakeResult> {
    console.log(`🔒 Staking ${amount.toString()} collection tokens...`);

    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );

    // Derive staking pool PDA
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    // Derive staker position PDA
    const [stakerPositionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker_position"),
        stakerKeypair.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      this.program.programId
    );

    // Get token accounts
    const stakerTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakerKeypair.publicKey
    );

    const poolTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakingPoolPDA,
      true // Allow PDA owner
    );

    // Check if staker position already exists
    let positionExists = false;
    try {
      await this.program.account.stakerPosition.fetch(stakerPositionPDA);
      positionExists = true;
    } catch {
      // Position doesn't exist yet
    }

    console.log(`   Staker: ${stakerKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);
    console.log(`   Amount: ${amount.toString()}`);
    console.log(`   Position exists: ${positionExists}`);

    // Build stake transaction
    const tx = await this.program.methods
      .stakeCollectionTokens(amount)
      .accountsPartial({
        staker: stakerKeypair.publicKey,
        collection: collectionPubkey,
        stakingPool: stakingPoolPDA,
        stakerPosition: stakerPositionPDA,
        stakerTokenAccount,
        poolTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([stakerKeypair])
      .rpc();

    // Fetch updated pool state
    const updatedPool = await this.program.account.collectionStakingPool.fetch(stakingPoolPDA);

    console.log(`✅ Tokens staked! Transaction: ${tx}`);
    console.log(`   New total staked: ${updatedPool.totalStaked.toString()}`);

    return {
      transaction: tx,
      stakerPosition: stakerPositionPDA,
      amountStaked: amount,
      newTotalStaked: updatedPool.totalStaked,
    };
  }

  /**
   * Unstake collection tokens and claim pending rewards
   * 
   * @param collectionPubkey - The collection to unstake from
   * @param amount - Amount to unstake (or full amount if not specified)
   * @param stakerKeypair - Staker's keypair
   * @returns Unstake result with rewards claimed
   */
  async unstakeCollectionTokens(
    collectionPubkey: PublicKey,
    amount: BN | null,
    stakerKeypair: Keypair
  ): Promise<UnstakeResult> {
    console.log(`🔓 Unstaking collection tokens...`);

    // Derive staking pool PDA
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    // Derive staker position PDA
    const [stakerPositionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker_position"),
        stakerKeypair.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      this.program.programId
    );

    // Get current position
    const position = await this.program.account.stakerPosition.fetch(stakerPositionPDA);

    // If amount not specified, unstake everything
    const unstakeAmount = amount || position.amountStaked;

    console.log(`   Staked amount: ${position.amountStaked.toString()}`);
    console.log(`   Unstaking: ${unstakeAmount.toString()}`);
    
    // Calculate pending rewards
    const pool = await this.program.account.collectionStakingPool.fetch(stakingPoolPDA);
    const pendingRewards = this.calculatePendingRewards(position, pool);
    console.log(`   Pending rewards: ${pendingRewards.toString()}`);

    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );

    // Get token accounts
    const stakerTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakerKeypair.publicKey
    );

    const poolTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakingPoolPDA,
      true
    );

    // Build unstake transaction
    const tx = await this.program.methods
      .unstakeCollectionTokens(unstakeAmount)
      .accountsPartial({
        staker: stakerKeypair.publicKey,
        collection: collectionPubkey,
        stakingPool: stakingPoolPDA,
        stakerPosition: stakerPositionPDA,
        stakerTokenAccount,
        poolTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stakerKeypair])
      .rpc();

    // Check if position is fully closed
    const positionClosed = unstakeAmount.gte(position.amountStaked);

    console.log(`✅ Tokens unstaked! Transaction: ${tx}`);
    console.log(`   Amount unstaked: ${unstakeAmount.toString()}`);
    console.log(`   Rewards claimed: ${pendingRewards.toString()}`);
    console.log(`   Position closed: ${positionClosed}`);

    return {
      transaction: tx,
      amountUnstaked: unstakeAmount,
      rewardsClaimed: pendingRewards,
      positionClosed,
    };
  }

  /**
   * Claim staking rewards without unstaking
   * 
   * @param collectionPubkey - The collection to claim rewards from
   * @param stakerKeypair - Staker's keypair
   * @returns Claim result with rewards amount
   */
  async claimStakingRewards(
    collectionPubkey: PublicKey,
    stakerKeypair: Keypair
  ): Promise<ClaimResult> {
    console.log(`💰 Claiming staking rewards...`);

    // Derive staking pool PDA
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    // Derive staker position PDA
    const [stakerPositionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker_position"),
        stakerKeypair.publicKey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      this.program.programId
    );

    // Get current position and pool
    const position = await this.program.account.stakerPosition.fetch(stakerPositionPDA);
    const pool = await this.program.account.collectionStakingPool.fetch(stakingPoolPDA);
    
    const pendingRewards = this.calculatePendingRewards(position, pool);
    console.log(`   Pending rewards: ${pendingRewards.toString()}`);

    if (pendingRewards.lte(new BN(0))) {
      console.log(`⚠️  No rewards to claim`);
      throw new Error("No rewards available to claim");
    }

    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );

    // Get token accounts
    const stakerTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakerKeypair.publicKey
    );

    const poolTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      stakingPoolPDA,
      true
    );

    // Build claim transaction
    const tx = await this.program.methods
      .claimStakingRewards()
      .accountsPartial({
        staker: stakerKeypair.publicKey,
        collection: collectionPubkey,
        stakingPool: stakingPoolPDA,
        stakerPosition: stakerPositionPDA,
        stakerTokenAccount,
        poolTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stakerKeypair])
      .rpc();

    console.log(`✅ Rewards claimed! Transaction: ${tx}`);
    console.log(`   Amount: ${pendingRewards.toString()}`);

    return {
      transaction: tx,
      rewardsClaimed: pendingRewards,
    };
  }

  /**
   * Get staker position information
   * 
   * @param stakerPubkey - Staker's public key
   * @param collectionPubkey - Collection public key
   * @returns Staker position info with pending rewards
   */
  async getStakerPosition(
    stakerPubkey: PublicKey,
    collectionPubkey: PublicKey
  ): Promise<StakerPositionInfo | null> {
    // Derive staking pool PDA
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    // Derive staker position PDA
    const [stakerPositionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker_position"),
        stakerPubkey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      this.program.programId
    );

    try {
      const position = await this.program.account.stakerPosition.fetch(stakerPositionPDA);
      const pool = await this.program.account.collectionStakingPool.fetch(stakingPoolPDA);

      // Calculate pending rewards
      const pendingRewards = this.calculatePendingRewards(position, pool);

      return {
        staker: position.staker,
        collection: position.collection,
        amountStaked: position.amountStaked,
        rewardDebt: position.rewardDebt,
        pendingRewards,
      };
    } catch {
      return null; // Position doesn't exist
    }
  }

  /**
   * Get staking pool information
   * 
   * @param collectionPubkey - Collection public key
   * @returns Staking pool info
   */
  async getStakingPoolInfo(collectionPubkey: PublicKey): Promise<StakingPoolInfo> {
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    const pool = await this.program.account.collectionStakingPool.fetch(stakingPoolPDA);

    // Count total stakers
    const allPositions = await this.program.account.stakerPosition.all([
      {
        memcmp: {
          offset: 8 + 32, // Skip discriminator + staker pubkey
          bytes: collectionPubkey.toBase58(),
        },
      },
    ]);

    return {
      collection: pool.collection,
      totalStaked: pool.totalStaked,
      rewardPerToken: pool.rewardPerToken,
      totalStakers: allPositions.length,
    };
  }

  /**
   * Get all staker positions for a collection
   * 
   * @param collectionPubkey - Collection public key
   * @returns Array of staker positions
   */
  async getAllStakerPositions(
    collectionPubkey: PublicKey
  ): Promise<StakerPositionInfo[]> {
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    const pool = await this.program.account.collectionStakingPool.fetch(stakingPoolPDA);

    const allPositions = await this.program.account.stakerPosition.all([
      {
        memcmp: {
          offset: 8 + 32,
          bytes: collectionPubkey.toBase58(),
        },
      },
    ]);

    return allPositions.map(p => {
      const position = p.account as any;
      const pendingRewards = this.calculatePendingRewards(position, pool);

      return {
        staker: position.staker,
        collection: position.collection,
        amountStaked: position.amountStaked,
        rewardDebt: position.rewardDebt,
        pendingRewards,
      };
    });
  }

  /**
   * Calculate pending rewards for a staker position
   * Uses the reward_per_token mechanism
   * 
   * Formula: pending = (amountStaked * rewardPerToken) - rewardDebt
   * 
   * @param position - Staker position account
   * @param pool - Staking pool account
   * @returns Pending rewards amount
   */
  private calculatePendingRewards(position: any, pool: any): BN {
    // rewardPerToken is u128, amountStaked is u64, rewardDebt is u128
    // We need to handle the precision correctly
    const rewardPerToken = new BN(pool.rewardPerToken.toString());
    const amountStaked = new BN(position.amountStaked.toString());
    const rewardDebt = new BN(position.rewardDebt.toString());
    
    // Calculate: (amountStaked * rewardPerToken) - rewardDebt
    // Note: rewardPerToken is scaled, so we need to divide by precision
    const totalRewards = amountStaked.mul(rewardPerToken).div(new BN(1e12)); // REWARD_PRECISION is typically 1e12
    return totalRewards.sub(rewardDebt);
  }

  /**
   * Estimate APY for a collection staking pool
   * Based on recent reward distribution rate
   * 
   * @param collectionPubkey - Collection public key
   * @returns Estimated APY as percentage (e.g., 15.5 = 15.5%)
   */
  async estimateAPY(collectionPubkey: PublicKey): Promise<number> {
    const poolInfo = await this.getStakingPoolInfo(collectionPubkey);

    if (poolInfo.totalStaked.eq(new BN(0))) {
      return 0;
    }

    // Convert reward per token to annual yield estimate
    // This is a simplified calculation - actual APY depends on purchase frequency
    // Note: rewardPerToken is a u128 scaled value, so we need to handle it carefully
    // For now, return 0 as APY calculation requires more complex logic
    // TODO: Implement proper APY calculation based on historical reward distribution
    return 0;
  }
}

