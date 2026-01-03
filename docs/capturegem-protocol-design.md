# Technical Design Document: CaptureGem Decentralized Protocol (CDP)

**Version:** 1.3  
**Date:** January 3, 2026  
**Status:** Approved

## 1. Executive Summary

CaptureGem CDP is a decentralized application (DApp) designed to transform the adult video streaming landscape by allowing users to share, sell, and moderate video content directly on the Solana blockchain. Unlike legacy Web2 platforms that rely on centralized servers, opaque algorithms, and arbitrary de-platforming, CaptureGem utilizes a unique SocialFi model that aligns incentives between creators, consumers, and infrastructure providers.

The protocol introduces a novel "Trust-Based Delivery" mechanism that fundamentally reimagines the relationship between payment and service. In this model, Content Collections are backed by liquid tokens traded on decentralized exchanges (Orca). When users purchase access, they create a purchase account on-chain containing only the SHA-256 hash of the collection's IPFS CID—the actual content address remains private. Simultaneously, an Access NFT is minted to the purchaser's wallet, serving as a cryptographic proof of ownership that pinners verify before serving content. This prevents unauthorized access at the peer-to-peer level, as IPFS nodes will reject connection requests from wallets that do not possess the valid Access NFT.

A pinner who hosts the collection then sends an encrypted message to the purchaser's wallet on-chain, containing the real CID encrypted with the purchaser's public key. The purchaser decrypts this using their private wallet key and verifies the hash matches their commitment, ensuring authenticity. The collection CID itself is a manifest document containing the CIDs of all individual videos, unlocking the entire collection with a single purchase.

The payment is split: 50% flows to a staking pool where collection token holders earn rewards, and 50% is held in escrow. This escrowed payment is only released to storage providers (IPFS Peers) once the purchaser's client confirms the content was successfully delivered—and critically, the buyer determines which peers deserve payment based on actual performance. If the buyer does not disburse funds within 24 hours, the escrowed tokens are automatically burned, creating deflationary pressure. This ensures a meritocratic network where high-performance nodes build on-chain Trust Scores, creating a feedback loop where quality service is algorithmically rewarded with higher earning potential.

Additionally, the protocol embeds intellectual property protection at the tokenomic level. A portion of every collection's supply is reserved in a "Claim Vault" for potential copyright disputes. This ensures that true rights holders have a path to monetization even if they were not the initial uploaders, solving a critical pain point in decentralized content distribution where anonymity can often shield infringement.

## 2. System Architecture

The system consists of three primary layers designed to abstract away the complexities of blockchain interaction while maintaining full self-sovereignty.

### 2.1 Client Technology Stack (Electron & Portable Runtime)

The client is designed as a "Zero-Configuration" application acting as both a media player and a network node.

**Framework:** Electron.js (Chromium + Node.js) serves as the GUI container.

**Security Architecture:** The application employs a strict sandboxing model. `nodeIntegration` is disabled in renderer processes to prevent Cross-Site Scripting (XSS) attacks from escalating to system-level compromise. All sensitive operations are handled via a secure Preload script and Inter-Process Communication (IPC) bridges.

**Rationale:** Electron was chosen over a pure web application to allow for unrestricted access to the local filesystem (for encrypted keystores) and raw TCP/UDP sockets required for the IPFS daemon, which browser-based environments cannot provide.

**Portable IPFS Integration:** The application bundles a binary of Kubo (go-ipfs) directly within its resources.

- **Lifecycle Management:** Upon launch, the main process spawns this binary as a child process, managing its configuration, garbage collection, and NAT traversal (using UPnP/NAT-PMP).
- **Network Contribution:** This architecture ensures that every active user is automatically a node contributing to the data availability of the ecosystem. Users who simply watch content also redistribute it to others, increasing the health of the swarm.

**IPFS Check & Trust Tool:** A custom client-side networking module monitors peer connectivity.

- **Granular Metrics:** It tracks incoming data chunks via the Bitswap protocol to identify exactly which peers provided which parts of the file. It measures latency (RTT), throughput (MB/s), and data integrity (Merkle DAG verification).
- **Proof of Delivery:** This data is used to construct a "Proof of Delivery" payload that enables the user to cryptographically sign a "Release Escrow" transaction specifically for the peers that performed the work.

**Embedded Wallet:** A local Solana filesystem wallet manages signing. The wallet code is implemented in `WalletManager.ts` (`@solana-program/client-library/libs/WalletManager.ts`) and runs in the same process as the Electron main process (`main.ts`). Other client library modules import `WalletManager` directly—there is no separate RPC service or inter-process communication required for wallet operations.

- **Key Storage:** Private keys are encrypted using AES-256-GCM and stored locally on the user's disk. Keys never leave the device.
- **Risk Profiles:** To improve UX, the wallet distinguishes between low-risk actions (liking, updating bio) which can be "Autosigned" if enabled, and high-risk actions (purchasing access, releasing escrow, transferring funds) which strictly require a biometric or password confirmation.
- **Architecture:** The `WalletManager` class is instantiated in the Electron main process and passed to other client library classes (e.g., `ProtocolClient`, `AccessClient`) as a dependency. All wallet operations occur synchronously within the same Node.js process, ensuring low latency and simplified error handling.

### 2.2 High-Level Diagram

