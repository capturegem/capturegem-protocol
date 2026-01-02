# Technical Design Document: CaptureGem Decentralized Protocol (CDP)

**Version:** 1.0  
**Date:** Jan 2, 2026  
**Status:** Draft

## 1. Executive Summary

CaptureGem CDP is a decentralized application (DApp) allowing users to share, sell, and moderate video content using the Solana blockchain. The protocol utilizes a SocialFi model where users can create multiple Content Collections. Each Collection has its own unique Collection Token. Access to a specific collection is gated by a View Rights NFT, which users can mint only if they hold a sufficient USD value of that specific Collection's token.

## 2. System Architecture

The system consists of three primary layers, with the client-side leveraging a self-contained, portable runtime.

### 2.1 Client Technology Stack (Electron & Portable Runtime)

- **Framework:** Electron.js (Chromium + Node.js).
- **Portable IPFS:** Bundled Kubo (go-ipfs) binary managed by the main process.
- **Embedded Wallet:** Local filesystem wallet with "Autosigning" capabilities for low-risk actions.

### 2.2 High-Level Diagram

```
[User A (Owner)]         [User B (Buyer)]       [ViewRights Contract]
      |                        |                         |
      | -- Creates Collection->|                         |
      |   (Mints Token A)      |                         |
      |                        | -- Holds Token A -----+ |
      |                        |    (Asset)            | |
      |                        |                       v |
      |                        | <--- Mints NFT ----- [1. Check Balance]
      |                        |    (Valid 3 Months)  [2. Query Oracle]
      |                        |                      [3. Calc USD Value]
[Solana Program] <-------------+                         |
      | (Harvests Fees)                                  |
      +---> [Pinners (50%)]                              |
      +---> [Collection Owner (20%)]                     |
      +---> [Performer Vault (20%)]                      |
      +---> [Stakers (10%)]                              |
```

## 3. Solana Program Design (The Smart Contract)

The core logic resides in a custom Solana Program (Rust/Anchor).

### 3.1 Tokenomics & Assets

#### A. CAPGM (Ecosystem Token)

- Used as the "Quote Currency" in Orca pools.
- **Staking:** Required for Pinners and Moderators.

#### B. Collection Tokens (Social Tokens)

- **Scope:** Per-Collection (A user can have multiple).
- **Standard:** Token-2022 (SPL Token Extensions) with 10% Transfer Fee.
- **Purpose:** Proof of Eligibility for View Rights to that specific collection.

#### C. View Rights NFT (Access Badge)

- **Validity Period:** 3 Months.
- **Condition:** User must hold Collection Tokens worth >= $10.00 USD (verified via Price Oracle).
- **Scope:** Specific to one CollectionState.

### 3.2 Program Derived Addresses (PDAs)

#### A. Global Protocol State

Stores configuration URLs and minimum stake requirements.

```rust
struct GlobalState {
    admin: Pubkey,
    indexer_api_url: String,   
    node_registry_url: String,
    moderator_stake_minimum: u64,
}
```

#### B. User Account & IPNS Identity

Global identity for a wallet.

```rust
struct UserAccount {
    authority: Pubkey,
    ipns_key: String,   // Points to off-chain metadata (Avatar, Bio)
    is_online: bool,
}
```

**IPNS Strategy:** To save on-chain rent, mutable profile data (Bio, Avatar URL, Social Links) is stored on IPFS. The User publishes this data to IPNS, and only the fixed IPNS Key string is stored on Solana. The Client resolves this key to fetch profile details.

#### C. Collection State

Represents a specific library of content owned by a user.

**Seeds:** `['collection', owner_pubkey, collection_id_hash]`

```rust
struct CollectionState {
    owner: Pubkey,
    collection_id: String,       // e.g. "travel-vlog-2025"
    collection_token_mint: Pubkey,
    oracle_feed: Pubkey,         // Price feed for this specific token
    access_threshold_usd: u64,
    max_video_limit: u32,        // e.g., 100 videos max
    video_count: u32,
    reward_pool_balance: u64,    // Accumulated 50% fees waiting for Pinners
}
```

#### D. Pinner Bonding (Signaling)

Links a Pinner to a specific collection they host.

**Seeds:** `['host_bond', pinner_pubkey, collection_state_key]`

```rust
struct PinnerCollectionBond {
    pinner: Pubkey,
    collection: Pubkey,
    last_audit_pass: i64, // Timestamp of last successful availability check
}
```

## 4. Off-Chain Indexer API Specification

The "Indexer" functions as the query layer for the CaptureGem ecosystem, bridging the gap between the high-integrity but low-queryability Solana blockchain and the rich user experience required by the Client. While the blockchain remains the source of truth for ownership and permissions, the Indexer caches state, aggregates metadata, and provides search capabilities.

### 4.1 Architecture & Synchronization

The Indexer is composed of three services:

1. **Chain Listener:** Subscribes to Solana RPC WebSocket logs to detect program events (CollectionCreated, ModTicketResolved, PinnerBonded). It maintains an up-to-date mapping of on-chain state in a relational database (PostgreSQL).
2. **IPFS Crawler:** When a new Collection or Video is detected on-chain, this service resolves the associated IPNS/IPFS CIDs to fetch off-chain metadata (titles, descriptions, thumbnails) and validates that the content is technically retrievable.
3. **API Gateway:** A RESTful API layer (Node.js/FastAPI) backed by Redis caching that serves read requests to the Electron Client.

### 4.2 Enhanced Data Models

The schema aggregates on-chain PDA data with off-chain IPFS JSON metadata.

#### Collection (Aggregate):

