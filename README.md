# CaptureGem Protocol

**Website**: [https://www.capturegem.com](https://www.capturegem.com)

CaptureGem is a decentralized application (DApp) and protocol designed to transform content streaming by allowing users to share, monetize, and moderate video content directly on the Solana blockchain. It utilizes a SocialFi model where access to specific content collections is gated by holding a dynamic USD value of a creator's unique Collection Token.

> **Note**: CaptureGem is a released product with hundreds of active members. However, the DApp and social features are currently under active development. Visit [capturegem.com](https://www.capturegem.com) to learn more.

## Project Overview

The CaptureGem ecosystem allows users to act as independent channels ("Collections"), backed by their own Token-2022 assets. The protocol aligns incentives between creators, consumers, and infrastructure providers through a circular economy.

## Key Features

- **Collection Tokens (Token-2022)**: Every content library has a unique token. The protocol enforces a 10% transfer fee on these tokens to fund the ecosystem (Pinners, Performers, Stakers).
- **Dynamic Access (View Rights)**: Access isn't bought with a fixed fee; it is earned by holding a specific USD value of the Collection Token. A "View Rights" NFT is minted/renewed to grant 90-day access.
- **Decentralized Storage (IPFS)**: The client application includes an embedded IPFS node. Users can earn rewards by "pinning" (hosting) content for others.
- **Trustless Moderation**: A decentralized workforce of staked moderators reviews reported content, ensuring the platform remains safe without centralized censorship.

## Repository Structure

The codebase is divided into two primary environments:

### 1. Solana Smart Contract (`/solana-program`)

Built with the Anchor Framework in Rust. This contains the on-chain logic for state management, token economics, and access control.

- `programs/solana-program/src/lib.rs`: Entry point for RPC instructions.
- `programs/solana-program/src/state.rs`: Definition of PDAs (CollectionState, UserAccount, etc.).
- `programs/solana-program/src/instructions/`: Modular logic for Admin, User, Access, Treasury, and Pinner workflows.

### 2. Client Libraries (`/src/libs`)

TypeScript libraries designed to run within an Electron environment (the "Client"). These bridge the user interface with the blockchain and the IPFS network.

- `WalletManager.ts`: Handles local keystore management and "Autosigning" for low-risk transactions.
- `ProtocolClient.ts`: A wrapper around the Anchor client for interacting with the CaptureGem smart contract.
- `IpfsManager.ts`: Manages the lifecycle of the bundled Kubo (go-ipfs) binary.
- `IndexerClient.ts`: Communicates with the off-chain Indexer API for aggregated data queries.

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

For a comprehensive breakdown of the technical design, tokenomics, and system architecture, please refer to the Protocol Design Document.