```
                    ┌─────────┐
                    │ Creator │
                    └────┬────┘
                         │ 1. Mint Collection
                         │    Commit: SHA256(CID) → CollectionState
                         ▼
                 ┌──────────────────┐
                 │ Solana Program   │
                 └───┬──────────┬───┘
                     │          │          │
                     │ 80%      │ 10%      │ 10%
                     ▼          ▼          ▼
            ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
            │    Orca     │  │   Creator    │  │  Claim Vault │
            │  Liquidity  │  │    Wallet    │  │     PDA      │
            │    Pool     │  └──────────────┘  └──────────────┘
            └──────┬──────┘
                   │ 2. Buy Access (Swap CAPGM → Collection Tokens)
                   │    Commit: SHA256(CID) → AccessEscrow
                   │    Mint: Access NFT → Purchaser Wallet
                   ▼
            ┌──────────────────────┐
            │  Purchase Split      │
            │  (Collection Tokens) │
            └──────┬───────────────┘
                   │
                   ├────────── 50% ──────────┐
                   │                         │
                   ▼                         ▼
       ┌─────────────────────┐      ┌──────────────────────┐
       │  Collection Token   │      │  Access Escrow PDA   │
       │   Staking Pool      │      │  • cid_hash          │
       │  (Rewards Stakers)  │      │  • purchaser_pubkey  │
       └─────────────────────┘      │  • access_nft_mint   │
                                     │  • 24hr expiry       │
                                     └──────┬───────────────┘
                                            │
            ╔═══════════════════════════════╧════════════════════════════╗
            ║        CRYPTOGRAPHIC KEY EXCHANGE (On-Chain)               ║
            ╠════════════════════════════════════════════════════════════╣
            ║ 3. Pinner Observes Escrow & Encrypts CID                  ║
            ║    • Pinner reads purchaser_pubkey from escrow             ║
            ║    • Encrypts CID using X25519-XSalsa20-Poly1305          ║
            ║    • Writes CidReveal PDA with encrypted_cid               ║
            ╚════════════════════╤═══════════════════════════════════════╝
                                 │
                                 ▼
                          ┌──────────────────────┐
                          │   CID Reveal PDA     │
                          │  • escrow            │
                          │  • pinner            │
                          │  • encrypted_cid     │
                          │    [CID encrypted    │
                          │     with X25519]     │
                          └──────┬───────────────┘
                                 │
            ╔════════════════════╧════════════════════════════════════╗
            ║ 4. Purchaser Decrypts & Verifies (Client-Side)        ║
            ║    • Decrypt: CID = decrypt(encrypted_cid, privkey)   ║
            ║    • Verify: SHA256(CID) ?= escrow.cid_hash           ║
            ║    • If match → proceed; If mismatch → reject         ║
            ╚════════════════════╤════════════════════════════════════╝
                                 │
                                 ▼
                          ┌──────────────────────┐
                          │  Collection Manifest │
                          │  (CID now revealed)  │
                          │  {                   │
                          │   videos: [          │
                          │    {cid: "Qm..."},   │
                          │    {cid: "Qm..."}    │
                          │   ]                  │
                          │  }                   │
                          └──────┬───────────────┘
                                 │
                                 │ 5. Request Connection to IPFS Peers
                                 ▼
            ╔════════════════════════════════════════════════════════╗
            ║ NFT-BASED ACCESS CONTROL (Peer-to-Peer Layer)         ║
            ║ • Purchaser presents Access NFT to pinner              ║
            ║ • Pinner verifies NFT ownership on-chain               ║
            ║ • If valid → serve content; If invalid → reject       ║
            ╚════════════════════╤═══════════════════════════════════╝
                                 │
                                 │ 6. Fetch Manifest → Extract Video CIDs
                                 ▼
                          ┌──────────────┐
                          │ IPFS Network │
                          │  (DHT Lookup │
                          │   + Bitswap) │
                          └──────┬───────┘
                                 │ 7. Download Content (Track Peer Performance)
                                 ▼
                          ┌──────────────┐
                          │   Purchaser  │
                          │  Trust Tool: │
                          │  • Peer A: 500MB │
                          │  • Peer B: 200MB │
                          └──────┬───────┘
                                 │ 8. Verify Peers & Choose Payment
                                 │
           ┌─────────────────────┴─────────────────────┐
           │                                           │
           ▼ Within 24hrs                              ▼ After 24hrs
  ┌─────────────────────┐                   ┌──────────────────┐
  │ Trust Client Logic   │                   │ Permissionless   │
  │ (Release to Peers)   │                   │  Burn Escrow     │
  └──────┬───────────────┘                   └──────┬───────────┘
         │ 9a. Release Funds (50% Escrow)           │ 9b. Burn Tokens
         ▼                                          ▼
  ┌──────────────────┐                   ┌──────────────────┐
  │  Access Escrow   │                   │ Reduce Supply    │
  │      PDA         │                   │  (Deflationary)  │
  └───┬───────────┬──┘                   └──────────────────┘
      │           │
      │ Payment   │ Payment
      │ Based on  │ Based on
      │ Actual    │ Actual
      │ Delivery  │ Delivery
      ▼           ▼
  ┌──────────┐ ┌──────────┐
  │ Peer A   │ │ Peer B   │
  │ Wallet   │ │ Wallet   │
  └─────┬────┘ └─────┬────┘
        │            │
        └──────┬─────┘
               │ 10. Update Trust Score (On-Chain Reputation)
               ▼
        ┌──────────────────┐
        │ PeerTrustState   │
        │  • successful_   │
        │    serves++      │
        │  • trust_score++ │
        └──────────────────┘
```

## 3. Solana Program Design (The Smart Contract)

The core logic resides in a custom Solana Program (Rust/Anchor), leveraging the high throughput of the network to handle real-time settlement and complex state transitions.

### 3.0 Collection Manifest Schema (IPFS Document)

Before diving into the on-chain program design, it's critical to understand the **Collection Manifest**—the off-chain catalog document that serves as the "table of contents" for all content in a collection. This manifest is stored on IPFS, and its CID is hashed (SHA-256) and stored on-chain to keep the content address private until purchase.

#### 3.0.1 Manifest Purpose & Architecture

The Collection Manifest is a JSON document that contains:
- Complete metadata for every video in the collection
- Creator/performer information
- Technical specifications (resolution, VR support, duration)
- Timestamps, tags, and content warnings

**Privacy Model:**
1. Creator uploads manifest to IPFS → receives CID (e.g., `QmXYZ...`)
2. Creator computes SHA-256 hash of the CID → stores hash on-chain in `CollectionState`
3. Purchasers see only the hash on-chain (CID remains secret)
4. After purchase, pinners encrypt and reveal the actual CID to the buyer
5. Buyer fetches manifest from IPFS using revealed CID
6. Manifest contains CIDs of all individual videos in the collection

**Key Security Properties:**
- CID is never publicly visible on-chain (only the hash)
- Only authorized purchasers (holding Access NFT) can obtain the CID
- Manifest hash acts as a commitment—pinners cannot swap content after minting
- Buyers verify `SHA256(revealed_CID) == on_chain_hash` before accepting

#### 3.0.2 Manifest Schema (v1.0)

**Top-Level Structure:**
```json
{
  "schema_version": 1,
  "collection_id": "creator-collection-2024",
  "name": "Summer Collection 2024",
  "description": "Exclusive summer content from @creator",
  "creator": {
    "username": "creator_username",
    "display_name": "Creator Name",
    "wallet_address": "5xKb...",
    "bio": "Professional content creator...",
    "avatar_cid": "QmAvatar...",
    "social_links": {
      "twitter": "https://twitter.com/...",
      "website": "https://..."
    },
    "verified": true
  },
  "created_at": "2024-06-01T00:00:00Z",
  "updated_at": "2024-06-15T10:30:00Z",
  "total_videos": 12,
  "total_duration_seconds": 7200,
  "content_rating": "explicit",
  "tags": ["summer", "outdoor", "4k"],
  "cover_image_cid": "QmCover...",
  "preview_cid": "QmPreview...",
  "videos": [ /* array of video objects */ ]
}
```

