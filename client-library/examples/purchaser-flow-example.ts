// client-library/examples/purchaser-flow-example.ts

/**
 * Example: Complete purchaser flow
 * 
 * Shows how a purchaser buys access to a collection,
 * waits for CID revelation, decrypts it, and uses NFT proof
 * to access content from pinners.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { AccessClient } from "../libs/AccessClient";
import { hashCID } from "../libs/CryptoUtils";

// Load your program IDL (replace with actual IDL)
// import idl from "../../solana-program/target/idl/solana_program.json";

async function main() {
  // ============================================================================
  // 1. Setup
  // ============================================================================
  
  console.log("🚀 Starting purchaser flow example\n");
  
  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  
  // Load purchaser's keypair (in production, use wallet adapter)
  const purchaserKeypair = Keypair.generate(); // Replace with actual keypair
  console.log(`Purchaser: ${purchaserKeypair.publicKey.toBase58()}\n`);
  
  // Airdrop some SOL for transactions (devnet only)
  console.log("💰 Requesting airdrop...");
  const airdropSig = await connection.requestAirdrop(
    purchaserKeypair.publicKey,
    2_000_000_000 // 2 SOL
  );
  await connection.confirmTransaction(airdropSig);
  console.log("✅ Airdrop confirmed\n");
  
  // Create provider and program
  const wallet = new Wallet(purchaserKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  
  // Load program (replace with your program ID)
  const programId = new PublicKey("YOUR_PROGRAM_ID");
  // const program = new Program(idl, programId, provider);
  const program = null as any; // Placeholder
  
  // Create AccessClient
  const accessClient = new AccessClient(program, connection, provider);
  
  // ============================================================================
  // 2. Purchase Access
  // ============================================================================
  
  console.log("📦 Step 1: Purchasing access to collection...\n");
  
  // Collection info (from discovery/browsing)
  const collectionId = "creator123-debut-collection";
  const collectionPubkey = new PublicKey("COLLECTION_PUBKEY");
  const collectionCID = "QmYx8VsXjVjR4NbZPrB7GyPx9qvL8TjKU2r3fNz4bHmWk9"; // Known from UI
  
  // Hash the CID to verify later
  const cidHash = hashCID(collectionCID);
  console.log(`Collection CID: ${collectionCID}`);
  console.log(`CID Hash: ${Buffer.from(cidHash).toString("hex")}\n`);
  
  // Amount to purchase (in collection tokens)
  const purchaseAmount = new BN(1_000_000); // 1 token
  
  try {
    // Execute purchase
    const purchaseResult = await accessClient.purchaseAccess(
      collectionId,
      collectionPubkey,
      purchaseAmount,
      cidHash
    );
    
    console.log("✅ Purchase successful!");
    console.log(`   Transaction: ${purchaseResult.transaction}`);
    console.log(`   Access Escrow: ${purchaseResult.accessEscrow.toBase58()}`);
    console.log(`   Access NFT: ${purchaseResult.accessNftMint.toBase58()}\n`);
    
    // ============================================================================
    // 3. Wait for CID Revelation
    // ============================================================================
    
    console.log("⏳ Step 2: Waiting for pinner to reveal CID...\n");
    console.log("   (This happens when a pinner detects the purchase via indexer)\n");
    
    const cidReveal = await accessClient.waitForCIDReveal(
      purchaseResult.accessEscrow,
      300000, // 5 minute timeout
      2000    // Poll every 2 seconds
    );
    
    console.log("✅ CID revealed by pinner!");
    console.log(`   Pinner: ${cidReveal.pinner.toBase58()}`);
    console.log(`   Encrypted CID length: ${cidReveal.encryptedCid.length} bytes\n`);
    
    // ============================================================================
    // 4. Decrypt and Verify CID
    // ============================================================================
    
    console.log("🔓 Step 3: Decrypting and verifying CID...\n");
    
    // Fetch escrow data
    const accessEscrow = await program.account.accessEscrow.fetch(
      purchaseResult.accessEscrow
    );
    
    // Decrypt and verify
    const revealed = accessClient.decryptAndVerifyCID(
      cidReveal,
      accessEscrow,
      purchaserKeypair
    );
    
    if (!revealed.verified) {
      throw new Error("⚠️  CID verification failed! Hash mismatch.");
    }
    
    console.log("✅ CID decrypted and verified!");
    console.log(`   Decrypted CID: ${revealed.cid}`);
    console.log(`   Matches expected hash: ${revealed.verified}\n`);
    
    // ============================================================================
    // 5. Fetch Collection Manifest
    // ============================================================================
    
    console.log("📄 Step 4: Fetching collection manifest from IPFS...\n");
    
    const manifest = await accessClient.fetchCollectionManifest(revealed.cid);
    
    console.log("✅ Manifest loaded!");
    console.log(`   Collection: ${manifest.collection_id}`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Videos: ${manifest.videos.length}\n`);
    
    // Display videos
    manifest.videos.forEach((video, idx) => {
      console.log(`   ${idx + 1}. ${video.title}`);
      console.log(`      CID: ${video.cid}`);
      console.log(`      Duration: ${video.duration}s\n`);
    });
    
    // ============================================================================
    // 6. Create NFT Access Proof
    // ============================================================================
    
    console.log("🎫 Step 5: Creating NFT access proof for pinner connections...\n");
    
    const nftProof = accessClient.createNFTAccessProof(
      purchaserKeypair,
      collectionId,
      purchaseResult.accessNftMint
    );
    
    console.log("✅ Access proof created!");
    console.log(`   Wallet: ${nftProof.wallet_address}`);
    console.log(`   Collection: ${nftProof.collection_id}`);
    console.log(`   NFT Mint: ${nftProof.access_nft_mint}`);
    console.log(`   Timestamp: ${new Date(nftProof.timestamp * 1000).toISOString()}`);
    console.log(`   Signature: ${nftProof.signature.substring(0, 32)}...\n`);
    
    // ============================================================================
    // 7. Connect to Pinner for Streaming
    // ============================================================================
    
    console.log("📡 Step 6: Connecting to pinner for content streaming...\n");
    console.log("   (In production, use this proof to authenticate with IPFS peer)\n");
    
    // Example: Send proof to pinner's HTTP API
    const pinnerApiUrl = "https://pinner-node.example.com/verify-access";
    
    console.log(`   POST ${pinnerApiUrl}`);
    console.log(`   Body: ${JSON.stringify(nftProof, null, 2)}\n`);
    
    // In production:
    // const response = await fetch(pinnerApiUrl, {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify(nftProof),
    // });
    // 
    // if (response.ok) {
    //   console.log("✅ Authenticated! Starting stream...");
    //   // Now you can access IPFS content via this pinner
    // }
    
    console.log("🎉 Complete! You can now stream videos from the collection.\n");
    
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
}

// Run the example
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

