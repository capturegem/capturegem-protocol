# CaptureGem Protocol

**Website**: [https://www.capturegem.com](https://www.capturegem.com)

CaptureGem is a decentralized application (DApp) and protocol designed to transform adult content streaming by allowing users to share, monetize, and moderate video content directly on the Solana blockchain. It utilizes a unique SocialFi model with a novel "Trust-Based Delivery" mechanism that aligns incentives between creators, consumers, and infrastructure providers.

> **Note**: CaptureGem is a released product with hundreds of active members. However, the DApp and social features are currently under active development. Visit [capturegem.com](https://www.capturegem.com) to learn more.

## Project Overview

The CaptureGem ecosystem allows users to act as independent channels ("Collections"), backed by their own Token-2022 assets traded on Orca DEX. The protocol introduces a meritocratic network where high-performance IPFS nodes build on-chain Trust Scores, creating a feedback loop where quality service is algorithmically rewarded. Additionally, the protocol embeds intellectual property protection at the tokenomic level through a "Claim Vault" system.

## Key Features

- **Trust-Based Delivery**: Payments are held in escrow and only released to IPFS storage providers (Peers) once the purchaser's client confirms successful content delivery. This ensures infrastructure providers are rewarded based on actual performance.
- **Collection Tokens (Token-2022)**: Every content library has a unique token with an 80/10/10 distribution: 80% to Orca liquidity pools, 10% to creator wallet, and 10% to a Claim Vault for IP protection.
- **CAPGM Ecosystem Token**: The foundational utility token used as the quote currency in all Orca liquidity pools and as staking bonds for Moderators.
- **Decentralized Storage (IPFS)**: The Electron client includes an embedded Kubo (go-ipfs) node. Every active user automatically contributes to the network, and high-performing peers earn payments through the trust-based escrow system.
- **On-Chain Trust Scores**: Peers build persistent reputation through successful content delivery, making them preferred nodes for future users via the Indexer's trusted endpoint.
- **IP Protection (Claim Vault)**: 10% of each collection's supply is reserved for 6 months. True rights holders can claim this reserve if content is stolen, or it burns after expiration, creating deflationary pressure.
- **Staked Moderation**: A decentralized workforce of CAPGM-staked moderators reviews reported content and IP disputes, with economic security through slashing mechanisms.

## Repository Structure

The codebase is divided into two primary environments:

### 1. Solana Smart Contract (`/solana-program`)

Built with the Anchor Framework in Rust. This contains the on-chain logic for state management, token economics, access control, and trust-based escrow settlement.

- `programs/solana-program/src/lib.rs`: Entry point for RPC instructions.
- `programs/solana-program/src/state.rs`: Definition of PDAs (`CollectionState`, `AccessEscrow`, `PeerTrustState`, etc.).
- `programs/solana-program/src/instructions/`: Modular logic for:
  - **Access**: Escrow creation and release workflows
  - **User**: Account management and profile operations
  - **Performer**: Copyright claim submissions
  - **Pinner**: IPFS peer operations and trust scoring
  - **Staking**: Moderator staking and governance
  - **Treasury**: Protocol fee management
  - **Moderation**: Content reports and dispute resolution
  - **Admin**: Protocol administration

### 2. Client Libraries (`/solana-program/src/libs`)

TypeScript libraries designed to run within an Electron environment (the "Client"). These bridge the user interface with the blockchain and the IPFS network.

- `WalletManager.ts`: Handles local keystore management with AES-256-GCM encryption. Implements risk-based signing (autosigning for low-risk actions, biometric/password confirmation for high-risk actions).
- `ProtocolClient.ts`: A wrapper around the Anchor client for interacting with the CaptureGem smart contract.
- `IpfsManager.ts`: Manages the lifecycle of the bundled Kubo (go-ipfs) binary, including configuration, garbage collection, and NAT traversal.
- `IndexerClient.ts`: Communicates with the off-chain Indexer API for aggregated data queries, trusted peer discovery, and real-time pool pricing.

## Getting Started

### Prerequisites

- Node.js (v16+)
- Rust (Latest Stable)
- Solana CLI
- Anchor Framework

### Installation

#### 1. Client Dependencies

Install the libraries required for the client-side application in the root directory.

```bash
npm install
```

#### 2. Smart Contract

Navigate to the program directory to install dependencies and build the contract.

```bash
cd solana-program
yarn install
anchor build
```

### Running Tests

To run the integration tests for the Solana program:

```bash
cd solana-program
anchor test
```

## Documentation

For a comprehensive breakdown of the technical design, tokenomics, system architecture, and workflows, please refer to the [Protocol Design Document](./docs/capturegem-protocol-design.md).

The design document covers:
- **Trust-Based Delivery Mechanism**: How escrow payments ensure quality service from IPFS peers
- **Tokenomics**: CAPGM ecosystem token, Collection Token distribution (80/10/10 split), and Claim Vault system
- **System Architecture**: Electron client with embedded IPFS, security model, and wallet management
- **Workflows**: Collection creation, access purchasing, trust-based fulfillment, and copyright claims
- **Moderation System**: Staked moderators, economic security, and dispute resolution