**Video Object Structure:**
```json
{
  "video_id": "vid001",
  "title": "Summer Beach Day",
  "description": "A beautiful day at the beach...",
  "cid": "QmVideoContent...",
  "duration_seconds": 600,
  "recorded_at": "2024-06-05T14:30:00Z",
  "uploaded_at": "2024-06-06T09:00:00Z",
  "performer_username": "creator_username",
  "additional_performers": ["guest_performer"],
  "technical_specs": {
    "resolution": "3840x2160",
    "fps": 60,
    "codec": "h265",
    "bitrate_kbps": 15000,
    "is_vr": false,
    "audio_codec": "aac",
    "audio_bitrate_kbps": 256,
    "hdr": true
  },
  "thumbnail_cid": "QmThumb001...",
  "preview_clip_cid": "QmPreviewClip001...",
  "tags": ["beach", "outdoor", "daytime"],
  "content_warnings": [],
  "file_size_bytes": 1200000000,
  "file_format": "mp4"
}
```

**VR Video Example:**
```json
{
  "video_id": "vr_vid001",
  "title": "VR Experience: Sunset",
  "cid": "QmVRVideo...",
  "duration_seconds": 900,
  "recorded_at": "2024-06-10T19:00:00Z",
  "performer_username": "creator_username",
  "technical_specs": {
    "resolution": "7680x4320",
    "fps": 60,
    "codec": "h265",
    "bitrate_kbps": 40000,
    "is_vr": true,
    "vr_format": "equirectangular",
    "vr_stereo_mode": "side-by-side",
    "audio_codec": "aac",
    "audio_bitrate_kbps": 320
  },
  "tags": ["vr", "180", "sunset"]
}
```

#### 3.0.3 Schema Fields Reference

**Required Fields (Collection Level):**
- `schema_version` (number): Protocol version for forward compatibility (current: 1)
- `collection_id` (string): Matches on-chain CollectionState identifier
- `name` (string): Human-readable collection name
- `creator` (object): Creator/performer metadata
  - `username` (string): Stage name/handle
- `created_at` (ISO 8601 string): Manifest creation timestamp
- `total_videos` (number): Count of videos in collection
- `total_duration_seconds` (number): Sum of all video durations
- `content_rating` (string): "explicit" | "mature" | "general"
- `videos` (array): Array of video metadata objects

**Required Fields (Video Level):**
- `video_id` (string): Unique identifier within collection
- `title` (string): Video title
- `cid` (string): IPFS CID of video file
- `duration_seconds` (number): Video length in seconds
- `recorded_at` (ISO 8601 string): Recording timestamp
- `performer_username` (string): Primary performer stage name
- `technical_specs` (object): Technical specifications
  - `resolution` (string): Video dimensions (e.g., "1920x1080", "3840x2160")
  - `is_vr` (boolean): Whether this is a VR/360 video

**VR-Specific Fields (when is_vr = true):**
- `vr_format` (string): "equirectangular" | "cubemap" | "dome" | "fisheye"
- `vr_stereo_mode` (string): "mono" | "side-by-side" | "top-bottom" | "anaglyph"

**Optional but Recommended:**
- `fps` (number): Frame rate (30, 60, 120)
- `codec` (string): Video codec ("h264", "h265", "vp9")
- `bitrate_kbps` (number): Video bitrate
- `thumbnail_cid` (string): IPFS CID of thumbnail image
- `tags` (array): Content tags for search/discovery
- `file_size_bytes` (number): File size for bandwidth estimation

#### 3.0.4 Client Library Usage

The TypeScript client library provides builders for creating manifests:

```typescript
import {
  CollectionManifestBuilder,
  VideoMetadataBuilder,
  createStandardVideoSpecs,
  createVRVideoSpecs,
  hashCollectionManifest,
} from "@capturegem/client-library";

// Build a manifest
const builder = new CollectionManifestBuilder("collection-id", "Collection Name")
  .setDescription("My content collection")
  .setCreator({
    username: "performer_username",
    display_name: "Performer Name",
    verified: true,
  })
  .setContentRating("explicit")
  .setTags(["summer", "outdoor"]);

// Add videos
const video1 = new VideoMetadataBuilder("vid001", "Video Title", "QmVideo1...")
  .setDuration(600)
  .setRecordedAt(new Date("2024-06-01"))
  .setPerformer("performer_username")
  .setTechnicalSpecs(createStandardVideoSpecs("3840x2160", false))
  .setThumbnail("QmThumb1...")
  .build();

builder.addVideo(video1);

// Add VR video
const vrVideo = new VideoMetadataBuilder("vr001", "VR Experience", "QmVRVideo...")
  .setDuration(900)
  .setRecordedAt(new Date("2024-06-05"))
  .setPerformer("performer_username")
  .setTechnicalSpecs(
    createVRVideoSpecs("7680x4320", "equirectangular", "side-by-side", 60)
  )
  .build();

builder.addVideo(vrVideo);

// Build and hash
const { manifest, hash, hashHex } = builder.buildWithHash();

console.log("Manifest hash (for on-chain):", hashHex);

// Upload manifest to IPFS
const ipfs = create({ url: "http://127.0.0.1:5001" });
const { cid } = await ipfs.add(JSON.stringify(manifest));

console.log("Manifest CID (keep secret):", cid.toString());

// Verify: SHA256(cid) should match the hash
```

#### 3.0.5 Manifest Validation

The client library includes validation to ensure manifests are well-formed:

```typescript
import { validateCollectionManifest } from "@capturegem/client-library";

const validation = validateCollectionManifest(manifest);

if (!validation.valid) {
  console.error("Validation errors:", validation.errors);
  // [
  //   "Missing performer_username in video 2",
  //   "total_videos doesn't match videos array length",
  // ]
}
```

**Validation Rules:**
- All required fields present
- `total_videos` matches array length
- `total_duration_seconds` matches sum of video durations
- Each video has valid technical specs
- VR videos have VR-specific fields when `is_vr = true`
- Timestamps are valid ISO 8601 format
- CIDs are valid IPFS CIDs (basic format check)

#### 3.0.6 Forward Compatibility

The `schema_version` field enables protocol evolution:
- Current version: 1
- Future versions can add optional fields without breaking old clients
- Clients should check version and gracefully handle unknown fields
- Backwards-incompatible changes require version increment

**Migration Path:**
If a collection needs schema updates (e.g., adding new videos), the creator:
1. Creates new manifest with updated content
2. Uploads to IPFS → new CID
3. Calls `update_collection` on-chain with new CID hash
4. Existing purchasers are notified of update
5. Pinners begin serving new manifest to future purchasers

