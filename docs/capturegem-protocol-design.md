# Technical Design Document: CaptureGem Decentralized Protocol (CDP)

**Version:** 1.0  
**Date:** January 3, 2026  
**Status:** Approved

## 1. Executive Summary

CaptureGem CDP is a decentralized application (DApp) designed to transform the adult video streaming landscape by allowing users to share, sell, and moderate video content directly on the Solana blockchain. Unlike legacy Web2 platforms that rely on centralized servers, opaque algorithms, and arbitrary de-platforming, CaptureGem utilizes a unique SocialFi model that aligns incentives between creators, consumers, and infrastructure providers.

The protocol introduces a novel "Trust-Based Delivery" mechanism that fundamentally reimagines the relationship between payment and service. In this model, Content Collections are backed by liquid tokens traded on decentralized exchanges (Orca). When users purchase access, the transaction liquidity flows through these pools, but the resulting payment is held in escrow rather than being transferred immediately. This payment is only released to storage providers (IPFS Peers) once the purchaser's client confirms the content was successfully delivered. This ensures a meritocratic network where high-performance nodes build on-chain Trust Scores, creating a feedback loop where quality service is algorithmically rewarded with higher earning potential.

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
                   │ 2. Buy Access (Tokens)
                   ▼
            ┌──────────────────┐
            │  Access Escrow   │
            │      PDA         │
            └──────┬───────────┘
                   │
                   │ 3. Download Content
                   │
                   ▼
            ┌──────────────┐
            │ IPFS Network │
            └──────┬───────┘
                   │ Data Stream
                   ▼
            ┌──────────────┐
            │   Purchaser  │
            └──────┬───────┘
                   │ 4. Verify Peers
                   ▼
            ┌─────────────────────┐
            │ Trust Client Logic   │
            └──────┬───────────────┘
                   │ 5. Release Funds
                   ▼
            ┌──────────────────┐
            │  Access Escrow   │
            │      PDA         │
            └───┬───────────┬──┘
                │           │
                │ Payment   │ Payment
                │           │
                ▼           ▼
            ┌──────────┐ ┌──────────┐
            │ Peer A   │ │ Peer B   │
            │ Wallet   │ │ Wallet   │
            └─────┬────┘ └─────┬────┘
                  │            │
                  └──────┬─────┘
                         │ Update Score
                         ▼
            ┌──────────────────┐
            │ On-Chain Trust   │
            │      Score       │
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

Stores the immutable metadata, pool references, and claim timers required for protocol operation.

```rust
struct CollectionState {
    owner: Pubkey,               // The original creator
    collection_id: String,       // Unique slug (e.g., "cooking-101")
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

A temporary holding account created when a user purchases access but hasn't finished downloading. This is the core component of the "Trust-Based" payment model.

```rust
struct AccessEscrow {
    purchaser: Pubkey,           // The user buying content
    collection: Pubkey,          // The content being bought
    amount_locked: u64,          // Tokens bought from the pool, waiting for release
    created_at: i64,             // Timestamp for timeout logic
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

## 4. Workflows

### 4.1 Collection Creation & Minting

- **Initialization:** User calls `create_collection`. The program initializes the `CollectionState` PDA and validates that the `collection_id` is unique.
- **Mint & Distribute:**
  - The Program mints the total supply (e.g., 1,000,000 tokens) of the Collection Token.
  - 10% is transferred to the Creator's wallet.
  - 10% is transferred to the Claim Vault PDA.
  - 80% is transferred via CPI (Cross-Program Invocation) to the Orca program. The protocol atomically initializes a liquidity position. Note: The Creator must approve the transfer of the initial pairing asset (CAPGM) to fund the other side of the pool.

### 4.2 Purchasing Access (The Escrow Flow)

Unlike traditional models where payment goes directly to a creator, CaptureGem directs payment liquidity to the market (supporting the token price) and then to the infrastructure providers (Peers).

- **Initiate Purchase:** The user clicks "Watch" or "Buy Access" in the client.
- **DEX Swap:** The client executes a transaction that swaps the user's CAPGM for Collection Tokens via the Orca Pool. This buy pressure increases the value of the creator's held tokens.
- **Lock in Escrow:** The output of this swap is not sent to the user's wallet. Instead, the instruction directs the output tokens into an `AccessEscrow` PDA owned by the program.
- **Authorization:** The existence of a funded `AccessEscrow` account acts as the decryption key. The client sees this on-chain state and begins requesting encrypted chunks from the IPFS swarm.

### 4.3 Trust-Based Fulfillment (The Download)

This workflow enforces the "Trust-Based" system where payment is conditional on service.

- **Discovery:** The Purchaser's client uses the IPFS DHT (Distributed Hash Table) to find peers hosting the collection CID.
- **Connection & Monitoring:** The Purchaser's IPFS Check Tool actively monitors the data stream via the Bitswap protocol. It logs granular accounting data:
  - Peer ID X sent 500MB (Blocks 1-5000).
  - Peer ID Y sent 200MB (Blocks 5001-7000).
  - Peer ID Z connected but sent 0MB (Timed out).
- **Client Decision:** Upon download completion (or sufficient streaming buffer), the client algorithmically determines that Peer X and Peer Y are valid earners based on "Useful Bytes Delivered."
- **Settlement:**
  - The Client constructs a `release_escrow` transaction containing the list of valid Peer Wallets [WalletX, WalletY] and their respective weights.
  - The User signs this transaction (High-Risk Action).
- **On-Chain Execution:**
  - The Solana Program validates the signature matches the `AccessEscrow` owner.
  - The tokens in escrow are split according to the provided weights and sent to Wallet X and Wallet Y.
- **Trust Score Update:** The Program increments the `PeerTrustState` for both peers. This increases their global reputation, making them preferred nodes for future users via the Indexer's trusted endpoint.

### 4.4 Copyright Claims

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
