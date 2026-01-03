// client-library/examples/collection-manifest-example.ts

/**
 * Example: Creating a Collection Manifest
 * 
 * This example demonstrates how to use the CollectionManifestBuilder to create
 * a complete collection manifest for adult content, including VR videos.
 */

import {
  CollectionManifestBuilder,
  VideoMetadataBuilder,
  createStandardVideoSpecs,
  createVRVideoSpecs,
  hashCollectionManifest,
  validateCollectionManifest,
} from "../index";

async function main() {
  console.log("📦 Creating Collection Manifest Example\n");

  // ============================================================================
  // Step 1: Create the Collection Manifest Builder
  // ============================================================================
  
  console.log("1️⃣  Initializing collection manifest...\n");
  
  const builder = new CollectionManifestBuilder(
    "summer-collection-2024",
    "Summer Sunset Collection"
  );

  // Set collection-level metadata
  builder
    .setDescription("Exclusive summer content featuring beach scenes and sunset views")
    .setCreator({
      username: "summervibes",
      display_name: "Summer Vibes",
      wallet_address: "5xKbW8G2T9ZN3YnF7VqP3mD4hJ6rL8sK1nM9pQ2tR3vU",
      bio: "Professional content creator specializing in outdoor and beach content",
      avatar_cid: "QmAvatarCID123...",
      social_links: {
        twitter: "https://twitter.com/summervibes",
        instagram: "https://instagram.com/summervibes",
        website: "https://summervibes.com",
      },
      verified: true,
    })
    .setContentRating("explicit")
    .setTags(["summer", "beach", "outdoor", "4k", "vr"])
    .setCoverImage("QmCoverImageCID123...")
    .setPreviewVideo("QmPreviewVideoCID123...");

  console.log("✅ Collection metadata set");

  // ============================================================================
  // Step 2: Add Standard HD Videos
  // ============================================================================
  
  console.log("\n2️⃣  Adding standard videos...\n");

  // Video 1: Beach Day (4K)
  const video1 = new VideoMetadataBuilder(
    "beach-day-001",
    "Sunset Beach Walk",
    "QmBeachVideoContentCID001..."
  )
    .setDescription("A beautiful evening walk along the beach at sunset")
    .setDuration(720) // 12 minutes
    .setRecordedAt(new Date("2024-06-15T18:30:00Z"))
    .setPerformer("summervibes")
    .setTechnicalSpecs({
      resolution: "3840x2160", // 4K
      fps: 60,
      codec: "h265",
      bitrate_kbps: 20000,
      is_vr: false,
      audio_codec: "aac",
      audio_bitrate_kbps: 320,
      hdr: true,
    })
    .setThumbnail("QmThumb001...")
    .setPreviewClip("QmPreviewClip001...")
    .setTags(["beach", "sunset", "walking", "4k", "hdr"])
    .setFileSize(1800000000) // ~1.8GB
    .setFileFormat("mp4")
    .build();

  builder.addVideo(video1);
  console.log("   ✅ Added: Sunset Beach Walk (4K, 12min)");

  // Video 2: Pool Party (1080p)
  const video2 = new VideoMetadataBuilder(
    "pool-party-002",
    "Pool Party Fun",
    "QmPoolVideoContentCID002..."
  )
    .setDescription("Summer pool party with friends")
    .setDuration(900) // 15 minutes
    .setRecordedAt(new Date("2024-06-20T14:00:00Z"))
    .setPerformer("summervibes")
    .setAdditionalPerformers(["friend1", "friend2"])
    .setTechnicalSpecs({
      resolution: "1920x1080", // 1080p
      fps: 30,
      codec: "h264",
      bitrate_kbps: 8000,
      is_vr: false,
      audio_codec: "aac",
      audio_bitrate_kbps: 256,
    })
    .setThumbnail("QmThumb002...")
    .setTags(["pool", "party", "group", "outdoor"])
    .setFileSize(900000000) // ~900MB
    .setFileFormat("mp4")
    .build();

  builder.addVideo(video2);
  console.log("   ✅ Added: Pool Party Fun (1080p, 15min)");

  // ============================================================================
  // Step 3: Add VR Videos
  // ============================================================================
  
  console.log("\n3️⃣  Adding VR videos...\n");

  // VR Video 1: 180° VR Beach Experience
  const vrVideo1 = new VideoMetadataBuilder(
    "vr-beach-180-001",
    "VR Beach Experience - 180°",
    "QmVRBeachContentCID001..."
  )
    .setDescription("Immersive 180° VR experience on the beach")
    .setDuration(600) // 10 minutes
    .setRecordedAt(new Date("2024-06-18T16:00:00Z"))
    .setPerformer("summervibes")
    .setTechnicalSpecs(
      createVRVideoSpecs(
        "5760x2880", // 180° VR resolution
        "dome",      // 180° format
        "side-by-side", // Stereo 3D
        60           // 60 fps
      )
    )
    .setThumbnail("QmVRThumb001...")
    .setTags(["vr", "180", "beach", "pov", "3d"])
    .setContentWarnings(["immersive-vr"])
    .setFileSize(3600000000) // ~3.6GB
    .setFileFormat("mp4")
    .build();

  // Add additional technical details
  vrVideo1.technical_specs.codec = "h265";
  vrVideo1.technical_specs.bitrate_kbps = 50000;
  vrVideo1.technical_specs.audio_codec = "aac";
  vrVideo1.technical_specs.audio_bitrate_kbps = 320;

  builder.addVideo(vrVideo1);
  console.log("   ✅ Added: VR Beach Experience 180° (5.7K, 10min)");

  // VR Video 2: 360° VR Sunset
  const vrVideo2 = new VideoMetadataBuilder(
    "vr-sunset-360-002",
    "VR Sunset 360° Experience",
    "QmVRSunsetContentCID002..."
  )
    .setDescription("Full 360° VR sunset experience")
    .setDuration(1200) // 20 minutes
    .setRecordedAt(new Date("2024-06-22T19:00:00Z"))
    .setPerformer("summervibes")
    .setTechnicalSpecs(
      createVRVideoSpecs(
        "7680x3840", // 360° VR resolution (8K)
        "equirectangular", // 360° format
        "top-bottom", // Stereo 3D stacked
        60
      )
    )
    .setThumbnail("QmVRThumb002...")
    .setTags(["vr", "360", "sunset", "immersive", "8k"])
    .setContentWarnings(["immersive-vr", "motion-sickness"])
    .setFileSize(7200000000) // ~7.2GB
    .setFileFormat("mp4")
    .build();

  vrVideo2.technical_specs.codec = "h265";
  vrVideo2.technical_specs.bitrate_kbps = 80000;
  vrVideo2.technical_specs.audio_codec = "aac";
  vrVideo2.technical_specs.audio_bitrate_kbps = 512; // Spatial audio

  builder.addVideo(vrVideo2);
  console.log("   ✅ Added: VR Sunset 360° (8K, 20min)");

  // ============================================================================
  // Step 4: Build and Validate
  // ============================================================================
  
  console.log("\n4️⃣  Building manifest...\n");

  const { manifest, hash, hashHex } = builder.buildWithHash();

  console.log("✅ Manifest built successfully!");
  console.log(`   Collection: ${manifest.name}`);
  console.log(`   Total videos: ${manifest.total_videos}`);
  console.log(`   Total duration: ${Math.floor(manifest.total_duration_seconds / 60)} minutes`);
  console.log(`   Standard videos: ${manifest.videos.filter(v => !v.technical_specs.is_vr).length}`);
  console.log(`   VR videos: ${manifest.videos.filter(v => v.technical_specs.is_vr).length}`);

  // Validate the manifest
  console.log("\n5️⃣  Validating manifest...\n");
  
  const validation = validateCollectionManifest(manifest);
  
  if (validation.valid) {
    console.log("✅ Manifest is valid!");
  } else {
    console.log("❌ Validation errors:");
    validation.errors.forEach(err => console.log(`   - ${err}`));
    return;
  }

  // ============================================================================
  // Step 6: Display Hash for On-Chain Storage
  // ============================================================================
  
  console.log("\n6️⃣  Manifest hash (for on-chain storage):\n");
  console.log(`   SHA-256: ${hashHex}`);
  console.log(`   Bytes: [${Array.from(hash).slice(0, 8).join(', ')}...]`);

  // ============================================================================
  // Step 7: Display Full Manifest (JSON)
  // ============================================================================
  
  console.log("\n7️⃣  Full manifest JSON:\n");
  console.log(JSON.stringify(manifest, null, 2));

  // ============================================================================
  // Step 8: Usage Instructions
  // ============================================================================
  
  console.log("\n\n📋 Next Steps:");
  console.log("\n1. Upload manifest to IPFS:");
  console.log("   ```");
  console.log("   ipfs add manifest.json");
  console.log("   ```");
  console.log("\n2. Keep the IPFS CID SECRET (e.g., QmXYZ...)");
  console.log("\n3. Use the hash above when calling create_collection:");
  console.log("   ```typescript");
  console.log(`   await protocolClient.createCollection(`);
  console.log(`     "${manifest.collection_id}",`);
  console.log(`     "${manifest.name}",`);
  console.log(`     [${Array.from(hash).slice(0, 8).join(', ')}...], // cid_hash`);
  console.log(`     accessThresholdUsd,`);
  console.log(`     oracleFeed`);
  console.log(`   );`);
  console.log("   ```");
  console.log("\n4. As a pinner, encrypt and reveal the CID to purchasers");
  console.log("\n5. Purchasers verify: SHA256(revealed_CID) == on_chain_hash\n");

  // ============================================================================
  // Step 9: Example of Fetching and Parsing
  // ============================================================================
  
  console.log("\n📖 Example: Fetching manifest as a purchaser:\n");
  console.log("```typescript");
  console.log("import { parseCollectionManifest } from '@capturegem/client-library';");
  console.log("");
  console.log("// After receiving revealed CID from pinner");
  console.log("const response = await fetch(`https://ipfs.io/ipfs/${revealedCID}`);");
  console.log("const manifestJSON = await response.text();");
  console.log("");
  console.log("// Parse and validate");
  console.log("const manifest = parseCollectionManifest(manifestJSON);");
  console.log("");
  console.log("// Access video CIDs");
  console.log("manifest.videos.forEach(video => {");
  console.log("  console.log(`Video: ${video.title}`);");
  console.log("  console.log(`CID: ${video.cid}`);");
  console.log("  console.log(`Duration: ${video.duration_seconds}s`);");
  console.log("  console.log(`VR: ${video.technical_specs.is_vr}`);");
  console.log("});");
  console.log("```\n");
}

main().catch(console.error);