### 3.1 Tokenomics & Assets

**A. CAPGM (Ecosystem Token)**

- **Role:** The foundational utility token of the protocol.
- **Utility:** It is used as the Quote Currency in all Orca liquidity pools, streamlining the swapping experience. Additionally, it serves as the staking bond for Moderators, who must lock CAPGM to participate in governance and dispute resolution.

**B. Collection Tokens (Social Tokens)**

- **Standard:** Token-2022 (SPL Token Extensions). We utilize this standard to ensure future extensibility, such as potential transfer hooks for secondary market royalties or confidential transfers.
- **Liquidity Initialization (The 80/10/10 Split):** When a collection is minted, the token supply is distributed immediately to ensure instant market viability and fair incentives:
  - **80% → Orca Liquidity Pool:** This portion is deposited into a concentrated liquidity position paired with CAPGM. This massive initial liquidity provision acts as a bonding curve, ensuring that early buyers have valid counterparties and that price discovery can happen organically without a pre-sale.
  - **10% → Creator Wallet:** The initial stake for the uploader. This aligns the creator's financial success with the collection's popularity. As the token price rises due to demand, the value of this 10% holding increases.
  - **10% → Claim Vault:** Held in a Program Derived Address (PDA) for a strict 6-month vesting period. This acts as an insurance policy against IP theft.

- **Initial Liquidity Pairing Requirements:** When depositing 800,000 Collection Tokens (80% of supply) into the Orca pool, paired liquidity in CAPGM must be provided. The protocol requires the Creator to fund this initial liquidity pairing as a "Cost of Business."
  - **Scenario:** For a collection minting 1,000,000 tokens, 800,000 tokens are allocated to the Orca pool. These tokens cannot be deposited alone; they must be paired with the quote currency (CAPGM).
  - **Who Provides the CAPGM?**
    - **Option A (Adopted):** The Creator must provide the initial CAPGM (approximately $50-$100 worth). This requirement serves multiple purposes:
      - **Spam Prevention:** Creates an economic barrier to entry that prevents low-effort or spam collections from flooding the platform.
      - **Skin in the Game:** Ensures creators have financial commitment to their content's success.
      - **Market Signal:** Demonstrates the creator's confidence in their collection's value.
    - **Option B (Rejected):** Protocol-lent CAPGM would introduce systemic risk and potential for abuse, as creators could abandon collections without financial consequence.
  - **Economic Rationale:** This upfront cost is intentionally designed to be accessible for serious creators while prohibitive for spammers. The creator can recover this investment (and more) through the appreciation of their 10% token allocation and through staking rewards as their collection gains popularity.

**C. The Claim Vault & Burn Mechanism**

- **Purpose:** To protect against IP theft and "Copyright Trolling." If a user uploads stolen content, the true owner has a window of opportunity to prove ownership and claim this 10% reserve, effectively taking a significant ownership stake in the pirated collection.
- **Expiration & Deflation:** If no valid claim is processed within 6 months of minting, a permissionless instruction `burn_unclaimed_tokens` can be called by anyone. This permanently burns the 10% supply, creating a deflationary event that benefits all existing holders by reducing total supply while demand remains constant.

### 3.2 Program Derived Addresses (PDAs)

**A. Collection State**

Stores the immutable metadata, pool references, and claim timers required for protocol operation. Notably, the collection stores only the SHA-256 hash of the IPFS CID—not the CID itself—ensuring content addresses remain private and can only be revealed by authorized pinners to verified purchasers.

```rust
struct CollectionState {
    owner: Pubkey,               // The original creator
    collection_id: String,       // Unique slug (e.g., "cooking-101")
    cid_hash: [u8; 32],          // SHA-256 hash of the collection IPFS CID (not the CID itself)
    mint: Pubkey,                // The Collection Token Mint address
    pool_address: Pubkey,        // The specific Orca Whirlpool/Pool Address
    claim_vault: Pubkey,         // PDA holding the 10% reserve
    claim_deadline: i64,         // Timestamp (Now + 6 months)
    total_trust_score: u64,      // Aggregate reliability of this collection's swarm
    is_blacklisted: bool,        // Moderator toggle for illegal content
    bump: u8,
}
```

**B. Access Escrow**

A temporary holding account created when a user purchases access but hasn't finished downloading. This is the core component of the "Trust-Based" payment model. The escrow has a 24-hour expiration window, after which unclaimed funds are burned. Critically, the escrow stores only the SHA-256 hash of the collection CID—never the CID itself—ensuring that content addresses remain private until revealed by an authorized pinner. Additionally, the escrow links to the Access NFT that serves as the cryptographic proof of purchase.

```rust
struct AccessEscrow {
    purchaser: Pubkey,           // The user buying content (only they can release funds)
    collection: Pubkey,          // The content being bought
    access_nft_mint: Pubkey,     // The NFT mint address proving access rights
    cid_hash: [u8; 32],          // SHA-256 hash of the collection CID (for verification)
    amount_locked: u64,          // Tokens bought from the pool (50% of purchase), waiting for release
    created_at: i64,             // Timestamp for 24-hour burn timeout logic
    is_cid_revealed: bool,       // Whether a pinner has revealed the CID
    bump: u8,
}
```

**B.1 CID Reveal**

Stores the encrypted CID message sent by a pinner to the purchaser. Only the purchaser can decrypt this message using their wallet's private key.

```rust
struct CidReveal {
    escrow: Pubkey,              // The AccessEscrow this reveal is for
    pinner: Pubkey,              // The peer who revealed the CID (must be a registered pinner)
    encrypted_cid: Vec<u8>,      // CID encrypted with purchaser's public key (X25519/ECIES)
    revealed_at: i64,            // Timestamp of reveal
    bump: u8,
}
```

**C. Peer Trust State**

Tracks the historical reliability of a specific node (Peer). This is a persistent on-chain reputation identity.

```rust
struct PeerTrustState {
    peer_wallet: Pubkey,
    total_successful_serves: u64, // Total number of released escrows
    trust_score: u64,             // Weighted score (Serves * Consistency)
    last_active: i64,             // For pruning inactive nodes
}
```

### 3.3 Encrypted CID Revelation Scheme

The protocol employs a cryptographic handshake to securely reveal content addresses only to verified purchasers while keeping CIDs private from the public blockchain.

**Cryptographic Primitives:**

- **Hash Function:** SHA-256 for CID commitment (stored in `CollectionState` and `AccessEscrow`).
- **Asymmetric Encryption:** X25519-XSalsa20-Poly1305 (NaCl/libsodium box) for encrypting CIDs. The purchaser's Ed25519 wallet key is converted to X25519 for encryption/decryption.

