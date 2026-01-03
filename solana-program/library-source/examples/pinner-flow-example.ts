// library-source/examples/pinner-flow-example.ts

/**
 * Example: Complete pinner flow
 * 
 * Shows how a pinner monitors for new purchases,
 * reveals encrypted CIDs, and verifies NFT ownership
 * before serving content.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { PinnerClient } from "../libs/PinnerClient";
import { hashCID } from "../libs/CryptoUtils";

// Load your program IDL (replace with actual IDL)
// import idl from "../../target/idl/solana_program.json";

async function main() {
  // ============================================================================
  // 1. Setup
  // ============================================================================
  
  console.log("🔧 Starting pinner flow example\n");
  
  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  
  // Load pinner's keypair
  const pinnerKeypair = Keypair.generate(); // Replace with actual keypair
  console.log(`Pinner: ${pinnerKeypair.publicKey.toBase58()}\n`);
  
  // Airdrop some SOL for transactions (devnet only)
  console.log("💰 Requesting airdrop...");
  const airdropSig = await connection.requestAirdrop(
    pinnerKeypair.publicKey,
    2_000_000_000 // 2 SOL
  );
  await connection.confirmTransaction(airdropSig);
  console.log("✅ Airdrop confirmed\n");
  
  // Create provider and program
  const wallet = new Wallet(pinnerKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  
  // Load program (replace with your program ID)
  const programId = new PublicKey("YOUR_PROGRAM_ID");
  // const program = new Program(idl, programId, provider);
  const program = null as any; // Placeholder
  
  // Create PinnerClient
  const pinnerClient = new PinnerClient(program, connection, provider);
  
  // ============================================================================
  // 2. Monitor for New Purchases
  // ============================================================================
  
  console.log("🔍 Step 1: Monitoring for new purchases...\n");
  
  // Collections this pinner is serving
  const myCollections = [
    {
      id: "creator123-debut-collection",
      pubkey: new PublicKey("COLLECTION_PUBKEY_1"),
      cid: "QmYx8VsXjVjR4NbZPrB7GyPx9qvL8TjKU2r3fNz4bHmWk9",
    },
    {
      id: "creator456-premium-pack",
      pubkey: new PublicKey("COLLECTION_PUBKEY_2"),
      cid: "QmZ9BbQxC3wR5VnXsJjU7HpKvL2mNx8vY4kWz6fGtRsEq1",
    },
  ];
  
  console.log("Pinning collections:");
  myCollections.forEach((col, idx) => {
    console.log(`  ${idx + 1}. ${col.id}`);
    console.log(`     CID: ${col.cid}\n`);
  });
  
  // ============================================================================
  // 3. Subscribe to Real-Time Purchases (Websocket)
  // ============================================================================
  
  console.log("📡 Step 2: Subscribing to real-time purchase events...\n");
  
  const subscriptionId = await pinnerClient.subscribeToNewPurchases(
    async (purchase) => {
      console.log("🔔 New purchase detected!");
      console.log(`   Purchaser: ${purchase.purchaser.toBase58()}`);
      console.log(`   Collection: ${purchase.collectionId}`);
      console.log(`   Escrow: ${purchase.accessEscrow.toBase58()}`);
      console.log(`   Created: ${purchase.createdAt.toISOString()}\n`);
      
      // Find the collection this pinner is serving
      const collection = myCollections.find(
        (c) => c.pubkey.equals(purchase.collection)
      );
      
      if (!collection) {
        console.log("⚠️  Not pinning this collection, skipping...\n");
        return;
      }
      
      // ============================================================================
      // 4. Reveal CID to Purchaser
      // ============================================================================
      
      console.log("🔐 Step 3: Revealing CID to purchaser...\n");
      
      try {
        const tx = await pinnerClient.revealCID(
          purchase.accessEscrow,
          collection.cid,
          pinnerKeypair
        );
        
        console.log("✅ CID revealed successfully!");
        console.log(`   Transaction: ${tx}\n`);
        
        // Log for tracking
        console.log("📝 Revelation recorded:");
        console.log(`   Purchaser: ${purchase.purchaser.toBase58()}`);
        console.log(`   Collection: ${collection.id}`);
        console.log(`   CID: ${collection.cid}`);
        console.log(`   Time: ${new Date().toISOString()}\n`);
        
      } catch (error) {
        console.error("❌ Failed to reveal CID:", error);
      }
    }
  );
  
  console.log(`✅ Subscribed (ID: ${subscriptionId})\n`);
  
  // ============================================================================
  // 5. Handle Content Access Requests (Mock HTTP Server)
  // ============================================================================
  
  console.log("🌐 Step 4: Setting up content access verification...\n");
  
  // In production, you'd run an HTTP server or IPFS gateway
  // that verifies NFT ownership before serving content
  
  // Example: Mock request handler
  const handleAccessRequest = async (proofMessage: any) => {
    console.log("📥 Received access request:");
    console.log(`   Wallet: ${proofMessage.wallet_address}`);
    console.log(`   Collection: ${proofMessage.collection_id}`);
    console.log(`   NFT Mint: ${proofMessage.access_nft_mint}\n`);
    
    // Find collection
    const collection = myCollections.find(
      (c) => c.id === proofMessage.collection_id
    );
    
    if (!collection) {
      console.log("❌ Collection not found\n");
      return { allowed: false, reason: "Collection not found" };
    }
    
    // Verify NFT ownership
    console.log("🔍 Verifying NFT ownership...");
    const verification = await pinnerClient.verifyNFTOwnership(
      proofMessage,
      collection.id
    );
    
    if (!verification.valid) {
      console.log(`❌ Verification failed: ${verification.reason}`);
      console.log(`   Cached: ${verification.cached}\n`);
      return { allowed: false, reason: verification.reason };
    }
    
    console.log("✅ NFT verified!");
    console.log(`   Cached: ${verification.cached}`);
    console.log("   Allowing access to content...\n");
    
    return {
      allowed: true,
      collection_cid: collection.cid,
    };
  };
  
  // ============================================================================
  // 6. Simulate Access Requests
  // ============================================================================
  
  console.log("🧪 Step 5: Simulating access requests...\n");
  
  // Example 1: Valid access request
  const validProof = {
    wallet_address: "BjKw1Z8DQjU3vX9Ry2Hm7Nq8Kp5Lx4Ft9Cw6Yx1Qz3V",
    collection_id: "creator123-debut-collection",
    access_nft_mint: "NFT_MINT_ADDRESS",
    timestamp: Math.floor(Date.now() / 1000),
    signature: "base64_signature_here",
  };
  
  console.log("Test 1: Valid NFT owner");
  await handleAccessRequest(validProof);
  
  // Example 2: Invalid signature
  const invalidProof = {
    ...validProof,
    signature: "invalid_signature",
  };
  
  console.log("Test 2: Invalid signature");
  await handleAccessRequest(invalidProof);
  
  // Example 3: Expired timestamp
  const expiredProof = {
    ...validProof,
    timestamp: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago
  };
  
  console.log("Test 3: Expired timestamp");
  await handleAccessRequest(expiredProof);
  
  // ============================================================================
  // 7. Batch NFT Verification Example
  // ============================================================================
  
  console.log("📦 Step 6: Batch verification example...\n");
  
  const proofBatch = [validProof, invalidProof, expiredProof];
  
  console.log(`Verifying ${proofBatch.length} access proofs in parallel...`);
  const results = await pinnerClient.batchVerifyNFTOwnership(
    proofBatch,
    "creator123-debut-collection"
  );
  
  results.forEach((result, idx) => {
    console.log(`  ${idx + 1}. ${result.valid ? "✅ Valid" : "❌ Invalid"}`);
    if (!result.valid) {
      console.log(`     Reason: ${result.reason}`);
    }
  });
  console.log();
  
  // ============================================================================
  // 8. Cleanup and Statistics
  // ============================================================================
  
  console.log("📊 Pinner statistics:\n");
  console.log(`   Active subscriptions: 1`);
  console.log(`   Collections pinned: ${myCollections.length}`);
  console.log(`   Cache size: ${pinnerClient["nftVerificationCache"].size} entries`);
  console.log();
  
  // In production, keep the subscription running indefinitely
  // For this example, we'll unsubscribe after a delay
  setTimeout(async () => {
    console.log("🛑 Shutting down...\n");
    await pinnerClient.unsubscribeFromNewPurchases(subscriptionId);
    pinnerClient.clearCache();
    console.log("✅ Pinner stopped gracefully\n");
    process.exit(0);
  }, 10000); // 10 seconds
  
  console.log("⏳ Running for 10 seconds before shutdown...\n");
}

// Run the example
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

