# Technical Design Document: CaptureGem Decentralized Protocol (CDP)

**Version:** 1.1  
**Date:** January 3, 2026  
**Status:** Approved

## 1. Executive Summary

CaptureGem CDP is a decentralized application (DApp) designed to transform the adult video streaming landscape by allowing users to share, sell, and moderate video content directly on the Solana blockchain. Unlike legacy Web2 platforms that rely on centralized servers, opaque algorithms, and arbitrary de-platforming, CaptureGem utilizes a unique SocialFi model that aligns incentives between creators, consumers, and infrastructure providers.

The protocol introduces a novel "Trust-Based Delivery" mechanism that fundamentally reimagines the relationship between payment and service. In this model, Content Collections are backed by liquid tokens traded on decentralized exchanges (Orca). When users purchase access, they create a purchase account on-chain containing only the SHA-256 hash of the collection's IPFS CID—the actual content address remains private. A pinner who hosts the collection then sends an encrypted message to the purchaser's wallet on-chain, containing the real CID encrypted with the purchaser's public key. The purchaser decrypts this using their private wallet key and verifies the hash matches their commitment, ensuring authenticity. The collection CID itself is a manifest document containing the CIDs of all individual videos, unlocking the entire collection with a single purchase.

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

**Embedded Wallet:** A local Solana filesystem wallet manages signing.

- **Key Storage:** Private keys are encrypted using AES-256-GCM and stored locally on the user's disk. Keys never leave the device.
- **Risk Profiles:** To improve UX, the wallet distinguishes between low-risk actions (liking, updating bio) which can be "Autosigned" if enabled, and high-risk actions (purchasing access, releasing escrow, transferring funds) which strictly require a biometric or password confirmation.

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
                   │    Expose: Purchaser PublicKey
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
       └─────────────────────┘      │  • 24hr expiry       │
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
                                 │ 5. Fetch Manifest → Extract Video CIDs
                                 ▼
                          ┌──────────────┐
                          │ IPFS Network │
                          │  (DHT Lookup │
                          │   + Bitswap) │
                          └──────┬───────┘
                                 │ 6. Download Content (Track Peer Performance)
                                 ▼
                          ┌──────────────┐
                          │   Purchaser  │
                          │  Trust Tool: │
                          │  • Peer A: 500MB │
                          │  • Peer B: 200MB │
                          └──────┬───────┘
                                 │ 7. Verify Peers & Choose Payment
                                 │
           ┌─────────────────────┴─────────────────────┐
           │                                           │
           ▼ Within 24hrs                              ▼ After 24hrs
  ┌─────────────────────┐                   ┌──────────────────┐
  │ Trust Client Logic   │                   │ Permissionless   │
  │ (Release to Peers)   │                   │  Burn Escrow     │
  └──────┬───────────────┘                   └──────┬───────────┘
         │ 8a. Release Funds (50% Escrow)           │ 8b. Burn Tokens
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
               │ 9. Update Trust Score (On-Chain Reputation)
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

A temporary holding account created when a user purchases access but hasn't finished downloading. This is the core component of the "Trust-Based" payment model. The escrow has a 24-hour expiration window, after which unclaimed funds are burned. Critically, the escrow stores only the SHA-256 hash of the collection CID—never the CID itself—ensuring that content addresses remain private until revealed by an authorized pinner.

```rust
struct AccessEscrow {
    purchaser: Pubkey,           // The user buying content (only they can release funds)
    collection: Pubkey,          // The content being bought
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

- **Initialization:** User calls `create_collection`, providing:
  - The `collection_id` (unique slug).
  - The SHA-256 hash of the collection's IPFS CID (`cid_hash`). The actual CID is never stored on-chain.
  - The creator must have already uploaded the Collection Manifest (containing video CIDs) to IPFS and be actively pinning it.
- **CID Hash Commitment:** The `cid_hash` is stored in the `CollectionState` PDA. This hash is publicly visible and used by purchasers to verify that pinners reveal the correct CID. The actual content address remains private, known only to the creator and authorized pinners.
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
- **Content Download:** With the verified collection CID, the client fetches the manifest and then begins requesting the individual video CIDs from the IPFS swarm.

**Collection Token Staking:**

Collection token holders can stake their tokens in a collection-specific staking pool to earn passive rewards. Each time someone purchases access to that collection, the 50% allocated to the Collection Ownership Pool is distributed proportionally to all stakers based on their stake. This mechanism:
- Rewards long-term token holders and believers in the collection's success.
- Creates a sustainable revenue stream beyond the initial 10% creator allocation.
- Incentivizes community marketing and organic promotion of collections.

### 4.3 Trust-Based Fulfillment (The Download)

This workflow enforces the "Trust-Based" system where payment is conditional on service. The purchaser has complete control over which peers receive payment, creating a meritocratic system where only peers that successfully deliver content are rewarded. Note that peers receive the 50% of the purchase price that was locked in the `AccessEscrow` PDA (the other 50% was already distributed to collection token stakers).

**Pinner Incentive to Reveal CID:**

Pinners are incentivized to monitor the blockchain for new `AccessEscrow` accounts and promptly reveal the CID because:
- Only peers who are included in the purchaser's final `release_escrow` transaction receive payment.
- The pinner who reveals the CID establishes a relationship with the purchaser, increasing their chances of being selected for content delivery.
- Pinners who consistently provide fast, valid CID reveals build on-chain reputation, attracting more purchase traffic.
- If no pinner reveals the CID within 24 hours, the escrow burns and no one earns—creating urgency for pinners to act.

**The Trust-Based Payment Model:**

The buyer is the ultimate arbiter of which peers deserve payment. This creates strong incentives for peers to provide high-quality, fast, and reliable service:

- **CID Acquisition:** After a pinner reveals the encrypted CID and the purchaser verifies it (as described in 4.2), the client has the authentic collection CID and can fetch the manifest.
- **Discovery:** The Purchaser's client uses the IPFS DHT (Distributed Hash Table) to find peers hosting the individual video CIDs listed in the collection manifest.
- **Connection & Monitoring:** The Purchaser's IPFS Check Tool actively monitors the data stream via the Bitswap protocol. It logs granular accounting data:
  - Peer ID X sent 500MB (Blocks 1-5000).
  - Peer ID Y sent 200MB (Blocks 5001-7000).
  - Peer ID Z connected but sent 0MB (Timed out).
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
