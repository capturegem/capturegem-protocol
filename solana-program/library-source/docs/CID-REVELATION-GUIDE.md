# CID Revelation & NFT Access Control - Client Library Guide

## Overview

This guide covers the TypeScript client libraries for implementing CID revelation and NFT-based access control in the CaptureGem Protocol.

## Architecture

```
┌─────────────┐                          ┌─────────────┐
│  Purchaser  │                          │   Pinner    │
│   Client    │                          │   Client    │
└──────┬──────┘                          └──────┬──────┘
       │                                        │
       │ 1. purchase_access()                   │
       │    (with CID hash)                     │
       ├────────────────────────────────────────┤
       │                                        │
       │ 2. Creates AccessEscrow + NFT          │
       │    ✓ Non-transferable Token-2022       │
       │    ✓ SHA-256(CID) stored on-chain      │
       │                                        │
       │                                        │ 3. Monitors blockchain
       │                                        │    (via indexer/websocket)
       │                                        │
       │                                        │ 4. reveal_cid()
       │                                        │    Encrypts CID with
       │                                        │    purchaser's pubkey
       │                                        ├────┐
       │                                        │    │
       │ 5. Decrypts CID                        │    │
       │    ✓ Verifies hash matches             │◄───┘
       │    ✓ Fetches manifest from IPFS        │
       │                                        │
       │ 6. Connects to pinner                  │
       │    ✓ Signs NFT proof message           │
       │    ✓ Pinner verifies NFT ownership     │
       │                                        │
       │ 7. Streams content ─────────────────►  │
       │    (IPFS gateway)                      │
       │                                        │
```

## Installation

```bash
npm install @capturegem/client-library
```

Additional dependencies:
```bash
npm install tweetnacl ed2curve @solana/web3.js @coral-xyz/anchor
```

## Core Modules

### 1. CryptoUtils

Cryptographic utilities for encryption, decryption, and verification.

```typescript
import {
  hashCID,
  encryptCID,
  decryptCID,
  verifyCIDHash,
  createAccessProofMessage,
  verifyAccessProofMessage,
} from "@capturegem/client-library";
```

#### Key Functions

**`hashCID(cid: string): Uint8Array`**
- Computes SHA-256 hash of a CID
- Used to commit CID hash on-chain without revealing the actual CID

**`encryptCID(cid: string, purchaserPublicKey: PublicKey, pinnerSecretKey: Uint8Array): Uint8Array`**
- Encrypts CID using X25519-XSalsa20-Poly1305
- Pinner encrypts CID with purchaser's public key
- Returns: nonce + ciphertext

**`decryptCID(encryptedCid: Uint8Array, pinnerPublicKey: PublicKey, purchaserKeypair: Keypair): string`**
- Decrypts CID using purchaser's private key
- Throws error if decryption fails

**`verifyCIDHash(decryptedCid: string, expectedHash: Uint8Array): boolean`**
- Verifies decrypted CID matches the on-chain hash commitment
- Uses constant-time comparison to prevent timing attacks

**`createAccessProofMessage(...): SignedMessage`**
- Creates a signed message proving NFT ownership
- Used when connecting to pinners for content access

**`verifyAccessProofMessage(...): boolean`**
- Verifies the signature and timestamp of an access proof
- Used by pinners to validate access requests

### 2. AccessClient

Client library for purchasers to buy access and decrypt CIDs.

```typescript
import { AccessClient } from "@capturegem/client-library";

const accessClient = new AccessClient(program, connection, provider);
```

#### Methods

**`purchaseAccess(collectionId, collectionPubkey, totalAmount, cidHash): Promise<PurchaseResult>`**
- Executes the purchase flow
- Mints non-transferable Access NFT (Token-2022)
- Creates AccessEscrow with CID hash
- Transfers 50% to staking pool, 50% to escrow

