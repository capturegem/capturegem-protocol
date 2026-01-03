# CaptureGem Protocol - Client Library

TypeScript client library for interacting with the CaptureGem Protocol on Solana, with full Orca Whirlpools integration.

## Features

- ✅ **Complete Orca Integration**: Initialize pools, create positions, deposit liquidity
- ✅ **Protocol-Controlled Liquidity**: Flash Deposit pattern ensures protocol owns all positions
- ✅ **Client-Side Calculations**: All price/tick/liquidity math performed off-chain
- ✅ **Token Sorting**: Automatic handling of Orca's token ordering requirements
- ✅ **Compute Budget Management**: Automatic CU limit adjustments for expensive operations
- ✅ **Type-Safe**: Full TypeScript support with Anchor integration
- ✅ **CID Revelation**: Encrypted CID exchange between pinners and purchasers
- ✅ **NFT Access Control**: Non-transferable Token-2022 NFTs for content access
- ✅ **Cryptographic Verification**: SHA-256 hash commitments and X25519 encryption
- ✅ **Real-Time Monitoring**: WebSocket subscriptions for purchase events

## Installation

```bash
npm install
```

## Required Dependencies

```json
{
  "@coral-xyz/anchor": "^0.30.0",
  "@solana/web3.js": "^1.91.0",
  "@solana/spl-token": "^0.4.0",
  "@orca-so/whirlpools-sdk": "^0.13.0",
  "@orca-so/common-sdk": "^0.6.0",
  "tweetnacl": "^1.0.3",
  "ed2curve": "^0.3.0"
}
```

## Quick Start

### 1. Initialize the Client

```typescript
import * as anchor from "@coral-xyz/anchor";
import { OrcaClient } from "./libs/OrcaClient";
import { WalletManager } from "./libs/WalletManager";

// Setup Anchor provider
const provider = anchor.AnchorProvider.env();
const program = new anchor.Program(idl, programId, provider);

// Initialize clients
const walletManager = new WalletManager(provider.wallet);
const orcaClient = new OrcaClient(
  program,
  walletManager,
  provider.connection
);
```

### 2. Initialize Orca Pool

```typescript
const signature = await orcaClient.initializePool({
  collectionId: "my-collection",
  collectionOwner: owner.publicKey,
  collectionMint: collectionMint,
  capgmMint: capgmMint,
  whirlpoolsConfigKey: ORCA_CONFIG,
  feeTierKey: FEE_TIER,
  tickSpacing: 64, // Standard fee tier
  initialPrice: 0.01, // 1 COL = 0.01 CAPGM
  decimalsA: 6,
  decimalsB: 6,
});
```

### 3. Open Position (Protocol-Controlled)

```typescript
const { signature, positionMint } = await orcaClient.openPosition({
  collectionId: "my-collection",
  collectionOwner: owner.publicKey,
  whirlpoolPda: whirlpoolPda,
  lowerPrice: 0.005,  // Lower bound
  upperPrice: 0.02,   // Upper bound
  decimalsA: 6,
  decimalsB: 6,
  tickSpacing: 64,
  metadataUpdateAuth: ORCA_METADATA_AUTH,
});

// ✅ Position NFT is owned by Collection PDA!
```

### 4. Deposit Liquidity (Flash Deposit)

⚠️ **IMPORTANT: Creator Must Provide CAPGM Liquidity**

When depositing the 80% of collection tokens to Orca, the creator **must provide CAPGM tokens** to pair with them. This is not optional and serves as a "Cost of Business" to:
- Prevent spam collections
- Ensure creator commitment ("skin in the game")
- Enable healthy price discovery
- Demonstrate confidence in the collection

**Minimum Required**: ~50-100 CAPGM tokens (~$50-100 USD equivalent)

```typescript
// ✅ Creator must have CAPGM in their wallet BEFORE calling this
const signature = await orcaClient.depositLiquidity({
  collectionId: "my-collection",
  collectionOwner: owner.publicKey,
  whirlpoolPda: whirlpoolPda,
  positionPda: positionPda,
  positionMint: positionMint,
  collectionMint: collectionMint,
  capgmMint: capgmMint,
  inputTokenAmount: new anchor.BN(800_000_000), // 800 collection tokens
  slippageTolerancePercent: 1, // 1%
  tickSpacing: 64,
  tickLowerIndex: tickLowerIndex,
  tickUpperIndex: tickUpperIndex,
});

// ✅ Liquidity deposited with protocol control!
// The creator's CAPGM is transferred and paired with collection tokens
```

**Economic Rationale**:
- The creator can recover this investment through:
  - Appreciation of their 10% collection token allocation
  - Staking rewards from their holdings
  - Price appreciation supported by the initial liquidity