**Security Properties:**

1. **Privacy:** The actual IPFS CID is never stored on-chain in plaintext. Only the SHA-256 hash is public.
2. **Authenticity:** Purchasers verify that `SHA256(decrypted_cid) == escrow.cid_hash`, ensuring the pinner provided the correct content address.
3. **Non-Repudiation:** The `CidReveal` account is signed by the pinner, creating an on-chain record of who revealed what.
4. **Purchaser-Only Access:** Only the purchaser's private key can decrypt the CID, preventing unauthorized access.

**Why Not Encrypt Content Instead?**

The protocol encrypts the *address* (CID), not the content itself, for efficiency:
- IPFS content is naturally deduplicated via content-addressing. Encrypting content would break deduplication.
- Encrypting CIDs is computationally trivial (< 100 bytes), while encrypting video content would be expensive.
- The CID acts as a "capability token"—knowing it grants access to fetch from any IPFS node.

### 3.4 NFT-Based Access Control at the Peer-to-Peer Layer

To prevent unauthorized access at the IPFS peer-to-peer level, the protocol mints a unique **Access NFT** for each purchase. This NFT serves as a cryptographic proof of ownership that pinners verify before serving content.

**A. Access NFT Minting**

When a user purchases access via the `purchase_access` instruction:
1. A unique NFT mint is created using **Token-2022 (SPL Token Extensions)** with the **Non-Transferable extension** enabled.
2. One (1) token is minted to the purchaser's wallet (non-divisible, supply = 1).
3. The NFT mint address is stored in the `AccessEscrow` for reference.
4. The NFT metadata includes (via Metaplex Token Metadata):
   - `collection`: The collection ID this NFT grants access to
   - `purchaser`: The wallet that owns access rights
   - `purchased_at`: Timestamp of purchase
5. **Critical Security Feature:** The Token-2022 Non-Transferable extension permanently prevents the NFT from being transferred, sold, or stolen. Once minted to the purchaser's wallet, it cannot be moved to any other wallet, ensuring access rights remain tied to the original buyer.

**B. Pinner Verification Protocol**

Before serving any content block via IPFS Bitswap, pinners perform on-chain verification:

```
HANDSHAKE PROTOCOL:
1. Purchaser initiates IPFS connection to pinner's peer ID
2. Purchaser sends signed message: {wallet_address, collection_id, nft_mint_address, timestamp, signature}
3. Pinner verifies:
   a. Signature is valid for the claimed wallet_address
   b. NFT mint exists at nft_mint_address
   c. NFT is owned by wallet_address (via on-chain query)
   d. NFT metadata.collection matches the requested collection_id
   e. Timestamp is recent (< 5 minutes, prevents replay attacks)
4. If all checks pass → serve content
5. If any check fails → reject connection and log unauthorized attempt
```

**C. On-Chain NFT Verification**

Pinners query the Solana blockchain to verify NFT ownership:
- **RPC Call**: `getTokenAccountsByOwner` filtered by NFT mint address
- **Validation**: Ensure the purchaser's wallet holds exactly 1 token of the NFT mint
- **Caching**: Verification results can be cached for ~30 seconds to reduce RPC load
- **Fallback**: If RPC fails, pinners can accept connections but flag them for manual review

**D. Security Properties**

1. **Non-Transferable (Enforced)**: The NFT uses Token-2022's Non-Transferable extension, making it **impossible** to transfer, sell, or gift. This prevents:
   - **Access Resale Markets:** Users cannot sell access to third parties.
   - **Wallet Compromise:** Even if a wallet's private key is stolen, the NFT cannot be moved.
   - **Sybil Attacks:** Each purchase is permanently bound to the original purchaser's wallet.
   - The only way to "transfer" access is for the original purchaser to share their wallet's private key (which defeats the purpose and is easily detectable).
2. **Wallet-Bound Access**: The NFT is permanently tied to the `AccessEscrow.purchaser` wallet. This wallet-binding is enforced both:
   - **On-Chain:** Via Token-2022 program constraints (transfer instructions fail).
   - **At Peer Layer:** Pinners verify NFT ownership matches the connecting wallet.
3. **Expiration**: While NFTs have no inherent expiration, pinners can enforce time-based access by checking the `purchased_at` timestamp in the NFT metadata and refusing service after a configurable period (e.g., 90 days).
4. **Sybil Resistance**: Each purchase requires a swap on Orca (real economic cost), making it expensive to create fake access accounts.

**E. Why NFTs Instead of Escrow-Only Verification?**

While pinners could theoretically verify access by checking for an `AccessEscrow` account, NFTs provide several advantages:
- **Persistent Proof**: Escrows expire/close after 24 hours, but NFTs remain as permanent receipts.
- **Standard Interface**: NFTs use Token-2022 standards, allowing wallets and explorers to display access rights.
- **True Non-Transferability**: Token-2022's Non-Transferable extension provides cryptographic enforcement that cannot be bypassed, unlike policy-based restrictions.
- **Offline Verification**: Pinners can verify NFT ownership without querying custom PDA structures.
- **Freeze & Burn Capability**: The protocol retains freeze/burn authority for moderation purposes.

**F. Key Benefits of Non-Transferable Access NFTs**

The use of Token-2022's Non-Transferable extension provides critical security and economic benefits:

1. **Prevents Access Resale Markets**: Unlike traditional NFTs, these cannot be sold on secondary markets, ensuring creators capture full value from each sale.

2. **Anti-Piracy Enforcement**: Even if someone obtains the collection CID, they cannot access content from pinners without the non-transferable NFT bound to their wallet.

3. **Wallet Compromise Protection**: If a user's wallet is hacked, the attacker cannot move the access NFT to their own wallet, limiting damage.

4. **Regulatory Compliance**: Non-transferability helps avoid classification as a security, as the NFT has no investment value or speculative market.

5. **Fair Creator Revenue**: Every viewer must purchase their own access, eliminating "group buy" schemes where one purchase is shared among many users.

6. **Audit Trail**: Each access NFT creates a permanent, immutable record of who purchased access and when, useful for analytics and compliance.