- `id`: String (Slug/UUID)
- `owner`: Pubkey (Solana Address)
- `tokenMint`: Pubkey (The access token)
- `oracleFeed`: Pubkey (Price source)
- `accessThresholdUsd`: Number (e.g., 10.00)
- `metadata`: Object (Fetched from IPFS)
  - `title`: String
  - `description`: String
  - `tags`: String[]
  - `category`: Enum (Vlog, Gaming, Education, etc.)
  - `thumbnailUrl`: String (IPFS Gateway URL)
- `stats`: Object
  - `videoCount`: Number
  - `subscriberCount`: Number (Unique holders of ViewRights)
  - `totalVolume`: Number (Historical volume of Token-2022 transfers)

#### Video (Aggregate):

- `id`: String (Content Hash)
- `collectionId`: String
- `modelUsername`: String (Performer Name)
- `rootCid`: String (The directory containing the HLS playlist)
- `manifestPath`: String (e.g., "/master.m3u8")
- `duration`: Number (Seconds)
- `resolutions`: String[] (e.g., ["1080p", "720p", "480p"])
- `transcodingStatus`: Enum (Processing, Ready, Failed)
- `uploadTimestamp`: ISO Date

#### Node (Pinner):

- `peerId`: String (Libp2p Peer ID)
- `walletAddress`: Pubkey
- `reputationScore`: Number (0-100)
- `latencyMs`: Number (Average ping from Indexer)
- `collectionsHosted`: String[] (List of Collection IDs)
- `isOnline`: Boolean

### 4.3 Endpoints & Query Logic

All list endpoints support cursor-based pagination and standard sorting parameters.

| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| GET | `/collections` | `page`, `limit`, `sort` (newest, popular), `category` | List collections with metadata. |
| GET | `/collections/search` | `q` (text query), `tags` | Full-text search on titles and descriptions. |
| GET | `/collections/:id` | - | Detailed view including aggregated stats. |
| GET | `/collections/:id/videos` | `page`, `limit` | List videos within a collection. |
| GET | `/collections/:id/nodes` | `min_reputation` | List active IPFS peers pinning this collection (used for "swarm connect"). |
| GET | `/nodes/active` | `region` (e.g., "NA", "EU") | List verified high-uptime nodes for bootstrapping DHT connections. |
| GET | `/user/:pubkey/profile` | - | Resolve UserAccount IPNS key to JSON profile (Bio, Avatar). |

### 4.4 Consistency & Moderation Enforcement

The Indexer plays a critical role in enforcing moderation decisions made by the DAO.

- **Blacklist Sync:** The Chain Listener monitors ModTicket events. If a ticket is resolved with status Approved (meaning the content was found to be illegal/TOS-violating), the Indexer immediately marks the Video or Collection as `is_blacklisted = true` in the database.
- **API Filtering:** The API Gateway automatically filters out any blacklisted content from all GET responses. This ensures that while the data might technically exist on IPFS, it is not discoverable via the official client interface.
- **Hash Registry:** A global "Bad Hash" registry is maintained to prevent re-uploading of known infringing content. If the IPFS Crawler detects a new video with a hash matching a blacklisted entry, it is preemptively hidden.

## 5. Workflows

### 5.1 Collection Creation

1. **User Init:** User initializes UserAccount.
2. **Collection Init:** User calls `create_collection(id="my-series", max_videos=50)`.
   - Program mints COLLECTION_TOKEN (Token-2022).
   - Program creates CollectionState PDA.
3. **Oracle Setup:** User registers the Price Oracle feed for this new token.

### 5.2 "Buy to Access" Flow

1. **Discovery:** App queries Indexer for Collections.
2. **Acquisition:** User buys the specific COLLECTION_TOKEN.
3. **Minting:** Contract verifies USD value of holdings against `CollectionState.access_threshold_usd` using the registered Oracle.
4. **Access:** App verifies View Right PDA ownership for that Collection.

### 5.3 Fee Distribution (10% Transfer Fee)

- 50% → IPFS Pinners (Accumulated in `CollectionState.reward_pool_balance`).
- 20% → Collection Owner.
- 20% → Performer (Held in PerformerEscrow until claimed).
- 10% → CAPGM Stakers.

### 5.4 The "Pin-to-Earn" Reward Cycle

To ensure that the 50% fee share effectively incentivizes storage:

1. **Signaling:**
   - Pinner calls `register_collection_host`.
   - Creates PinnerCollectionBond linking them to the Collection.

2. **Auditing:**
   - "Fishermen" (random validators) check availability.
   - On success, `bond.last_audit_pass` is updated to `current_timestamp`.

3. **Claiming:**
   - Pinner calls `claim_rewards`.
   - Contract checks: `bond.last_audit_pass > Now - 7 Days`.
   - If valid, transfers a portion of `CollectionState.reward_pool_balance` to the Pinner.

## 6. Moderation System (Staked Moderators)

### 6.1 Roles

- **Reporter:** Flags content (ModTicket).
- **Moderator:** Staked user (min. 10k CAPGM). Resolves tickets.
- **Super Moderator:** Can suspend/slash bad moderators.

### 6.2 Ticket Types

- **ContentReport:** Illegal/TOS content. Resolution: Video Hash blacklisted by Indexer.
- **DuplicateReport:** Copy-cat content. Resolution: Flagged in UI.
- **PerformerClaim:** A performer claiming their 20% fee share. Resolution: Updates `PerformerEscrow.performer_wallet` to the claimant's address.

### 6.3 Resolution Process

1. Reporter submits ticket.
2. Any Staked Moderator reviews evidence.
3. Moderator calls `resolve_ticket(Approved/Rejected)`.
4. Action is taken immediately (Optimistic UI updates).
5. If later found incorrect, Super Mod slashes the Moderator's stake.
