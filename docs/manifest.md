# CaptureGem Protocol: Project File Manifest

**Version:** 1.0 (Aligned with TDD)  
**Date:** Jan 2, 2026

This document serves as the master index for the CaptureGem codebase. It lists all required files for the On-Chain Program and the Off-Chain Client Logic.

## 1. Documentation

| File Path | Description |
|-----------|-------------|
| `capturegem-protocol-design.md` | Technical Design Document (v1.0). The definitive reference for architecture, tokenomics, moderation workflows, and API specifications. |

## 2. Solana Smart Contract (Anchor Framework)

**Location:** `solana-program/programs/solana-program/src/`

### Core Configuration

| File Path | Description |
|-----------|-------------|
| `lib.rs` | Entry Point. Registers the Program ID and routes instruction calls to specific modules. Exposes public RPC functions: `initialize_user_account`, `create_collection`, `upload_video`, `buy_access_token`, `register_collection_host`, `claim_rewards`, `submit_audit_result`, `harvest_fees`, `initialize_protocol`, `stake_moderator`, `slash_moderator`, `claim_performer_escrow`, `create_ticket`, and `resolve_ticket`. |
| `state.rs` | Data Structures. Defines all PDAs including GlobalState, UserAccount, CollectionState, ViewRights, PinnerState, PerformerEscrow, ModTicket, ModeratorStake, and VideoState. |
| `errors.rs` | Error Definitions. Custom error codes (e.g., VideoLimitExceeded, InsufficientFunds, TicketAlreadyResolved, InsufficientModeratorStake) for precise failure handling. |
| `constants.rs` | System Constants. Hardcoded values for logic such as validity periods (90 days) and minimum stake requirements. |

### Business Logic Modules (instructions/)

| File Path | Description |
|-----------|-------------|
| `mod.rs` | Module Exports. Centralizes imports to keep lib.rs clean. |
| `admin.rs` | Protocol Management. Functions for initializing the protocol (`initialize_protocol`) with global Indexer/Registry URLs, CAPGM mint, and fee configuration. |
| `user.rs` | Identity & Collections. Handles `initialize_user_account` (IPNS identity setup) and `create_collection` (Minting Token-2022 with 6 decimals + CollectionState PDA). |
| `access.rs` | View Rights. The "Buy-to-Access" logic. Verifies USD value of user holdings via Oracle (Pyth/Switchboard) and mints/renews the 3-month View Right PDA. |
| `pinner.rs` | Pin-to-Earn. Handles Pinner Bonding (`register_collection_host`), Audit Submission (`submit_audit_result`), and Reward Claiming (`claim_rewards` with 7-day audit window check). |
| `treasury.rs` | Fee Engine. Harvests the 10% transfer fees from Token-2022 mints and splits them 50/20/20/10 into Pinner Reward Pool, Owner Rewards, Performer Escrow, and Staker Treasury. |
| `moderation.rs` | Governance. Handles Ticket creation (`create_ticket` with TicketType enum) and resolution (`resolve_ticket` with moderator stake verification). |
| `staking.rs` | Moderator Staking. Handles CAPGM staking for moderators (`stake_moderator`) and admin oversight (`slash_moderator`). |
| `performer.rs` | Performer Escrow. Handles claiming of performer fees (`claim_performer_escrow`) from the escrow account. |
| `video.rs` | Video Management. Handles video upload (`upload_video`) with collection limit enforcement and performer wallet linking. |

## 3. Client-Side Libraries (Electron / Node.js)

**Location:** `solana-program/library-source/libs/`

These files run within the Electron Main Process to bridge the UI with the Blockchain and IPFS.

| File Path | Description |
|-----------|-------------|
| `WalletManager.ts` | Security & Signing. Manages the local encrypted keystore. Implements "Autosigning" for low-risk actions and demands confirmation for high-risk actions. |
| `ProtocolClient.ts` | Solana Interface. The TypeScript wrapper for Anchor. Handles PDA derivation and transaction composition for Collections, View Rights, and Moderation. |
| `IpfsManager.ts` | Storage Node. Manages the bundled kubo (go-ipfs) binary lifecycle (start/stop) and implements peer-to-peer verification logic. |
| `IndexerClient.ts` | Query Layer. An Axios-based HTTP client that connects to the Off-Chain Indexer API to fetch aggregated Collection metadata, Video lists, and peer information. |
