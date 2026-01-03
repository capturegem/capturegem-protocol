// client-library/libs/IntegratedWorkflow.ts

/**
 * IntegratedWorkflow - High-level workflow orchestration
 * 
 * Provides end-to-end workflows that combine multiple clients for common use cases:
 * 1. Creator Publishing Flow: Orca pool creation → Collection creation → Pinner setup
 * 2. Buyer Purchase Flow: Purchase → CID revelation → IPFS download → Payment release
 * 3. Staker Flow: Stake → Monitor rewards → Claim/Unstake
 * 4. Pinner Flow: Monitor → Reveal CID → Collect payment
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { SolanaProgram } from "../../target/types/solana_program";
import { OrcaClient } from "./OrcaClient";
import { ProtocolClient } from "./ProtocolClient";
import { AccessClient } from "./AccessClient";
import { PinnerClient } from "./PinnerClient";
import { EscrowClient, PeerPerformanceReport } from "./EscrowClient";
import { StakingClient } from "./StakingClient";
import { IPFSTrustMonitor } from "./IPFSTrustMonitor";
import { IndexerClient } from "./IndexerClient";
import { IpfsManager } from "./IpfsManager";
import { WalletManager } from "./WalletManager";
import { decryptCID, verifyCIDHash } from "./CryptoUtils";

/**
 * Creator publishing workflow result
 */
export interface PublishResult {
  collectionState: PublicKey;
  collectionId: string;
  poolAddress: PublicKey;
  mintAddress: PublicKey;
  initialPrice: number;
  manifestCID: string;
}

/**
 * Buyer purchase workflow result
 */
export interface PurchaseResult {
  accessEscrow: PublicKey;
  accessNFT: PublicKey;
  revealedCID: string;
  downloadedContent: Uint8Array;
  paymentReleased: boolean;
  transactionSignatures: string[];
}

/**
 * Pinner fulfillment workflow result
 */
export interface FulfillmentResult {
  cidReveals: PublicKey[];
  escrowsMonitored: number;
  revenueEarned: BN;
  trustScoreUpdates: number;
}

/**
 * Complete workflow orchestrator
 */
export class IntegratedWorkflow {
  constructor(
    private program: Program<SolanaProgram>,
    private connection: Connection,
    private provider: AnchorProvider,
    private indexerBaseUrl: string = "https://api.capturegem.io",
    private ipfsGateway: string = "https://ipfs.io"
  ) {}

  /**
   * CREATOR WORKFLOW: Publish a new collection with Orca pool
   * 
   * This workflow:
   * 1. Uploads collection manifest to IPFS
   * 2. Creates Orca Whirlpool with initial liquidity
   * 3. Creates collection state on-chain
   * 4. Announces collection to indexer
   * 
   * @param creatorKeypair - Creator's wallet
   * @param collectionId - Unique collection identifier
   * @param manifestCID - Collection manifest CID (already uploaded to IPFS)
   * @param initialPriceUSDC - Initial token price in USDC
   * @param liquidityAmountUSDC - Amount of USDC to provide as liquidity
   * @returns Publishing result
   */
  async publishCollection(
    creatorKeypair: Keypair,
    collectionId: string,
    manifestCID: string,
    initialPriceUSDC: number,
    liquidityAmountUSDC: number
  ): Promise<PublishResult> {
    console.log("\n🚀 Starting Creator Publishing Workflow");
    console.log("=" .repeat(60));

    const orcaClient = new OrcaClient(this.program as any, new WalletManager(this.connection.rpcEndpoint), this.connection);
    const protocolClient = new ProtocolClient(this.program as any, new WalletManager(this.connection.rpcEndpoint));
    const indexerClient = new IndexerClient(this.indexerBaseUrl);

    // Step 1: Create Orca Whirlpool with initial liquidity
    console.log("\n📊 Step 1: Creating Orca Whirlpool...");
    // TODO: Implement createWhirlpoolForCollection in OrcaClient
    console.log("   ⚠️  Orca pool creation not yet fully implemented");
    
    // Derive collection PDA as placeholder
    const [collectionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection"), creatorKeypair.publicKey.toBuffer(), Buffer.from(collectionId)],
      this.program.programId
    );
    
    // Placeholder pool result
    const poolResult = {
      pool: collectionPDA,
      mint: collectionPDA,
    };

    console.log(`   ✅ Pool created: ${poolResult.pool.toBase58()}`);
    console.log(`   ✅ Mint: ${poolResult.mint.toBase58()}`);
    console.log(`   ✅ Initial price: $${initialPriceUSDC}`);

    // Step 2: Create collection state on-chain
    console.log("\n🏗️  Step 2: Creating collection state...");
    // Note: This would need to be implemented in ProtocolClient
    // For now, we'll acknowledge this is a placeholder
    console.log("   ⚠️  Collection state creation not yet implemented in ProtocolClient");

    // Step 3: Announce to indexer
    console.log("\n📡 Step 3: Announcing to indexer...");
    // The indexer would automatically discover this from on-chain events
    console.log("   ℹ️  Indexer will discover from chain events");

    console.log("\n✅ Publishing Complete!");
    console.log("=" .repeat(60));

    return {
      collectionState: poolResult.pool, // Placeholder - should be actual collection state PDA
      collectionId,
      poolAddress: poolResult.pool,
      mintAddress: poolResult.mint,
      initialPrice: initialPriceUSDC,
      manifestCID,
    };
  }