7. **Moderation Effectiveness**: Freezing or burning a non-transferable NFT immediately revokes access with no recovery path (user can't transfer to a new wallet).

**D. Collection Staking Pool**

Manages the staking of collection tokens and distribution of rewards to stakers when access is purchased.

```rust
struct CollectionStakingPool {
    collection: Pubkey,           // The collection this pool is for
    total_staked: u64,            // Total collection tokens staked in this pool
    reward_per_token: u128,       // Accumulated rewards per token (scaled)
    bump: u8,
}
```

**E. Staker Position**

Tracks an individual user's stake in a collection staking pool and their earned rewards.

```rust
struct StakerPosition {
    staker: Pubkey,               // The user who staked
    collection: Pubkey,           // The collection being staked
    amount_staked: u64,           // Number of collection tokens staked
    reward_debt: u128,            // Used to calculate pending rewards
    bump: u8,
}
```

## 4. Workflows

### 4.1 Collection Creation & Minting

- **Content Preparation:** Creator uploads all video files to IPFS and receives CIDs for each video.
- **Manifest Creation:** Using the `CollectionManifestBuilder`, creator constructs a complete catalog with:
  - Video CIDs, titles, descriptions
  - Recording timestamps
  - Performer usernames
  - Technical specs (resolution, VR format, duration)
  - Thumbnails and preview clips
- **Manifest Upload:** Creator uploads the manifest JSON to IPFS → receives manifest CID
- **CID Hashing:** Creator computes SHA-256 hash of the manifest CID (this hash will be stored on-chain)
- **Initialization:** User calls `create_collection`, providing:
  - The `collection_id` (unique slug).
  - The SHA-256 hash of the collection's IPFS manifest CID (`cid_hash`). The actual CID is never stored on-chain.
  - The creator must be actively pinning the manifest and all video content on IPFS.
- **CID Hash Commitment:** The `cid_hash` is stored in the `CollectionState` PDA. This hash is publicly visible and used by purchasers to verify that pinners reveal the correct manifest CID. The actual content address remains private, known only to the creator and authorized pinners.
- **Mint & Distribute:**
  - The Program mints the total supply (e.g., 1,000,000 tokens) of the Collection Token.
  - 10% is transferred to the Creator's wallet.
  - 10% is transferred to the Claim Vault PDA.
  - 80% is transferred via CPI (Cross-Program Invocation) to the Orca program. The protocol atomically initializes a liquidity position. Note: The Creator must approve the transfer of the initial pairing asset (CAPGM) to fund the other side of the pool.

### 4.2 Purchasing Access (The Escrow Flow)

Unlike traditional models where payment goes directly to a creator, CaptureGem directs payment liquidity to the market (supporting the token price) and then splits it between collection token holders and infrastructure providers (Peers).

**Payment Distribution:** When a user purchases access to a collection, the payment is split as follows:
- **50% → Collection Ownership Pool:** This portion flows to a staking pool where collection token holders can stake their tokens to earn rewards. This creates a direct incentive for token holders to support and promote their collections.
- **50% → Peers Escrow:** This portion is locked in an `AccessEscrow` PDA and distributed to IPFS peers who successfully deliver the content, enforcing the Trust-Based payment model.

**Purchase Flow:**

- **Initiate Purchase:** The user clicks "Watch" or "Buy Access" in the client. The UI displays collection metadata (title, preview, price) but crucially **not** the actual IPFS CID, which remains private until after purchase.
- **CID Hash Commitment:** The client constructs the purchase transaction including the SHA-256 hash of the collection CID. This hash is publicly known (displayed in the collection listing) but reveals nothing about the actual content address. The purchaser's wallet public key is included for encrypted CID delivery.
- **DEX Swap:** The client executes a transaction that swaps the user's CAPGM for Collection Tokens via the Orca Pool. This buy pressure increases the value of the creator's held tokens.
- **Payment Split:** The purchased tokens are split automatically:
  - 50% is transferred to the Collection Ownership Staking Pool where token stakers earn proportional rewards.
  - 50% is locked in an `AccessEscrow` PDA (with the `cid_hash` stored), awaiting content delivery confirmation.
- **Access NFT Minting:** Atomically with the escrow creation, an Access NFT is minted:
  1. A unique NFT mint account is created using **Token-2022 with Non-Transferable extension** (1 token supply, 0 decimals).
  2. The single token is minted to the purchaser's wallet.
  3. **Non-Transferable Enforcement**: The Token-2022 Non-Transferable extension is enabled on the mint, making it cryptographically impossible to transfer the NFT to any other wallet. This ensures:
     - Access rights are permanently bound to the purchaser's wallet.
     - No secondary markets can form for access rights.
     - Stolen/compromised wallets cannot transfer access to attackers.
  4. Metadata is attached via Metaplex Token Metadata program:
     - `name`: "Access Pass: {collection_name}"
     - `symbol`: "ACCESS"
     - `uri`: Points to off-chain metadata (collection thumbnail, description)
     - `collection`: References the collection ID
     - `purchaser`: Original purchaser wallet address
     - `purchased_at`: Unix timestamp
  5. The NFT mint address is stored in the `AccessEscrow.access_nft_mint` field.
  6. The protocol retains **freeze authority** on the mint to enable moderation (revoking access by freezing the token account).
  7. This NFT becomes the purchaser's cryptographic proof of access rights.
- **Pinner CID Reveal:** One of the pinners who is actively hosting the collection observes the new `AccessEscrow` on-chain. The pinner:
  1. Encrypts the collection CID using the purchaser's wallet public key (X25519-XSalsa20-Poly1305 / ECIES).
  2. Submits a `reveal_cid` transaction that creates a `CidReveal` account containing the encrypted CID bytes.
  3. Only the purchaser can decrypt this message using their wallet's private key.
- **Purchaser CID Verification:** Upon receiving the `CidReveal` event, the purchaser's client:
  1. Decrypts the encrypted CID using their wallet's private key.
  2. Computes the SHA-256 hash of the decrypted CID.
  3. Compares this hash against the `cid_hash` stored in their `AccessEscrow` account.
  4. **If the hashes match:** The CID is authentic, and the client proceeds to download content.
  5. **If the hashes do not match:** The reveal is rejected as fraudulent, and the client waits for another pinner to provide a valid reveal.
- **Collection Manifest Structure:** The revealed CID points to a **Collection Manifest Document**—a JSON or CBOR file stored on IPFS that contains the CIDs of all individual videos in the collection. This two-tier structure allows a single purchase to unlock multiple pieces of content:
  ```json
  {
    "collection_id": "cooking-101",
    "version": 1,
    "videos": [
      { "title": "Episode 1", "cid": "Qm...video1", "duration": 1800 },
      { "title": "Episode 2", "cid": "Qm...video2", "duration": 2100 },
      { "title": "Episode 3", "cid": "Qm...video3", "duration": 1650 }
    ]
  }
  ```
- **NFT Verification at Peer Connection:** Before connecting to IPFS peers to download content, the purchaser's client:
  1. Signs a handshake message containing their wallet address, collection ID, NFT mint address, and current timestamp.
  2. Presents this signed message to each pinner during the IPFS connection handshake.
  3. Pinners verify the signature and check on-chain that the wallet owns the Access NFT.
  4. Only pinners that accept the NFT proof will serve content blocks via Bitswap.
  5. This prevents unauthorized users (who don't own the NFT) from accessing content even if they somehow obtain the CID.
- **Content Download:** With the verified collection CID and accepted NFT proof, the client fetches the manifest and then begins requesting the individual video CIDs from the IPFS swarm.

**Collection Token Staking:**

Collection token holders can stake their tokens in a collection-specific staking pool to earn passive rewards. Each time someone purchases access to that collection, the 50% allocated to the Collection Ownership Pool is distributed proportionally to all stakers based on their stake. This mechanism:
- Rewards long-term token holders and believers in the collection's success.
- Creates a sustainable revenue stream beyond the initial 10% creator allocation.
- Incentivizes community marketing and organic promotion of collections.

### 4.3 Trust-Based Fulfillment (The Download)

This workflow enforces the "Trust-Based" system where payment is conditional on service. The purchaser has complete control over which peers receive payment, creating a meritocratic system where only peers that successfully deliver content are rewarded. Note that peers receive the 50% of the purchase price that was locked in the `AccessEscrow` PDA (the other 50% was already distributed to collection token stakers).

**Pinner Payment Model:**

Pinners (IPFS peers) are paid exclusively through the escrow release mechanism. There is no separate reward claiming system for pinners. Payment works as follows:

- **Registration:** Pinners register as hosts for a collection via `register_collection_host`, which creates a `PinnerState` account to track their active status.
- **Payment Source:** Pinners receive payment only when purchasers release escrow funds via the `release_escrow` instruction. The 50% of purchase price locked in escrow is distributed to peers based on actual content delivery performance.
- **No Separate Rewards:** Pinners do not accumulate rewards in a separate pool or claim rewards independently. All payment is conditional on successful content delivery as determined by the purchaser.

**Pinner Incentive to Reveal CID:**

Pinners are incentivized to monitor the blockchain for new `AccessEscrow` accounts and promptly reveal the CID because:
- Only peers who are included in the purchaser's final `release_escrow` transaction receive payment.
- The pinner who reveals the CID establishes a relationship with the purchaser, increasing their chances of being selected for content delivery.
- Pinners who consistently provide fast, valid CID reveals build on-chain reputation, attracting more purchase traffic.
- If no pinner reveals the CID within 24 hours, the escrow burns and no one earns—creating urgency for pinners to act.

**NFT-Based Access Verification:**

Before serving any content, pinners enforce strict access control at the peer-to-peer layer:

1. **Connection Handshake:** When a purchaser's IPFS node connects to a pinner's node, the purchaser must present a signed access proof message.

2. **Proof Message Structure:**
   ```json
   {
     "wallet_address": "5xKbW...",
     "collection_id": "cooking-101",
     "access_nft_mint": "8yFmZ...",
     "timestamp": 1704326400,
     "signature": "3vGtY..."  // Ed25519 signature by wallet's private key
   }
   ```

3. **Pinner Verification Steps:**
   - **Signature Validation:** Verify the signature matches the claimed wallet_address.
   - **NFT Ownership Check:** Query Solana RPC to confirm the wallet owns the Access NFT:
     ```
     getTokenAccountsByOwner(wallet_address, {mint: access_nft_mint})
     ```
   - **NFT Metadata Verification:** Ensure the NFT's metadata.collection matches the requested collection_id.
   - **Timestamp Freshness:** Reject proofs older than 5 minutes (prevents replay attacks).
   - **Escrow Validation (Optional):** Cross-check that an `AccessEscrow` exists/existed for this purchaser+collection pair.

4. **Access Decision:**
   - **If all checks pass:** Pinner adds the purchaser to an allowlist and serves content blocks via IPFS Bitswap.
   - **If any check fails:** Pinner rejects the connection, logs the unauthorized attempt, and does not serve content.

5. **Caching & Performance:** To minimize RPC load, pinners cache NFT verification results for ~30 seconds. Subsequent block requests from the same wallet within this window are served without re-verification.

**The Trust-Based Payment Model:**

The buyer is the ultimate arbiter of which peers deserve payment. This creates strong incentives for peers to provide high-quality, fast, and reliable service:

- **CID Acquisition:** After a pinner reveals the encrypted CID and the purchaser verifies it (as described in 4.2), the client has the authentic collection CID and can fetch the manifest.
- **Discovery:** The Purchaser's client uses the IPFS DHT (Distributed Hash Table) to find peers hosting the individual video CIDs listed in the collection manifest.
- **NFT Presentation:** For each discovered peer, the purchaser's client sends the signed NFT proof message. Only peers that accept the proof (after verification) will serve content.
- **Connection & Monitoring:** The Purchaser's IPFS Check Tool actively monitors the data stream via the Bitswap protocol. It logs granular accounting data:
  - Peer ID X sent 500MB (Blocks 1-5000).
  - Peer ID Y sent 200MB (Blocks 5001-7000).
  - Peer ID Z connected but sent 0MB (Timed out or rejected NFT proof).
- **Client Decision:** Upon download completion (or sufficient streaming buffer), the client algorithmically determines that Peer X and Peer Y are valid earners based on "Useful Bytes Delivered."
- **Buyer-Controlled Settlement:**
  - The purchaser's client constructs a `release_escrow` transaction containing the list of valid Peer Wallets [WalletX, WalletY] and their respective weights based on actual bytes delivered.
  - The User signs this transaction (High-Risk Action), explicitly approving which peers earned the payment.
- **On-Chain Execution:**
  - The Solana Program validates the signature matches the `AccessEscrow` owner (the purchaser).
  - The tokens in escrow (50% of purchase) are split according to the provided weights and sent to Wallet X and Wallet Y.
- **Trust Score Update:** The Program increments the `PeerTrustState` for each peer that receives payment. This increases their global reputation, making them preferred nodes for future users via the Indexer's trusted endpoint. The buyer's decision directly impacts the on-chain reputation of peers.

**24-Hour Burn Mechanism (Anti-Abandonment):**

To prevent escrow accounts from accumulating indefinitely and to ensure economic finality, the protocol includes an automatic burn mechanism:

- **Escrow Expiration:** Each `AccessEscrow` account includes a `created_at` timestamp. If the purchaser does not release funds to peers within 24 hours, the escrow enters an expired state.
- **Permissionless Burn:** After the 24-hour window, anyone can call the `burn_expired_escrow` instruction. This is a permissionless action that can be executed by any network participant (typically automated by indexers or bots).
- **Token Destruction:** The tokens in the expired escrow are permanently burned, reducing the total supply of the collection token. This creates a deflationary event that benefits all remaining token holders.
- **Economic Rationale:** This mechanism serves multiple purposes:
  - **Prevents Abandonment:** Ensures purchasers complete the payment cycle or forfeit the funds.
  - **Network Hygiene:** Automatically cleans up stale escrow accounts, recovering rent and reducing blockchain state bloat.
  - **Deflationary Pressure:** Burned tokens increase scarcity, supporting token price for honest participants.
  - **Fair to Peers:** While peers don't receive payment if the buyer abandons the transaction, the tokens don't remain locked indefinitely, and the burn benefits the ecosystem overall.

**Why the Buyer Controls Payment:**

This trust-based model is fundamentally different from traditional escrows:
- **Quality Enforcement:** Peers must actually deliver high-quality service to earn payment. Simply hosting the file is not enough.
- **Byzantine Resistance:** The buyer can refuse payment to malicious or non-performing peers, preventing bad actors from earning rewards.
- **Reputation Building:** Peers build on-chain reputations based on successful deliveries, creating a transparent history of reliability.
- **Self-Correcting Network:** Over time, high-trust peers naturally rise to the top and receive preferential connections, while low-performing peers are filtered out.

### 4.4 Collection Token Staking & Reward Distribution

This workflow enables passive income for collection token holders through a staking mechanism that captures value from access purchases.

**Staking Collection Tokens:**

- **Initiate Stake:** A collection token holder calls the `stake_collection_tokens` instruction, specifying the collection and the amount of tokens they wish to stake.
- **Transfer to Pool:** The tokens are transferred from the user's wallet to the Collection Staking Pool PDA.
- **Position Creation:** A `StakerPosition` account is created (or updated) to track the user's stake and their share of future rewards.
- **Reward Accounting:** The staker's `reward_debt` is initialized based on the current `reward_per_token` rate to ensure they only receive rewards from future purchases, not historical ones.

**Earning Rewards from Access Purchases:**

- **Purchase Event:** When a user purchases access to a collection, 50% of the purchased tokens flow to the Collection Staking Pool.
- **Reward Distribution:** These tokens are distributed proportionally to all stakers in the pool based on their stake percentage. The distribution is calculated using the `reward_per_token` mechanism:
  ```
  reward_per_token += (tokens_from_purchase * PRECISION) / total_staked
  ```
- **Accumulation:** Rewards accumulate automatically without requiring any action from stakers. They can be claimed at any time.

**Claiming Rewards:**

- **Initiate Claim:** A staker calls the `claim_staking_rewards` instruction.
- **Calculation:** The program calculates pending rewards:
  ```
  pending_rewards = (staker.amount_staked * pool.reward_per_token) - staker.reward_debt
  ```
- **Transfer:** The calculated reward tokens are transferred from the Staking Pool to the staker's wallet.
- **Update State:** The staker's `reward_debt` is updated to reflect the claim, preventing double-claiming.

**Unstaking:**

- **Initiate Unstake:** A staker calls the `unstake_collection_tokens` instruction.
- **Claim Pending:** Any pending rewards are automatically claimed first.
- **Token Return:** The staked collection tokens are transferred back to the staker's wallet.
- **Position Cleanup:** If the staker fully unstakes, their `StakerPosition` account can be closed to recover rent.

**Economic Implications:**

This staking mechanism creates several powerful incentives:
- **Long-term Holding:** Token holders are incentivized to hold and stake rather than immediately sell after receiving tokens.
- **Community Alignment:** Stakers benefit directly from the popularity of the collection, aligning their interests with promoting and supporting the content.
- **Passive Income:** Creators who hold their initial 10% allocation can stake it to earn ongoing revenue beyond the initial token distribution.
- **Price Support:** By locking tokens in staking pools, circulating supply is reduced, creating upward price pressure that benefits all token holders.

### 4.5 Copyright Claims

- **Dispute:** A third party realizes a collection violates their IP.
- **Submission:** They submit a `PerformerClaim` ticket via the client, attaching off-chain proof (e.g., links to original verified social media).
- **Moderation:** Staked Moderators review the claim. They compare the timestamp of the blockchain record against the provided evidence.
- **Resolution:**
  - **If Approved:** The 10% tokens sitting in the Claim Vault are immediately transferred to the Claimant's wallet. The Claimant effectively becomes a major stakeholder in the collection.
  - **If Expired:** If 6 months pass without a valid claim, the `burn_unclaimed_tokens` instruction can be called by any user. This burns the tokens in the vault, permanently reducing the total supply.

## 5. Off-Chain Indexer API

The Indexer bridges the gap between the immutable Solana blockchain and the responsive client UI.

### 5.1 Trust & Discovery Endpoints

- **GET `/nodes/trusted`:** Returns a list of Peers with high `PeerTrustState` scores. The client uses this list to prioritize connections ("Swarm Connect") for faster downloads, ensuring users connect to reliable, high-bandwidth nodes first.
- **GET `/collections/:id/pool`:** Returns real-time pricing data from the Orca pool, allowing the UI to display the USD cost of access dynamically.

### 5.2 Moderation Sync & Blacklisting

- The Indexer listens for `CopyrightClaim` and `ContentReport` events.
- If a claim is successful, the Indexer updates the collection metadata to reflect the new "True Owner," ensuring the UI displays the correct attribution.
- If a `ContentReport` is approved (for illegal content), the Indexer flags the content in its database. While the data remains on IPFS, the official client will refuse to resolve the CID, effectively de-platforming the content from the average user's view.

## 6. Moderation System (Staked Moderators)

The platform relies on decentralized moderation to handle illegal content and IP disputes without a central authority.

### 6.1 Roles

- **Reporter:** Any user who flags content or submits IP claims.
- **Moderator:** A user who stakes a significant amount of CAPGM tokens to gain voting power on tickets. Their stake serves as a bond of good behavior.
- **Super Moderator:** A DAO-elected entity that oversees the system and has the power to slash malicious moderators.

### 6.2 Ticket Types

- **ContentReport:** Used for flagging Illegal or TOS-violating content. Result: Blacklisting from Indexer and potentially slashing the Creator's Trust Score.
- **CopyrightClaim:** Used for IP disputes. Result: Transfer of the 10% Claim Vault tokens to the reporter.

### 6.3 Economic Security

Moderators must stake CAPGM to rule on Copyright Claims. This introduces "Skin in the Game."

- **Scenario:** If Moderators collude to approve false claims (stealing the 10% vault for themselves), they can be challenged.
- **Slashing:** If a Super Moderator reviews the decision and finds it fraudulent, the malicious Moderators' staked CAPGM is slashed (burned or sent to treasury). This potential loss is mathematically designed to be greater than the potential gain from stealing the vault, creating a strong economic disincentive for corruption.