**Validation**: The program validates that `token_max_b` (CAPGM amount) meets `MIN_INITIAL_CAPGM_LIQUIDITY` constant.

## Key Features

### Token Sorting

Orca requires tokens to be sorted by address (`mintA < mintB`). The client handles this automatically:

```typescript
// Automatic sorting
const [mintA, mintB] = orcaClient.sortTokens(collectionMint, capgmMint);

// Check if sorted
const isSorted = orcaClient.areTokensSorted(collectionMint, capgmMint);
```

### Client-Side Calculations

All expensive calculations are performed off-chain:

```typescript
// Calculate sqrt price
const sqrtPrice = orcaClient.calculateSqrtPrice(0.01, 6, 6);

// Calculate tick index (with rounding)
const tickIndex = orcaClient.calculateTickIndex(0.01, 6, 6, 64);

// Calculate liquidity amounts
const quote = await orcaClient.calculateLiquidityAmounts({
  whirlpoolPda,
  positionPda,
  inputTokenMint: collectionMint,
  inputTokenAmount: new anchor.BN(800_000_000),
  collectionMint,
  capgmMint,
  slippageTolerancePercent: 1,
});
```

### Compute Budget Management

The client automatically sets appropriate compute unit limits:

| Operation | CU Limit | Reason |
|-----------|----------|--------|
| Initialize Pool | 300,000 | Pool creation + vault creation |
| Open Position | 250,000 | Position NFT + metadata creation |
| Deposit Liquidity | 400,000 | **Flash Deposit**: Transfer + CPI |

### Flash Deposit Pattern

The `depositLiquidity` method implements the Flash Deposit pattern with creator-provided CAPGM:

1. **Validation**: Ensures CAPGM amount meets `MIN_INITIAL_CAPGM_LIQUIDITY` threshold
2. **Pull**: Transfers CAPGM from creator's wallet → Collection Reserve B  
3. **Deposit**: Collection PDA signs Orca CPI with both reserves (Collection Tokens + CAPGM)

This happens atomically in one transaction, ensuring:
- Protocol control over liquidity positions
- Creator provides necessary paired liquidity
- Proper validation of minimum requirements

## PDA Derivations

The client provides helpers for all PDA derivations:

```typescript
// Collection PDA
const collectionPda = orcaClient.getCollectionPda(owner, "collection-id");

// Mint PDA
const mintPda = orcaClient.getMintPda(collectionPda);

// Liquidity Reserves
const reserveA = orcaClient.getLiquidityReserveA(collectionPda, mintPda);
const reserveB = orcaClient.getLiquidityReserveB(collectionPda, capgmMint);

// Whirlpool PDA
const whirlpoolPda = orcaClient.getWhirlpoolPda(
  configKey,
  mintA,
  mintB,
  tickSpacing
);

// Position PDAs
const positionPda = orcaClient.getPositionPda(positionMint);
const positionTokenAccount = orcaClient.getPositionTokenAccount(
  positionMint,
  collectionPda
);
```

## Constants

### Tick Spacings (Fee Tiers)

```typescript
OrcaClient.TICK_SPACING.STABLE    // 1   (0.01% fee)
OrcaClient.TICK_SPACING.STANDARD  // 64  (0.05% fee)
OrcaClient.TICK_SPACING.VOLATILE  // 128 (0.3% fee)
```

### Program IDs

```typescript
OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID  // whirL...
OrcaClient.METADATA_PROGRAM_ID         // metaq...
```

## Network-Specific Addresses

### Devnet

```typescript
const ORCA_WHIRLPOOLS_CONFIG_DEVNET = new PublicKey(
  "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"
);

const ORCA_METADATA_UPDATE_AUTH = new PublicKey(
  "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"
);
```

### Mainnet