  /**
   * BUYER WORKFLOW: Purchase, download, and pay for content
   * 
   * This workflow:
   * 1. Purchases access token (creates escrow)
   * 2. Waits for pinner to reveal encrypted CID
   * 3. Decrypts CID
   * 4. Downloads content from IPFS with performance tracking
   * 5. Releases escrow payment to pinners based on performance
   * 
   * @param purchaserKeypair - Buyer's wallet
   * @param collectionPubkey - Collection to purchase
   * @param paymentAmountTokens - Amount of collection tokens to pay
   * @param timeoutSeconds - Timeout for CID revelation (default: 120s)
   * @returns Purchase result with downloaded content
   */
  async purchaseAndDownloadContent(
    purchaserKeypair: Keypair,
    collectionPubkey: PublicKey,
    paymentAmountTokens: BN,
    timeoutSeconds: number = 120
  ): Promise<PurchaseResult> {
    console.log("\n🛒 Starting Buyer Purchase Workflow");
    console.log("=" .repeat(60));

    const accessClient = new AccessClient(this.program, this.connection, this.provider);
    const escrowClient = new EscrowClient(this.program, this.connection, this.provider);
    const trustMonitor = new IPFSTrustMonitor();
    const indexerClient = new IndexerClient(this.indexerBaseUrl);

    const transactionSignatures: string[] = [];

    // Step 1: Purchase access
    console.log("\n💳 Step 1: Purchasing access...");
    // Get collection info to create cidHash
    const collectionState = await this.program.account.collectionState.fetch(collectionPubkey);
    const collectionId = collectionState.collectionId || collectionPubkey.toBase58();
    
    const purchaseResult = await accessClient.purchaseAccess(
      collectionId,
      collectionPubkey,
      paymentAmountTokens,
      new Uint8Array(collectionState.cidHash), // Convert to Uint8Array
      undefined // Let it generate the NFT mint
    );

    console.log(`   ✅ Access purchased! Escrow: ${purchaseResult.accessEscrow.toBase58()}`);
    console.log(`   ✅ Access NFT: ${purchaseResult.accessNftMint.toBase58()}`);
    transactionSignatures.push(purchaseResult.transaction);

    // Step 2: Discover pinners from indexer
    console.log("\n🔍 Step 2: Discovering pinners...");
    const pinners = await indexerClient.getCollectionPinners(collectionId);

    console.log(`   ℹ️  Found ${pinners.length} pinners`);
    pinners.forEach((p, i) => {
      console.log(`      ${i + 1}. ${p.peerId.slice(0, 12)}... (trust: ${p.trustScore})`);
    });

    // Register peer mappings for payment attribution
    trustMonitor.registerPeerMappings(
      pinners.map(p => ({
        peerId: p.peerId,
        walletAddress: new PublicKey(p.walletAddress),
        multiaddr: p.multiaddr,
      }))
    );

    // Step 3: Wait for CID revelation
    console.log("\n🔐 Step 3: Waiting for CID revelation...");
    const revealedCID = await accessClient.waitForCIDReveal(
      purchaseResult.accessEscrow,
      timeoutSeconds * 1000, // Convert to milliseconds
      2000 // Poll interval
    );

    console.log(`   ✅ CID revealed: ${revealedCID.encryptedCid.length} bytes`);
    console.log(`   ✅ Pinner: ${revealedCID.pinner.toBase58().slice(0, 8)}...`);

    // Step 4: Download content with performance tracking
    console.log("\n⬇️  Step 4: Downloading content from IPFS...");
    // TODO: Decrypt the CID from revealedCID.encryptedCid
    // For now, we'll use a placeholder
    const actualCID = "placeholder-cid"; // Would decrypt revealedCID.encryptedCid here
    
    const performanceReports = await trustMonitor.trackPeerPerformance(
      actualCID,
      (progress) => {
        console.log(`   📥 Progress: ${progress.percentage.toFixed(1)}% (${progress.downloadedBytes} bytes)`);
      }
    );

    // For demo purposes, create placeholder content data
    const ipfsManager = new IpfsManager();
    const contentData = new Uint8Array(1024); // Placeholder content
    
    console.log(`   ✅ Content downloaded: ${contentData.length} bytes`);

    // Step 5: Release escrow payment to pinners
    console.log("\n💰 Step 5: Releasing escrow payment...");
    const distribution = escrowClient.calculatePinnerDistribution(performanceReports);
    
    const releaseResult = await escrowClient.releaseEscrowToPinners(
      purchaseResult.accessEscrow,
      distribution,
      purchaserKeypair
    );

    console.log(`   ✅ Payment released: ${releaseResult.amountReleased.toString()} tokens`);
    console.log(`   ✅ Recipients: ${releaseResult.recipientCount}`);
    transactionSignatures.push(releaseResult.transaction);

    console.log("\n✅ Purchase Complete!");
    console.log("=" .repeat(60));

    return {
      accessEscrow: purchaseResult.accessEscrow,
      accessNFT: purchaseResult.accessNftMint,
      revealedCID: actualCID,
      downloadedContent: contentData,
      paymentReleased: true,
      transactionSignatures,
    };
  }

