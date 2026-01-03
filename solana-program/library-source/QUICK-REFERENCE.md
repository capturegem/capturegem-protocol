# Orca Client - Quick Reference

## Import

```typescript
import { OrcaClient } from "@capturegem/client-library";
```

## Initialize

```typescript
const orcaClient = new OrcaClient(program, walletManager, connection);
```

## Common Operations

### Get Collection PDA

```typescript
const collectionPda = orcaClient.getCollectionPda(owner, "collection-id");
```

### Sort Tokens (REQUIRED!)

```typescript
const [mintA, mintB] = orcaClient.sortTokens(collectionMint, capgmMint);
```

### Calculate Sqrt Price

```typescript
const sqrtPrice = orcaClient.calculateSqrtPrice(
  0.01,  // price
  6,     // decimals A
  6      // decimals B
);
```

### Calculate Tick Index

```typescript
const tickIndex = orcaClient.calculateTickIndex(
  0.01,  // price
  6,     // decimals A
  6,     // decimals B
  64     // tick spacing
);
```

## Full Workflow

### Step 1: Initialize Pool

```typescript
const sig = await orcaClient.initializePool({
  collectionId: "my-collection",
  collectionOwner: owner.publicKey,
  collectionMint: sortedMintA,
  capgmMint: sortedMintB,
  whirlpoolsConfigKey: ORCA_CONFIG,
  feeTierKey: FEE_TIER,
  tickSpacing: 64,
  initialPrice: 0.01,
  decimalsA: 6,
  decimalsB: 6,
});
```

### Step 2: Open Position

```typescript
const { signature, positionMint } = await orcaClient.openPosition({
  collectionId: "my-collection",
  collectionOwner: owner.publicKey,
  whirlpoolPda: whirlpoolPda,
  lowerPrice: 0.005,
  upperPrice: 0.02,
  decimalsA: 6,
  decimalsB: 6,
  tickSpacing: 64,
  metadataUpdateAuth: ORCA_METADATA_AUTH,
});
```

### Step 3: Deposit Liquidity

```typescript
const sig = await orcaClient.depositLiquidity({
  collectionId: "my-collection",
  collectionOwner: owner.publicKey,
  whirlpoolPda: whirlpoolPda,
  positionPda: positionPda,
  positionMint: positionMint,
  collectionMint: sortedMintA,
  capgmMint: sortedMintB,
  inputTokenAmount: new BN(800_000_000),
  slippageTolerancePercent: 1,
  tickSpacing: 64,
  tickLowerIndex: tickLowerIndex,
  tickUpperIndex: tickUpperIndex,
});
```

## Compute Unit Limits (Automatic)

| Operation | CU Limit |
|-----------|----------|
| `initializePool()` | 300,000 |
| `openPosition()` | 250,000 |
| `depositLiquidity()` | 400,000 |

## Constants

```typescript
// Tick spacings
OrcaClient.TICK_SPACING.STABLE    // 1
OrcaClient.TICK_SPACING.STANDARD  // 64
OrcaClient.TICK_SPACING.VOLATILE  // 128

// Program IDs
OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
OrcaClient.METADATA_PROGRAM_ID
```

## Network Addresses

### Devnet

```typescript
const ORCA_CONFIG = new PublicKey(
  "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"
);

const METADATA_AUTH = new PublicKey(
  "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"
);
```

## Error Handling

```typescript
try {
  await orcaClient.depositLiquidity({...});
} catch (error) {
  if (error.message.includes("ConstraintRaw")) {
    console.error("Position ownership mismatch");
  } else if (error.message.includes("Slippage")) {
    console.error("Increase slippage tolerance");
  }
}
```

## Verification

```typescript
// Check if tokens are sorted correctly
const isSorted = orcaClient.areTokensSorted(mintA, mintB);

// Get position token account
const positionTokenAccount = orcaClient.getPositionTokenAccount(
  positionMint,
  collectionPda
);

// Verify ownership
const accountInfo = await connection.getParsedAccountInfo(positionTokenAccount);
const owner = new PublicKey(accountInfo.value.data.parsed.info.owner);
console.log("Owned by Collection PDA?", owner.equals(collectionPda));
```

## Advanced: Build Instructions Only

If you want to build transactions manually:

```typescript
// Build instruction (no signing)
const instruction = await orcaClient.buildDepositLiquidityInstruction({...});

// Add to custom transaction
const tx = new Transaction();
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
tx.add(instruction);

// Sign and send manually
await provider.sendAndConfirm(tx, [signers]);
```

## Tips

- ✅ Always sort tokens before calling Orca methods
- ✅ Use client-side calculations (don't calculate on-chain)
- ✅ Set appropriate slippage tolerance (1-2% typical)
- ✅ Verify position ownership after opening
- ✅ Test with small amounts first

## See Also

- [Complete Example](./examples/orca-workflow-example.ts)
- [Full Documentation](./README.md)
- [Flash Deposit Pattern](../docs/FLASH-DEPOSIT-PATTERN.md)

