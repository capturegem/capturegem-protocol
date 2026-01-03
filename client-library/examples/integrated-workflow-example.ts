// examples/integrated-workflow-example.ts

/**
 * Integrated Workflow Example
 * 
 * Demonstrates high-level workflows using IntegratedWorkflow orchestrator:
 * 1. Creator publishing a collection
 * 2. Buyer purchasing and downloading content
 * 3. Pinner fulfilling orders
 * 4. Staker earning rewards
 * 5. Cleanup worker burning expired escrows
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { IntegratedWorkflow } from "../libs/IntegratedWorkflow";
import { IpfsManager } from "../libs/IpfsManager";
import { CollectionManifestBuilder, VideoMetadataBuilder } from "../libs/CollectionManifestBuilder";

// Configuration
const RPC_URL = "https://api.devnet.solana.com";
const INDEXER_URL = "https://api.capturegem.io";
const IPFS_GATEWAY = "https://ipfs.io";
const PROGRAM_ID = new PublicKey("YourProgramIDHere");

/**
 * Example 1: Creator Publishing Flow
 */
async function example1_CreatorPublishingFlow() {
  console.log("\n" + "=".repeat(80));
  console.log("EXAMPLE 1: CREATOR PUBLISHING FLOW");
  console.log("=".repeat(80));

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const creatorKeypair = Keypair.generate();
  
  // Fund creator wallet (in production, user would have SOL/USDC)
  // await connection.requestAirdrop(creatorKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
  
  const wallet = new Wallet(creatorKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  
  // Load program (placeholder)
  const program = null as any; // Replace with: new Program(IDL, PROGRAM_ID, provider);
  
  const workflow = new IntegratedWorkflow(
    program,
    connection,
    provider,
    INDEXER_URL,
    IPFS_GATEWAY
  );

  // Step 1: Create collection manifest
  console.log("\n📋 Creating collection manifest...");
  
  const manifest = new CollectionManifestBuilder("my-premium-collection-2024", "Premium Dance Collection")
    .setDescription("Exclusive dance performances from top creators")
    .setCreator({
      username: "DanceStudio Pro",
      display_name: "DanceStudio Pro",
    })
    .setContentRating("explicit")
    .setTags(["dance", "premium"])
    .addVideo(
      new VideoMetadataBuilder("video-1", "Contemporary Flow", "QmVideo1080p...")
        .setDescription("A beautiful contemporary dance performance")
        .setDuration(180) // 3 minutes
        .setRecordedAt(new Date())
        .setPerformer("DanceStudio Pro")
        .setTechnicalSpecs({
          resolution: "1920x1080",
          is_vr: false,
        })
        .setThumbnail("QmThumbnail123...")
        .setTags(["contemporary", "solo"])
        .build()
    )
    .addVideo(
      new VideoMetadataBuilder("video-2", "Hip Hop Freestyle", "QmVideoHipHop1080p...")
        .setDescription("An energetic hip hop freestyle")
        .setDuration(240) // 4 minutes
        .setRecordedAt(new Date())
        .setPerformer("DanceStudio Pro")
        .setTechnicalSpecs({
          resolution: "1920x1080",
          is_vr: false,
        })
        .setThumbnail("QmThumbnail456...")
        .setTags(["hiphop", "freestyle"])
        .build()
    )
    .build();

  console.log(`   ✅ Manifest created with ${manifest.videos.length} videos`);

  // Step 2: Upload manifest to IPFS
  console.log("\n📤 Uploading manifest to IPFS...");
  const ipfsManager = new IpfsManager();
  const manifestCID = await ipfsManager.uploadMetadata(manifest);
  console.log(`   ✅ Manifest CID: ${manifestCID}`);

  // Step 3: Publish collection with Orca pool
  console.log("\n🚀 Publishing collection...");
  
  const publishResult = await workflow.publishCollection(
    creatorKeypair,
    "my-premium-collection-2024",
    manifestCID,
    1.0,   // Initial price: $1.00 per token
    1000.0 // Liquidity: $1000 USDC
  );

  console.log("\n✅ COLLECTION PUBLISHED SUCCESSFULLY!");
  console.log(`   Collection State: ${publishResult.collectionState.toBase58()}`);
  console.log(`   Pool Address: ${publishResult.poolAddress.toBase58()}`);
  console.log(`   Token Mint: ${publishResult.mintAddress.toBase58()}`);
  console.log(`   Initial Price: $${publishResult.initialPrice}`);
  console.log(`   Manifest CID: ${publishResult.manifestCID}`);

  return publishResult;
}

/**
 * Example 2: Buyer Purchase Flow
 */
async function example2_BuyerPurchaseFlow(collectionPubkey: PublicKey) {
  console.log("\n" + "=".repeat(80));
  console.log("EXAMPLE 2: BUYER PURCHASE FLOW");
  console.log("=".repeat(80));

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const buyerKeypair = Keypair.generate();
  
  const wallet = new Wallet(buyerKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = null as any; // Replace with actual program
  
  const workflow = new IntegratedWorkflow(
    program,
    connection,
    provider,
    INDEXER_URL,
    IPFS_GATEWAY
  );

  console.log("\n🛒 Purchasing content...");
  console.log(`   Buyer: ${buyerKeypair.publicKey.toBase58().slice(0, 8)}...`);
  console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);

  // Purchase and download content
  const purchaseResult = await workflow.purchaseAndDownloadContent(
    buyerKeypair,
    collectionPubkey,
    new BN(10_000_000), // 10 tokens (assuming 6 decimals)
    120 // 2-minute timeout for CID revelation
  );

  console.log("\n✅ PURCHASE COMPLETE!");
  console.log(`   Access Escrow: ${purchaseResult.accessEscrow.toBase58()}`);
  console.log(`   Access NFT: ${purchaseResult.accessNFT.toBase58()}`);
  console.log(`   Revealed CID: ${purchaseResult.revealedCID}`);
  console.log(`   Content Size: ${purchaseResult.downloadedContent.length} bytes`);
  console.log(`   Payment Released: ${purchaseResult.paymentReleased ? "✅ Yes" : "❌ No"}`);
  console.log(`   Transactions: ${purchaseResult.transactionSignatures.length}`);

  // Buyer can now watch the content offline!
  console.log("\n🎬 Content is now available for offline viewing!");

  return purchaseResult;
}

/**
 * Example 3: Pinner Fulfillment Flow
 */
async function example3_PinnerFulfillmentFlow(collectionPubkey: PublicKey) {
  console.log("\n" + "=".repeat(80));
  console.log("EXAMPLE 3: PINNER FULFILLMENT FLOW");
  console.log("=".repeat(80));

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const pinnerKeypair = Keypair.generate();
  
  const wallet = new Wallet(pinnerKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = null as any; // Replace with actual program
  
  const workflow = new IntegratedWorkflow(
    program,
    connection,
    provider,
    INDEXER_URL,
    IPFS_GATEWAY
  );

  console.log("\n📍 Starting pinner fulfillment service...");
  console.log(`   Pinner: ${pinnerKeypair.publicKey.toBase58().slice(0, 8)}...`);
  console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);

  // The actual content CID (pinners know this because they're hosting it)
  const actualContentCID = "QmActualContentCID123...";

  // Run fulfillment loop (monitors for purchases and reveals CIDs)
  const fulfillmentResult = await workflow.pinnerFulfillmentLoop(
    pinnerKeypair,
    collectionPubkey,
    actualContentCID,
    5000, // Poll every 5 seconds
    10    // Fulfill max 10 orders
  );

  console.log("\n✅ PINNER FULFILLMENT COMPLETE!");
  console.log(`   Orders Fulfilled: ${fulfillmentResult.escrowsMonitored}`);
  console.log(`   Revenue Earned: ${fulfillmentResult.revenueEarned.toString()} tokens`);
  console.log(`   Trust Score Updates: ${fulfillmentResult.trustScoreUpdates}`);
  console.log(`   CID Reveals: ${fulfillmentResult.cidReveals.length}`);

  return fulfillmentResult;
}

/**
 * Example 4: Staker Flow
 */
async function example4_StakerFlow(collectionPubkey: PublicKey) {
  console.log("\n" + "=".repeat(80));
  console.log("EXAMPLE 4: STAKER FLOW");
  console.log("=".repeat(80));

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const stakerKeypair = Keypair.generate();
  
  const wallet = new Wallet(stakerKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = null as any; // Replace with actual program
  
  const workflow = new IntegratedWorkflow(
    program,
    connection,
    provider,
    INDEXER_URL,
    IPFS_GATEWAY
  );

  console.log("\n🔒 Staking collection tokens...");
  console.log(`   Staker: ${stakerKeypair.publicKey.toBase58().slice(0, 8)}...`);
  console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);

  // Stake tokens and monitor rewards
  const stakingResult = await workflow.stakeAndMonitorRewards(
    stakerKeypair,
    collectionPubkey,
    new BN(100_000_000), // Stake 100 tokens
    new BN(1_000_000),   // Claim rewards when >= 1 token earned
    60000                // Monitor for 1 minute
  );

  console.log("\n✅ STAKING COMPLETE!");
  console.log(`   Tokens Staked: ${stakingResult.staked.toString()}`);
  console.log(`   Rewards Claimed: ${stakingResult.rewardsClaimed.toString()}`);
  console.log(`   Final Staked: ${stakingResult.finalStaked.toString()}`);

  const roi = stakingResult.rewardsClaimed.toNumber() / stakingResult.staked.toNumber() * 100;
  console.log(`   ROI: ${roi.toFixed(2)}%`);

  return stakingResult;
}

/**
 * Example 5: Cleanup Worker Flow
 */
async function example5_CleanupWorkerFlow() {
  console.log("\n" + "=".repeat(80));
  console.log("EXAMPLE 5: CLEANUP WORKER FLOW (BURN EXPIRED ESCROWS)");
  console.log("=".repeat(80));

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const workerKeypair = Keypair.generate();
  
  const wallet = new Wallet(workerKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = null as any; // Replace with actual program
  
  const workflow = new IntegratedWorkflow(
    program,
    connection,
    provider,
    INDEXER_URL,
    IPFS_GATEWAY
  );

  console.log("\n🔥 Searching for expired escrows to burn...");
  console.log(`   Worker: ${workerKeypair.publicKey.toBase58().slice(0, 8)}...`);

  // Burn expired escrows (permissionless, anyone can do this)
  const cleanupResult = await workflow.burnExpiredEscrows(
    workerKeypair,
    10 // Burn max 10 expired escrows
  );

  console.log("\n✅ CLEANUP COMPLETE!");
  console.log(`   Escrows Burned: ${cleanupResult.burned}`);
  console.log(`   Total Tokens Burned: ${cleanupResult.totalAmountBurned.toString()}`);
  console.log(`   Deflationary Impact: -${cleanupResult.totalAmountBurned.toString()} supply`);

  return cleanupResult;
}

/**
 * Example 6: Get Collection Stats
 */
async function example6_CollectionStats(collectionPubkey: PublicKey) {
  console.log("\n" + "=".repeat(80));
  console.log("EXAMPLE 6: COLLECTION STATISTICS");
  console.log("=".repeat(80));

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const dummyKeypair = Keypair.generate();
  
  const wallet = new Wallet(dummyKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = null as any; // Replace with actual program
  
  const workflow = new IntegratedWorkflow(
    program,
    connection,
    provider,
    INDEXER_URL,
    IPFS_GATEWAY
  );

  console.log("\n📊 Fetching collection statistics...");
  
  const stats = await workflow.getCollectionStats(collectionPubkey);

  console.log("\n📈 COLLECTION STATISTICS:");
  console.log("\n📦 On-Chain Data:");
  console.log(`   Collection ID: ${stats.onChain.collectionId || "N/A"}`);
  console.log(`   Owner: ${stats.onChain.owner?.toBase58().slice(0, 8)}...`);
  console.log(`   Mint: ${stats.onChain.mint?.toBase58().slice(0, 8)}...`);

  console.log("\n💧 Pool Data:");
  console.log(`   Current Price: $${stats.pool?.currentPrice || "N/A"}`);
  console.log(`   Liquidity: $${stats.pool?.liquidity || "N/A"}`);
  console.log(`   24h Volume: $${stats.pool?.volume24h || "N/A"}`);

  console.log("\n🔒 Staking Data:");
  console.log(`   Total Staked: ${stats.staking?.totalStaked.toString() || "N/A"} tokens`);
  console.log(`   Total Stakers: ${stats.staking?.totalStakers || "N/A"}`);
  console.log(`   Reward Rate: ${stats.staking?.rewardRate.toString() || "N/A"}`);

  console.log("\n📍 Pinner Network:");
  console.log(`   Active Pinners: ${stats.pinners}`);

  return stats;
}

/**
 * Main example runner
 */
async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║                                                                           ║");
  console.log("║              CAPTUREGEM PROTOCOL - INTEGRATED WORKFLOW EXAMPLES           ║");
  console.log("║                                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════╝");

  try {
    // Example 1: Creator publishes a collection
    const publishResult = await example1_CreatorPublishingFlow();
    const collectionPubkey = publishResult.collectionState;

    // Example 2: Buyer purchases and downloads content
    await example2_BuyerPurchaseFlow(collectionPubkey);

    // Example 3: Pinner fulfills orders
    await example3_PinnerFulfillmentFlow(collectionPubkey);

    // Example 4: Staker earns rewards
    await example4_StakerFlow(collectionPubkey);

    // Example 5: Cleanup worker burns expired escrows
    await example5_CleanupWorkerFlow();

    // Example 6: View collection statistics
    await example6_CollectionStats(collectionPubkey);

    console.log("\n" + "=".repeat(80));
    console.log("✅ ALL EXAMPLES COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(80) + "\n");

  } catch (error) {
    console.error("\n❌ Error running examples:", error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  example1_CreatorPublishingFlow,
  example2_BuyerPurchaseFlow,
  example3_PinnerFulfillmentFlow,
  example4_StakerFlow,
  example5_CleanupWorkerFlow,
  example6_CollectionStats,
};