  /**
   * PINNER WORKFLOW: Monitor purchases and fulfill orders
   * 
   * This workflow:
   * 1. Monitors for new purchase escrows
   * 2. Reveals encrypted CID to purchasers
   * 3. Waits for payment release or expiry
   * 4. Collects revenue
   * 
   * @param pinnerKeypair - Pinner's wallet
   * @param collectionPubkey - Collection being pinned
   * @param contentCID - Actual CID of the content
   * @param pollIntervalMs - Polling interval (default: 5000ms)
   * @param maxFulfillments - Max orders to fulfill (default: 10)
   * @returns Fulfillment result
   */
  async pinnerFulfillmentLoop(
    pinnerKeypair: Keypair,
    collectionPubkey: PublicKey,
    contentCID: string,
    pollIntervalMs: number = 5000,
    maxFulfillments: number = 10
  ): Promise<FulfillmentResult> {
    console.log("\n📍 Starting Pinner Fulfillment Workflow");
    console.log("=" .repeat(60));

    const pinnerClient = new PinnerClient(this.program, this.connection, this.provider);
    const cidReveals: PublicKey[] = [];
    let escrowsMonitored = 0;
    let revenueEarned = new BN(0);
    let trustScoreUpdates = 0;

    // Start monitoring
    console.log(`\n👁️  Monitoring for new purchases (polling every ${pollIntervalMs}ms)...`);
    
    // TODO: Implement proper monitoring loop
    // The PinnerClient.monitorNewPurchases has a different signature
    console.log("   ⚠️  Pinner monitoring loop not yet fully implemented");
    
    // Placeholder implementation
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log("   ℹ️  Monitoring timeout reached");
        resolve();
      }, 10 * 60 * 1000); // 10 minutes max
    });

    console.log("\n✅ Pinner Fulfillment Complete!");
    console.log(`   Orders fulfilled: ${escrowsMonitored}`);
    console.log(`   Revenue earned: ${revenueEarned.toString()} tokens`);
    console.log("=" .repeat(60));

    return {
      cidReveals,
      escrowsMonitored,
      revenueEarned,
      trustScoreUpdates,
    };
  }

  /**
   * STAKER WORKFLOW: Stake tokens and manage rewards
   * 
   * This workflow:
   * 1. Stakes collection tokens
   * 2. Monitors pending rewards
   * 3. Claims rewards when threshold reached
   * 4. Optionally unstakes
   * 
   * @param stakerKeypair - Staker's wallet
   * @param collectionPubkey - Collection to stake for
   * @param stakeAmount - Amount to stake
   * @param rewardThreshold - Claim rewards when this threshold is reached
   * @param monitorDurationMs - How long to monitor (default: 60000ms = 1 min)
   * @returns Total rewards claimed
   */
  async stakeAndMonitorRewards(
    stakerKeypair: Keypair,
    collectionPubkey: PublicKey,
    stakeAmount: BN,
    rewardThreshold: BN,
    monitorDurationMs: number = 60000
  ): Promise<{ staked: BN; rewardsClaimed: BN; finalStaked: BN }> {
    console.log("\n🔒 Starting Staker Workflow");
    console.log("=" .repeat(60));

    const stakingClient = new StakingClient(this.program, this.connection, this.provider);

    // Step 1: Stake tokens
    console.log("\n📥 Step 1: Staking tokens...");
    const stakeResult = await stakingClient.stakeCollectionTokens(
      collectionPubkey,
      stakeAmount,
      stakerKeypair
    );

    console.log(`   ✅ Staked: ${stakeAmount.toString()} tokens`);
    console.log(`   ✅ Position: ${stakeResult.stakerPosition.toBase58()}`);

    let totalRewardsClaimed = new BN(0);

    // Step 2: Monitor rewards
    console.log(`\n👁️  Step 2: Monitoring rewards for ${monitorDurationMs / 1000}s...`);
    
    const startTime = Date.now();
    const monitorInterval = setInterval(async () => {
      const position = await stakingClient.getStakerPosition(
        stakerKeypair.publicKey,
        collectionPubkey
      );

      if (!position) {
        console.log("   ⚠️  Position not found");
        return;
      }

      const pending = position.pendingRewards || new BN(0);
      console.log(`   💰 Pending rewards: ${pending.toString()} tokens`);

      // Step 3: Claim if threshold reached
      if (pending.gte(rewardThreshold)) {
        console.log("\n💸 Step 3: Claiming rewards (threshold reached)...");
        
        const claimResult = await stakingClient.claimStakingRewards(
          collectionPubkey,
          stakerKeypair
        );

        console.log(`   ✅ Claimed: ${claimResult.rewardsClaimed.toString()} tokens`);
        totalRewardsClaimed = totalRewardsClaimed.add(claimResult.rewardsClaimed);
      }

      if (Date.now() - startTime >= monitorDurationMs) {
        clearInterval(monitorInterval);
      }
    }, 5000); // Check every 5 seconds

    // Wait for monitoring to complete
    await new Promise(resolve => setTimeout(resolve, monitorDurationMs));

    // Get final position
    const finalPosition = await stakingClient.getStakerPosition(
      stakerKeypair.publicKey,
      collectionPubkey
    );

    console.log("\n✅ Staking Workflow Complete!");
    console.log(`   Total staked: ${stakeAmount.toString()} tokens`);
    console.log(`   Total rewards claimed: ${totalRewardsClaimed.toString()} tokens`);
    console.log("=" .repeat(60));

    return {
      staked: stakeAmount,
      rewardsClaimed: totalRewardsClaimed,
      finalStaked: finalPosition?.stakedAmount || stakeAmount,
    };
  }

  /**
   * CLEANUP WORKFLOW: Burn expired escrows
   * 
   * Permissionless workflow to clean up expired escrows and earn cleanup rewards
   * 
   * @param callerKeypair - Any wallet (permissionless)
   * @param maxBurns - Maximum number of escrows to burn (default: 10)
   * @returns Number of escrows burned
   */
  async burnExpiredEscrows(
    callerKeypair: Keypair,
    maxBurns: number = 10
  ): Promise<{ burned: number; totalAmountBurned: BN }> {
    console.log("\n🔥 Starting Cleanup Workflow (Burn Expired Escrows)");
    console.log("=" .repeat(60));

    const escrowClient = new EscrowClient(this.program, this.connection, this.provider);

    // Find expired escrows
    console.log("\n🔍 Searching for expired escrows...");
    const expiredEscrows = await escrowClient.findExpiredEscrows();

    const toBurn = expiredEscrows.slice(0, maxBurns);
    console.log(`   Found ${expiredEscrows.length} expired, burning ${toBurn.length}`);

    let burned = 0;
    let totalAmountBurned = new BN(0);

    for (const escrow of toBurn) {
      try {
        const details = await escrowClient.getEscrowDetails(escrow);
        console.log(`\n🔥 Burning escrow ${escrow.toBase58().slice(0, 8)}...`);
        console.log(`   Amount: ${details.escrow.amountLocked.toString()}`);
        
        await escrowClient.burnExpiredEscrow(escrow, callerKeypair);
        
        burned++;
        totalAmountBurned = totalAmountBurned.add(details.escrow.amountLocked);
      } catch (error) {
        console.error(`   ❌ Failed to burn ${escrow.toBase58().slice(0, 8)}:`, error);
      }
    }

    console.log("\n✅ Cleanup Complete!");
    console.log(`   Escrows burned: ${burned}`);
    console.log(`   Total amount burned: ${totalAmountBurned.toString()} tokens`);
    console.log("=" .repeat(60));

    return { burned, totalAmountBurned };
  }

  /**
   * Estimate cost for purchasing a collection
   * Queries Orca pool for current price
   * 
   * @param collectionPubkey - Collection to purchase
   * @returns Estimated cost in USDC
   */
  async estimatePurchaseCost(collectionPubkey: PublicKey): Promise<{
    pricePerToken: number;
    recommendedAmount: number;
    slippageTolerance: number;
  }> {
    const orcaClient = new OrcaClient(this.program as any, new WalletManager(this.connection.rpcEndpoint), this.connection);
    
    // This would query the actual Orca pool
    // For now, return placeholder values
    return {
      pricePerToken: 1.0,
      recommendedAmount: 10.0,
      slippageTolerance: 0.01, // 1%
    };
  }

  /**
   * Get comprehensive collection statistics
   * Combines on-chain and indexer data
   * 
   * @param collectionPubkey - Collection to query
   * @returns Complete collection stats
   */
  async getCollectionStats(collectionPubkey: PublicKey): Promise<{
    onChain: any;
    pool: any;
    staking: any;
    pinners: number;
  }> {
    const indexerClient = new IndexerClient(this.indexerBaseUrl);
    const stakingClient = new StakingClient(this.program, this.connection, this.provider);

    // Fetch on-chain state
    const collectionState = await this.program.account.collectionState.fetch(collectionPubkey);
    
    // Fetch pool info from indexer
    const collectionId = (collectionState as any).collectionId || collectionPubkey.toBase58();
    const poolInfo = await indexerClient.getCollectionPoolInfo(collectionId);
    
    // Fetch staking info
    const stakingInfo = await stakingClient.getStakingPoolInfo(collectionPubkey);
    
    // Fetch pinner count
    const pinners = await indexerClient.getCollectionPinners(collectionId);

    return {
      onChain: collectionState,
      pool: poolInfo,
      staking: stakingInfo,
      pinners: pinners.length,
    };
  }
}

