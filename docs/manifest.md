# CaptureGem Protocol: Project File Manifest

**Version:** 1.1 (Aligned with TDD v1.0)  
**Date:** January 3, 2026

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
| `lib.rs` | Entry Point. Registers the Program ID and routes instruction calls. Exposes public RPC functions: `initialize`, `create_collection`, `buy_access`, `release_escrow`, `claim_vault`, `burn_vault`, and moderation instructions. |
| `state.rs` | Data Structures. Defines PDAs mandated by TDD 3.2: `CollectionState`, `AccessEscrow`, `PeerTrustState`, `UserAccount`, `ModTicket`, and `GlobalState`. |
| `errors.rs` | Error Definitions. Custom errors (e.g., `EscrowNotReady`, `ClaimWindowExpired`, `InvalidProofOfDelivery`). |
| `constants.rs` | System Constants. Hardcoded values: Claim Vault duration (6 months), 80/10/10 split percentages, and Trust Score weightings. |

### Business Logic Modules (instructions/)

| File Path | Description |
|-----------|-------------|
| `mod.rs` | Module Exports. |
| `admin.rs` | Protocol Management. `initialize_protocol` sets up global state and fee destinations. |
| `user.rs` | Identity & Minting. Handles `create_collection`. Implements the 80/10/10 split: mints Token-2022, transfers 10% to Creator, 10% to Claim Vault PDA, and prepares 80% for the Orca Pool. |
| `access.rs` | Trust-Based Access. The core engine. 1. `buy_access`: Swaps CAPGM for Collection Tokens (via Orca CPI) and locks them in `AccessEscrow`. 2. `release_escrow`: Validates signatures and splits funds to IPFS Peers based on delivery weights. |
| `pinner.rs` | Reputation System. Manages `PeerTrustState`. Updates on-chain trust scores based on successful `release_escrow` events. |
| `performer.rs` | IP Protection. 1. `claim_performer_escrow`: Transfers the 10% vault to a claimant if a `CopyrightClaim` is approved. 2. `burn_unclaimed_tokens`: Permissionless instruction to burn the vault after 6 months (deflationary event). |
| `moderation.rs` | Governance. Handles `create_ticket` (Report/Claim) and `resolve_ticket`. Enforces logic for blacklisting collections and slashing Trust Scores. |
| `staking.rs` | Economic Security. Manages `stake_moderator` and `slash_moderator`. Ensures moderators have "Skin in the Game" (CAPGM locked). |
| `treasury.rs` | Fee Engine. Harvests protocol fees from the various swap and escrow operations. |

### Utilities

| File Path | Description |
|-----------|-------------|
| `utils/orca_cpi.rs` | DEX Integration. Helper functions to construct Cross-Program Invocations (CPI) to the Orca Whirlpool program for initial liquidity provisioning and token swaps. |

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
| `ProtocolClient.ts` | Solana Interface. Wrapper for Anchor. Handles `buy_access` transaction composition and monitors `AccessEscrow` PDAs. |
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
