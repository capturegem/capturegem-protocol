# Technical Design Document: CaptureGem Decentralized Protocol (CDP)

**Version:** 1.0 
**Date:** Jan 2, 2026  
**Status:** Draft

## 1. Executive Summary

CaptureGem CDP is a decentralized application (DApp) designed to transform the adult video streaming landscape by allowing users to share, sell, and moderate video content directly on the Solana blockchain. Unlike Web2 platforms that rely on centralized servers and opaque algorithm-driven monetization, CaptureGem utilizes a SocialFi model that aligns incentives between creators, consumers, and infrastructure providers.

In this ecosystem, users can create multiple distinct Content Collections, effectively acting as their own independent channels. Each Collection is backed by its own unique Collection Token, minted using the Token-2022 standard. Access to the content within a specific collection is gated by a View Rights NFT, a renewable subscription badge. Users can only mint this NFT if they hold a sufficient USD value of that specific Collection's token. This mechanism creates a direct correlation between a creator's popularity and the value of their social currency, while simultaneously ensuring that the most loyal fans gain access to the content.

The protocol is built to be censorship-resistant at the storage layer while maintaining community standards through a decentralized workforce of Staked Moderators. These moderators, overseen by Super Moderators, ensure the platform remains safe and high-quality without a central authority dictating terms.

## 2. System Architecture

The system consists of three primary layers designed to abstract away the complexities of blockchain interaction while maintaining full self-sovereignty.

### 2.1 Client Technology Stack (Electron & Portable Runtime)

The client is designed as a "Zero-Configuration" application. Users should not need to understand IPFS daemons, RPC endpoints, or private key management to use the platform.

- **Framework:** Electron.js (Chromium + Node.js) serves as the GUI container. It allows for deep system integration required to manage background processes like the IPFS daemon and the local keystore, while providing a familiar web-like interface for the user.

- **Portable IPFS Integration:**
  - The application bundles a binary of Kubo (go-ipfs) directly within its resource files.
  - Upon launch, the Electron main process spawns this binary as a child process, managing its lifecycle, configuration, and networking ports.
  - This ensures that every active user is also a node in the storage network, contributing to the data availability of the ecosystem without requiring manual setup.

- **Embedded "Hot" Wallet & Security:**
  - **Keystore:** A local Solana filesystem wallet (Keypair JSON) is encrypted using AES-256 and stored within the app's user data directory.
  - **Autosigning Behavior:** To bridge the gap between "Web2 ease of use" and "Web3 security," the wallet manager implements distinct risk profiles.
    - **Low Risk (Autosign):** Actions like "Liking" a video, updating a profile bio, or voting in a moderation queue can be signed automatically in the background, keeping the UX fluid.
    - **High Risk (Confirmation Required):** Actions involving the movement of assets (Transfers, Swaps) or irrevocable changes (Slashing stake) trigger a mandatory UI prompt requiring explicit user approval.

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

The core logic resides in a custom Solana Program (Rust/Anchor), leveraging the high throughput and low latency of the network to handle complex state transitions and fee distributions in real-time.

### 3.1 Tokenomics & Assets

The economic model is circular, designed to reward value creation and infrastructure provision.

#### A. CAPGM (Ecosystem Token)

- **Role:** The foundational utility token of the protocol.
- **Liquidity:** Used as the primary "Quote Currency" in Orca liquidity pools against Collection Tokens, facilitating easy swapping.
- **Staking Utility:** It serves as the bond for network participants. Both Pinners (storage providers) and Moderators (content reviewers) must stake CAPGM to participate. This stake is subject to slashing, ensuring honest behavior through economic disincentives.

#### B. Collection Tokens (Social Tokens)

- **Scope:** Per-Collection. A single Creator Identity can launch multiple Collections (e.g., one for "Travel Vlogs" and another for "Cooking Tutorials"), each with its own token economy.
- **Standard:** Token-2022 (SPL Token Extensions). This modern standard allows for the enforcement of the 10% Transfer Fee at the protocol level.
- **Mechanism:** Every time a user buys, sells, or transfers this token, 10% of the transaction value is withheld by the mint. The protocol then harvests these withheld tokens to fund the ecosystem (Pinners, Creators, Platform).

#### C. View Rights NFT (Access Badge)

- **Concept:** A renewable "Subscription Pass" represented as a PDA-based NFT.
- **Validity Period:** Strictly enforced at 3 Months (90 Days).
- **Dynamic Pricing:** The condition to mint is not a fixed token amount, but a fixed USD value (e.g., $10.00).
- **Logic:** The contract queries an on-chain Oracle to determine the current exchange rate of the Collection Token. If the token price rises, fewer tokens are needed to mint access. If the price falls, more tokens are required. This stabilizes the "cost of entry" for fans while allowing the token value to fluctuate.