**`waitForCIDReveal(accessEscrowPubkey, timeoutMs?, pollIntervalMs?): Promise<CidReveal>`**
- Polls blockchain for CID revelation
- Returns when a pinner has revealed the CID
- Throws error on timeout

**`decryptAndVerifyCID(cidReveal, accessEscrow, purchaserKeypair): RevealedCID`**
- Decrypts the revealed CID
- Verifies hash matches on-chain commitment
- Returns CID with verification status

**`purchaseAndRevealCID(...): Promise<{purchase, revealed}>`**
- Complete flow: purchase → wait → decrypt
- Convenience method that combines all steps
- Throws on verification failure

**`createNFTAccessProof(purchaserKeypair, collectionId, nftMintAddress): SignedMessage`**
- Creates signed proof of NFT ownership
- Used to authenticate with pinners when streaming content

**`fetchCollectionManifest(collectionCID): Promise<CollectionManifest>`**
- Fetches collection manifest from IPFS
- Returns JSON with list of video CIDs

### 3. PinnerClient

Client library for pinners to reveal CIDs and verify access.

```typescript
import { PinnerClient } from "@capturegem/client-library";

const pinnerClient = new PinnerClient(program, connection, provider);
```

#### Methods

**`monitorNewPurchases(onNewPurchase, collectionPubkey?): Promise<void>`**
- Scans blockchain for unrevealed AccessEscrow accounts
- Calls callback for each new purchase found
- One-time scan (not real-time)

**`subscribeToNewPurchases(onNewPurchase, collectionPubkey?): Promise<number>`**
- Real-time monitoring via WebSocket
- Calls callback when AccessEscrow accounts change
- Returns subscription ID for cleanup

**`revealCID(accessEscrowPubkey, collectionCID, pinnerKeypair): Promise<string>`**
- Encrypts CID with purchaser's public key
- Creates CidReveal PDA on-chain
- Marks AccessEscrow as revealed
- Returns transaction signature

**`verifyNFTOwnership(proofMessage, collectionId): Promise<NFTVerificationResult>`**
- Verifies signature, timestamp, and on-chain NFT ownership
- Uses RPC to check Token-2022 account
- Results are cached for performance
- Returns verification status with reason on failure

**`batchVerifyNFTOwnership(proofMessages[], collectionId): Promise<NFTVerificationResult[]>`**
- Verifies multiple access proofs in parallel
- Useful for high-traffic pinners

**`clearCache(): void`**
- Clears NFT verification cache
- Call periodically to free memory

## Usage Examples

### Purchaser Flow

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { AccessClient, hashCID } from "@capturegem/client-library";

// Setup
const connection = new Connection("https://api.devnet.solana.com");
const purchaserKeypair = /* load from wallet */;
const wallet = new Wallet(purchaserKeypair);
const provider = new AnchorProvider(connection, wallet, {});
const program = /* load Anchor program */;

const accessClient = new AccessClient(program, connection, provider);

// Purchase and reveal
const collectionCID = "QmYx8VsXjVjR4NbZPrB7GyPx9qvL8TjKU2r3fNz4bHmWk9";
const cidHash = hashCID(collectionCID);

const result = await accessClient.purchaseAndRevealCID(
  "creator-collection",
  collectionPubkey,
  new BN(1_000_000),
  cidHash,
  purchaserKeypair
);

console.log("✅ Purchase complete!");
console.log("CID:", result.revealed.cid);
console.log("Verified:", result.revealed.verified);

// Create NFT proof for streaming
const nftProof = accessClient.createNFTAccessProof(
  purchaserKeypair,
  "creator-collection",
  result.purchase.accessNftMint
);

// Use proof to authenticate with pinner
const response = await fetch("https://pinner.example.com/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(nftProof),
});

if (response.ok) {
  console.log("✅ Authenticated! Can now stream content.");
}
```

### Pinner Flow

```typescript
import { PinnerClient } from "@capturegem/client-library";

