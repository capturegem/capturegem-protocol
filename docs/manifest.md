# CaptureGem Protocol: Project File Manifest

**Version:** 1.0 (Aligned with TDD)  
**Date:** Jan 2, 2026

This document serves as the master index for the CaptureGem codebase. It lists all required files for the On-Chain Program and the Off-Chain Client Logic.

## 1. Documentation

| File Path | Description |
|-----------|-------------|
| `capturegem_tdd.md` | Technical Design Document (v3.4). The definitive reference for architecture, tokenomics, moderation workflows, and API specifications. |

## 2. Solana Smart Contract (Anchor Framework)

**Location:** `programs/capturegem/src/`

### Core Configuration

| File Path | Description |
|-----------|-------------|
| `lib.rs` | Entry Point. Registers the Program ID and routes instruction calls to specific modules. Exposes public RPC functions like `create_collection`, `mint_view_right`, and `claim_rewards`. |
| `state.rs` | Data Structures. Defines all PDAs including GlobalState, UserAccount, CollectionState, PinnerCollectionBond, and ModTicket. |
| `errors.rs` | Error Definitions. Custom error codes (e.g., MaxVideoLimitReached, NoCollectionTokens) for precise failure handling. |
| `constants.rs` | System Constants. Hardcoded values for logic such as validity periods (90 days) and minimum stake requirements. |

### Business Logic Modules (instructions/)

| File Path | Description |
|-----------|-------------|
| `mod.rs` | Module Exports. Centralizes imports to keep lib.rs clean. |
| `admin.rs` | Protocol Management. Functions for initializing the protocol and updating global Indexer/Registry URLs. |
| `user.rs` | Identity & Collections. Handles `initialize_user` (IPNS identity) and `create_collection` (Minting Token-2022 + State). |
| `access.rs` | View Rights. The "Buy-to-Access" logic. Verifies USD value of user holdings via Oracle and mints the 3-month View Right PDA. |
| `pinner.rs` | Pin-to-Earn. Handles Pinner Staking (`stake_pinner`), Bonding (`register_collection_host`), and Reward Claiming (`claim_rewards`). |
| `treasury.rs` | Fee Engine. Harvests the 10% transfer fees from Token-2022 mints and splits them into the Pinner Reward Pool and Performer Escrow. |
| `moderation.rs` | Governance. Handles Moderator registration, Ticket submission, and the Single-Mod resolution workflow (including Slashing). |

## 3. Client-Side Libraries (Electron / Node.js)

**Location:** `src/libs/`

These files run within the Electron Main Process to bridge the UI with the Blockchain and IPFS.

| File Path | Description |
|-----------|-------------|
| `WalletManager.ts` | Security & Signing. Manages the local encrypted keystore. Implements "Autosigning" for low-risk actions and demands confirmation for high-risk actions. |
| `ProtocolClient.ts` | Solana Interface. The TypeScript wrapper for Anchor. Handles PDA derivation and transaction composition for Collections, View Rights, and Moderation. |
| `IpfsManager.ts` | Storage Node. Manages the bundled kubo (go-ipfs) binary lifecycle (start/stop) and implements peer-to-peer verification logic. |
| `IndexerClient.ts` | Query Layer. An Axios-based HTTP client that connects to the Off-Chain Indexer API to fetch aggregated Collection metadata, Video lists, and peer information. |