### 3.2 Program Derived Addresses (PDAs)

The state of the application is sharded across several Program Derived Addresses to ensure scalability and prevent rent bloat.

#### A. Global Protocol State

Stores network-wide configuration URLs and economic parameters.

```rust
struct GlobalState {
    admin: Pubkey,
    indexer_api_url: String,   
    node_registry_url: String,
    moderator_stake_minimum: u64,
}
```

#### B. User Account & IPNS Identity

Represents the global identity of a wallet owner.

```rust
struct UserAccount {
    authority: Pubkey,
    ipns_key: String,   // Points to off-chain metadata (Avatar, Bio)
    is_online: bool,
}
```

**IPNS Strategy:** Storing mutable strings (like Bios or Avatar URLs) on Solana is expensive. Instead, users publish an IPNS (InterPlanetary Name System) record. The blockchain only stores the fixed IPNS Key. The client resolves this key off-chain to find the latest profile metadata. This allows users to update their profiles for free (no gas) after the initial setup.

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
    max_video_limit: u32,        // e.g., 100 videos max to prevent spam
    video_count: u32,
    reward_pool_balance: u64,    // Accumulated 50% fees waiting for Pinners
}
```

#### D. Pinner Bonding (Signaling)

Links a Pinner to a specific collection they host, creating a verifiable on-chain relationship.

**Seeds:** `['host_bond', pinner_pubkey, collection_state_key]`

```rust
struct PinnerCollectionBond {
    pinner: Pubkey,
    collection: Pubkey,
    last_audit_pass: i64, // Timestamp of last successful availability check
}
```

## 4. Off-Chain Indexer API Specification

The "Indexer" functions as the high-performance query layer for the CaptureGem ecosystem. While the Solana blockchain is the immutable source of truth for ownership and permissions, it is ill-suited for complex queries like "Show me all video collections about Cooking sorted by popularity." The Indexer bridges this gap.

### 4.1 Architecture & Synchronization

The Indexer is composed of three microservices working in tandem:

1. **Chain Listener:** Connects to a Solana RPC node via WebSocket. It listens for specific program events (e.g., CollectionCreated, ModTicketResolved, PinnerBonded). Upon detecting an event, it updates a relational database (PostgreSQL) to reflect the new on-chain state.

2. **IPFS Crawler:** When a new Collection or Video is indexed, this service actively resolves the associated IPNS/IPFS CIDs. It fetches the off-chain JSON metadata (titles, descriptions, thumbnails) and validates that the content is actually retrievable from the IPFS network, flagging dead content.

3. **API Gateway:** A RESTful API layer (Node.js/FastAPI) backed by Redis caching. It serves read-heavy requests to the Electron Client, ensuring instant load times.

### 4.2 Enhanced Data Models

The schema aggregates highly consistent on-chain data with rich off-chain metadata.

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

All list endpoints support cursor-based pagination and standard sorting parameters to handle large datasets.

| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| GET | `/collections` | `page`, `limit`, `sort` (newest, popular), `category` | List collections with metadata. |
| GET | `/collections/search` | `q` (text query), `tags` | Full-text search on titles and descriptions using flexible matching. |
| GET | `/collections/:id` | - | Detailed view including aggregated stats and current token price. |
| GET | `/collections/:id/videos` | `page`, `limit` | List videos within a collection. |
| GET | `/collections/:id/nodes` | `min_reputation` | List active IPFS peers pinning this collection (used for "swarm connect"). |
| GET | `/nodes/active` | `region` (e.g., "NA", "EU") | List verified high-uptime nodes for bootstrapping DHT connections. |
| GET | `/user/:pubkey/profile` | - | Resolve UserAccount IPNS key to JSON profile (Bio, Avatar). |

### 4.4 Consistency & Moderation Enforcement

The Indexer acts as the "legal filter" and UX guardian for the protocol.

- **Blacklist Sync:** The Chain Listener monitors ModTicket events. If a ticket is resolved with the status Approved (meaning the content was found to be illegal or violating TOS), the Indexer immediately marks the associated Video or Collection as `is_blacklisted = true` in the database.

- **API Filtering:** The API Gateway automatically filters out any blacklisted content from all GET responses. This ensures that while the data might technically still exist on the immutable IPFS network, it is rendered undiscoverable via the official client interface, protecting the platform from liability.

- **Hash Registry:** A global "Bad Hash" registry is maintained to prevent the re-uploading of known infringing content. If the IPFS Crawler detects a new video with a hash matching a previously blacklisted entry, it is preemptively hidden before it can be served to users.

## 5. Workflows

### 5.1 Collection Creation

1. **User Init:** User initializes their UserAccount, establishing their IPNS identity.

2. **Collection Init:** User calls `create_collection(id="my-series", max_videos=50)`.
   - The Program uses CPI to mint the COLLECTION_TOKEN (Token-2022) with the transfer fee extension enabled.
   - The Program initializes the CollectionState PDA to track limits and rewards.

3. **Oracle Setup:** User registers the Price Oracle feed (e.g., Pyth or Switchboard) that will be used to price their token in USD.

### 5.2 "Buy to Access" Flow

1. **Discovery:** The App queries the Indexer to display available Collections.

2. **Acquisition:** The User swaps CAPGM for the specific COLLECTION_TOKEN on a DEX.

3. **Minting:** The User attempts to mint a View Right. The Contract queries the Oracle for the current price, multiplies it by the user's balance, and checks if `Value >= CollectionState.access_threshold_usd`.

4. **Access:** If the check passes, the View Right PDA is created/renewed. The App recognizes this PDA and unlocks the encrypted content keys for that Collection.

### 5.3 Fee Distribution (10% Transfer Fee)

Every transfer of a Collection Token triggers a 10% fee. This is harvested and split to sustain the ecosystem:

- **50% → IPFS Pinners:** This portion is accumulated in `CollectionState.reward_pool_balance`, creating a "bounty" for nodes that store this specific collection.

- **20% → Collection Owner:** Direct revenue for the creator, incentivizing them to increase the value of their token.

- **20% → Performer:** Held in PerformerEscrow. This protects talent who may not be the uploader. They can claim this by proving ownership of their wallet address.

- **10% → CAPGM Stakers:** Rewards the governance participants who secure the protocol.

### 5.4 The "Pin-to-Earn" Reward Cycle

To ensure that the 50% fee share effectively incentivizes storage of the specific content being purchased, the system uses a Claim-based Reward Pool tied to Proof of Availability.

1. **Signaling:**
   - A Pinner calls `register_collection_host`.
   - This creates a PinnerCollectionBond on-chain, linking their Node ID to the Collection ID.

2. **Auditing:**
   - "Fishermen" (randomly selected validators) periodically challenge the Pinner to provide a specific block of data from the collection.
   - On a successful response, the contract updates `bond.last_audit_pass` to the `current_timestamp`.

3. **Claiming:**
   - The Pinner calls `claim_rewards`.
   - The Contract enforces: `bond.last_audit_pass > Now - 7 Days`.
   - If valid, the contract transfers a proportional share of the `CollectionState.reward_pool_balance` to the Pinner's wallet.

## 6. Moderation System (Staked Moderators)

### 6.1 Roles

- **Reporter (Fisherman):** Any user who flags content (illegal, TOS violation) or submits a claim. They create a ModTicket.

- **Moderator:** A user who has staked the required `moderator_stake_minimum` (e.g., 10k CAPGM). They have the power to instantly resolve tickets.

- **Super Moderator:** Trusted entities (initially DAO appointed) who oversee the Moderators and have the power to slash stakes.

### 6.2 Ticket Types

- **ContentReport:** Flagging content as Illegal or TOS violating. Resolution: The Video Hash is added to the Indexer's blacklist, hiding it from the UI.

- **DuplicateReport:** Flagging re-uploaded or copy-cat content. Resolution: The content is flagged as "Duplicate" in the UI, potentially lowering its visibility.

- **PerformerClaim:** A performer claiming their 20% fee share from a Creator's escrow. Resolution: The `PerformerEscrow.performer_wallet` is updated to the claimant's address, allowing them to withdraw funds.

### 6.3 Resolution Process

1. **Submission:** A Reporter submits a ticket with evidence.

2. **Review:** Any active Staked Moderator can pick up the ticket and review the evidence.

3. **Decision:** The Moderator calls `resolve_ticket(Approved/Rejected)`.

4. **Optimistic Execution:** The action is taken immediately (e.g., content hidden). This ensures rapid response times for harmful content.

5. **Oversight:** Super Moderators review logs of resolved tickets. If a Moderator is found to have acted maliciously (e.g., banning valid content or approving illegal content), the Super Mod calls `slash_moderator`, burning the Moderator's stake and suspending their privileges.