const pinnerClient = new PinnerClient(program, connection, provider);

// Monitor for new purchases
const subscriptionId = await pinnerClient.subscribeToNewPurchases(
  async (purchase) => {
    console.log("New purchase:", purchase.collectionId);
    
    // Check if we're pinning this collection
    const collection = myCollections.find(
      (c) => c.pubkey.equals(purchase.collection)
    );
    
    if (collection) {
      // Reveal CID to purchaser
      await pinnerClient.revealCID(
        purchase.accessEscrow,
        collection.cid,
        pinnerKeypair
      );
      
      console.log("✅ CID revealed to", purchase.purchaser.toBase58());
    }
  }
);

// HTTP server for content access
app.post("/verify-access", async (req, res) => {
  const proofMessage = req.body;
  
  // Verify NFT ownership
  const verification = await pinnerClient.verifyNFTOwnership(
    proofMessage,
    collectionId
  );
  
  if (!verification.valid) {
    return res.status(403).json({
      error: "Access denied",
      reason: verification.reason,
    });
  }
  
  // Allow access to IPFS content
  res.json({
    allowed: true,
    gateway_url: `https://ipfs.example.com/${collectionCID}`,
  });
});

// Cleanup on shutdown
process.on("SIGINT", async () => {
  await pinnerClient.unsubscribeFromNewPurchases(subscriptionId);
  pinnerClient.clearCache();
  process.exit(0);
});
```

## Security Considerations

### Encryption

- **Algorithm**: X25519-XSalsa20-Poly1305 (NaCl box)
- **Key Conversion**: Ed25519 (Solana wallets) → X25519 (encryption)
- **Nonce**: 24 random bytes, prepended to ciphertext
- **Authentication**: Poly1305 MAC ensures integrity

### Hash Verification

- **Algorithm**: SHA-256
- **Comparison**: Constant-time to prevent timing attacks
- **Commitment**: Hash stored on-chain before CID revelation

### Access Control

- **NFT Standard**: Token-2022 with Non-Transferable extension
- **Signature**: Ed25519 signing with timestamp
- **Replay Protection**: 5-minute timestamp window
- **Caching**: 30-second cache expiry for performance

### Best Practices

1. **Key Management**
   - Never expose private keys in logs or network requests
   - Use secure key storage (hardware wallets, key management services)
   - Rotate encryption keypairs periodically

2. **Timestamp Freshness**
   - Reject proofs older than 5 minutes
   - Sync system clocks with NTP

3. **Cache Management**
   - Clear NFT verification cache periodically
   - Set appropriate expiry based on traffic

4. **Error Handling**
   - Don't reveal why verification failed (security)
   - Log failures for monitoring
   - Rate limit verification attempts

## Troubleshooting

### Common Issues

**"Decryption failed - invalid keys or corrupted ciphertext"**
- Key conversion between Ed25519 and X25519 failed
- Ensure using `ed2curve` library for proper conversion
- Verify pinner used correct purchaser public key

**"CID verification failed! Hash mismatch."**
- Pinner revealed incorrect CID
- Network corruption of encrypted data
- Report to protocol for slashing

**"Timeout waiting for CID revelation"**
- No pinners are online for this collection
- Pinner indexer not running
- Increase timeout or implement retry logic

**"Purchaser does not own the Access NFT"**
- NFT was somehow transferred (should be impossible)
- Wrong NFT mint provided in proof
- Check Token-2022 program for NFT ownership

## Testing

Run the example flows:

```bash
# Purchaser flow
npm run example:purchaser

# Pinner flow
npm run example:pinner
```

## API Reference

See inline TypeDoc comments in source files for detailed API documentation.

## Support

For issues or questions:
- GitHub: [capturegem-protocol](https://github.com/capturegem/protocol)
- Discord: [CaptureGem Community](https://discord.gg/capturegem)
- Docs: [docs.capturegem.io](https://docs.capturegem.io)

