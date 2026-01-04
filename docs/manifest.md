# CaptureGem Protocol: Project File Manifest

**Version:** 1.2 (Codebase Implementation Match)  
**Date:** January 4, 2026

This document serves as the master index for the CaptureGem codebase. It lists all required files for the On-Chain Program, the Off-Chain Client Logic, the Electron Container, and the Indexer API.

## 1. Documentation

| File Path | Description |
|-----------|-------------|
| `capturegem-protocol-design.md` | Technical Design Document (v1.0). The definitive reference for architecture, tokenomics, Trust-Based Delivery mechanism, moderation workflows, and API specifications. |

## 2. Solana Smart Contract (Anchor Framework)

**Location:** `solana-program/programs/solana-program/src/`

### Core Configuration

| File Path | Description |
|-----------|-------------|
| `lib.rs` | Entry Point. Registers Program ID. Exposes RPC functions: `initialize_protocol`, `create_collection`, `mint_collection_tokens`, `purchase_access`, `reveal_cid`, `release_escrow`, `stake_moderator`, `slash_moderator`, and `deposit_liquidity_to_orca`. |
| `state.rs` | Data Structures. Defines PDAs: `CollectionState`, `AccessEscrow`, `CidReveal`, `PeerTrustState`, `PinnerState`, `UserAccount`, `ModTicket`, `ModeratorStake`, `CollectionStakingPool`, `StakerPosition`, and `GlobalState`. |
| `errors.rs` | Error Definitions. Custom errors (e.g., `EscrowExpired`, `TicketAlreadyResolved`, `InsufficientInitialLiquidity`, `PeerListTooLong`). |
| `constants.rs` | System Constants. Includes `CLAIM_VAULT_VESTING_SECONDS` (6 months), `SPLIT_TO_STAKERS` (50%), `SPLIT_TO_PEERS_ESCROW` (50%), and `MIN_INITIAL_CAPGM_LIQUIDITY`. |

### Business Logic Modules (instructions/)

| File Path | Description |
|-----------|-------------|
| `admin.rs` | Protocol Management. `initialize_protocol` sets config. `update_global_state` allows admin to change fees/URLs. `disable_global_state_updates` locks config permanently. |
| `user.rs` | Identity & Minting. 1. `initialize_user_account`: Sets up user profile. 2. `create_collection`: Initializes collection PDA. 3. `mint_collection_tokens`: Implements the 80/10/10 split (Creator/Vault/Liquidity). 4. `burn_unclaimed_tokens`: Burns expired vault tokens. |
| `access.rs` | Trust-Based Access. 1. `purchase_access`: Splits payment 50/50, mints Access NFT, creates Escrow. 2. `reveal_cid`: Pinner submits encrypted CID. 3. `release_escrow`: Buyer distributes funds to peers. 4. `burn_expired_escrow`: Permissionless cleanup. |
| `orca.rs` | DEX Integration. Core liquidity logic. `initialize_orca_pool` creates the Whirlpool. `deposit_liquidity_to_orca` transfers tokens from the reserve to the pool and refunds unused amounts. |
| `pinner.rs` | Host Management. `register_collection_host` creates the `PinnerState` bond required to act as a pinner and reveal CIDs. |
| `moderation.rs` | Governance & Claims. `create_ticket` opens reports. `resolve_ticket` handles content bans. `resolve_copyright_claim` transfers Claim Vault tokens to claimants. `resolve_cid_censorship` toggles the on-chain censorship bitmap. |
| `staking.rs` | Staking & Security. 1. Moderator Staking: `stake_moderator` / `slash_moderator`. 2. Collection Staking: `stake_collection_tokens`, `claim_staking_rewards`, and `unstake_collection_tokens` for the 50% revenue share. |

## 3. Client Application (Electron & Node.js)

**Location:** `client-app/`

### Electron Process Architecture (TDD 2.1)

| File Path | Description |
|-----------|-------------|
| `src/main/main.ts` | Main Process. Entry point. Spawns the go-ipfs child process, manages the app lifecycle, and handles secure keystore access. |
| `src/main/preload.ts` | Security Bridge. The "Secure Preload Script" mentioned in TDD 2.1. Exposes specific, limited APIs to the renderer via `contextBridge` to prevent XSS escalation. |
| `src/renderer/App.tsx` | GUI Root. The visual interface for the video player and wallet management. |
| `resources/bin/kubo` | Bundled Binary. The compiled go-ipfs executable that ships with the app for "Portable IPFS Integration." |

### Core Logic Libraries (src/main/libs/)

| File Path | Description |
|-----------|-------------|
| `WalletManager.ts` | Key Management. Handles local AES-256-GCM encryption of private keys. Implements the "Risk Profile" logic (Autosigning vs. Biometric/Password prompts). |
| `ProtocolClient.ts` | Solana Interface. Wrapper for Anchor. Handles `purchase_access` transaction composition and monitors `AccessEscrow` PDAs. |
| `IpfsManager.ts` | Trust Tool. 1. Manages the IPFS daemon lifecycle. 2. Bitswap Monitor: Tracks incoming blocks to calculate latency and throughput per peer. 3. Generates the "Proof of Delivery" payload for the escrow release. |
| `IndexerClient.ts` | Discovery. Connects to the Off-Chain Indexer. Fetches `GET /nodes/trusted` for swarm prioritization and `GET /pool` for pricing. |

## 4. Off-Chain Indexer API

**Location:** `indexer-service/`

**Context:** Defined in TDD Section 5. Required to bridge the gap between blockchain state and UI responsiveness.

| File Path | Description |
|-----------|-------------|
| `src/server.ts` | API Entry Point. Express/Fastify server hosting the discovery endpoints. |
| `src/listeners/blockchain.ts` | Event Indexer. Listens for Solana logs: `CollectionCreated`, `TicketResolved`, `EscrowReleased`. Updates the SQL database. |
| `src/routes/discovery.ts` | Trust Endpoints. Implements `GET /nodes/trusted` (returns high-score peers) and `GET /collections` (filtered by blacklist status). |
| `src/services/moderation.ts` | Content Flagging. Syncs with Moderation program state. Maintains the local "Blacklist" of CIDs that the client should refuse to load. |