⚠️ Use production addresses from [Orca's official documentation](https://docs.orca.so/)

## Examples

See `examples/orca-workflow-example.ts` for a complete workflow example.

Run it with:

```bash
npm run example:orca
```

## Error Handling

### Common Errors

**Token Order Wrong**:
```
Error: Token A/B logic swapped
Fix: Use orcaClient.sortTokens()
```

**Position Ownership Mismatch**:
```
Error: ConstraintRaw (position_token_account.owner != collection)
Fix: Ensure position NFT is owned by Collection PDA (automatic in openPosition)
```

**Compute Budget Exceeded**:
```
Error: Exceeded compute budget
Fix: The client sets this automatically, but you can increase manually
```

**Slippage Exceeded**:
```
Error: Token amounts exceed max
Fix: Increase slippageTolerancePercent or adjust input amount
```

## Architecture

### Flash Deposit Flow

```
User calls depositLiquidity()
  ↓
[Phase 1: PULL]
  User's CAPGM → Collection Reserve B
  (signed by user)
  ↓
[Phase 2: DEPOSIT]
  Collection PDA signs Orca CPI
  Reserve A + Reserve B → Orca Pool
  (signed by Collection PDA)
  ↓
✅ Liquidity deposited, protocol-controlled
```

### Position Ownership

```
Position NFT → Collection PDA → Protocol Control
```

Users **cannot** withdraw or manage liquidity directly on Orca's frontend. All operations must go through your protocol.

## Testing

```bash
npm test
```

## Contributing

See the main project README for contribution guidelines.

## Documentation

- [Flash Deposit Pattern](../docs/FLASH-DEPOSIT-PATTERN.md)
- [Complete Workflow Guide](../docs/token-minting-and-liquidity-workflow.md)
- [Client-Side Calculations](../docs/orca-client-side-calculations.md)
- [Critical Fixes](../docs/CRITICAL-FIX-POSITION-OWNERSHIP.md)

## License

MIT

## Security

⚠️ **Production Checklist**:

- [ ] Use network-specific addresses (mainnet vs devnet)
- [ ] Validate all token sorts
- [ ] Set appropriate slippage tolerance
- [ ] Monitor position ownership
- [ ] Test with small amounts first
- [ ] Implement proper error handling
- [ ] Set up monitoring/alerts

## CID Revelation & NFT Access Control

The protocol includes a sophisticated system for securely distributing collection CIDs and controlling content access.

### Overview

1. **Purchase Flow**: Buyer creates an AccessEscrow with a hash of the collection CID
2. **CID Revelation**: A pinner encrypts the actual CID and sends it on-chain
3. **Verification**: Buyer decrypts and verifies the hash matches
4. **Access Control**: Non-transferable NFT proves access rights to pinners

### AccessClient (for Purchasers)

```typescript
import { AccessClient, hashCID } from "@capturegem/client-library";

const accessClient = new AccessClient(program, connection, provider);

// Purchase access to a collection
const collectionCID = "QmYx8VsXjVjR4NbZPrB7GyPx9qvL8TjKU2r3fNz4bHmWk9";
const cidHash = hashCID(collectionCID);

const result = await accessClient.purchaseAndRevealCID(
  "creator-collection",
  collectionPubkey,
  new BN(1_000_000), // Amount
  cidHash,
  purchaserKeypair
);

console.log("CID:", result.revealed.cid);
console.log("Verified:", result.revealed.verified);

// Create NFT proof for streaming
const nftProof = accessClient.createNFTAccessProof(
  purchaserKeypair,
  "creator-collection",
  result.purchase.accessNftMint
);

// Use proof with pinner
await fetch("https://pinner.example.com/verify", {
  method: "POST",
  body: JSON.stringify(nftProof),
});
```

### PinnerClient (for Content Providers)

```typescript
import { PinnerClient } from "@capturegem/client-library";

const pinnerClient = new PinnerClient(program, connection, provider);

// Monitor for new purchases
const subId = await pinnerClient.subscribeToNewPurchases(
  async (purchase) => {
    console.log("New purchase:", purchase.collectionId);
    
    // Reveal CID to purchaser
    await pinnerClient.revealCID(
      purchase.accessEscrow,
      "QmYx8VsXjVjR4NbZPrB7GyPx9qvL8TjKU2r3fNz4bHmWk9",
      pinnerKeypair
    );
  }
);

// Verify NFT ownership before serving content
app.post("/verify-access", async (req, res) => {
  const verification = await pinnerClient.verifyNFTOwnership(
    req.body,
    "creator-collection"
  );
  
  if (!verification.valid) {
    return res.status(403).json({ error: verification.reason });
  }
  
  res.json({ allowed: true, gateway_url: "..." });
});
```

### Key Features

- **Encryption**: X25519-XSalsa20-Poly1305 (NaCl box)
- **Hash Verification**: SHA-256 commitment before revelation
- **NFT Standard**: Token-2022 with Non-Transferable extension
- **Access Proofs**: Ed25519 signed messages with timestamp
- **Caching**: Automatic NFT verification caching for performance

### Examples

Run the complete examples:

```bash
# Purchaser flow (buy, decrypt, verify)
npm run example:purchaser

# Pinner flow (monitor, reveal, verify)
npm run example:pinner
```

### Documentation

For detailed documentation, see:
- [CID Revelation Guide](./CID-REVELATION-GUIDE.md)
- [Quick Reference](./QUICK-REFERENCE.md)

## Support

For issues or questions:
- GitHub Issues: [link]
- Discord: [link]
- Documentation: [link]

