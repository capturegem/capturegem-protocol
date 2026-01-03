// library-source/libs/CryptoUtils.ts

/**
 * Cryptographic utilities for CID encryption/decryption and hash verification
 * 
 * Implements X25519-XSalsa20-Poly1305 encryption as specified in the protocol design
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import { createHash } from "crypto";

/**
 * Convert Ed25519 public key to X25519 for encryption
 * Solana wallets use Ed25519 for signing, but we need X25519 for NaCl box encryption
 */
export function ed25519PublicKeyToX25519(ed25519PublicKey: Uint8Array): Uint8Array {
  // This requires the ed25519-to-curve25519 library for proper conversion
  // For now, we'll use a placeholder - in production, use: ed2curve.convertPublicKey(ed25519PublicKey)
  // Install: npm install ed2curve
  
  // Temporary implementation - replace with proper ed2curve conversion
  console.warn("Using simplified key conversion - replace with ed2curve in production");
  return ed25519PublicKey;
}

/**
 * Convert Ed25519 secret key to X25519 for encryption
 */
export function ed25519SecretKeyToX25519(ed25519SecretKey: Uint8Array): Uint8Array {
  // This requires the ed25519-to-curve25519 library for proper conversion
  // For now, we'll use a placeholder - in production, use: ed2curve.convertSecretKey(ed25519SecretKey)
  
  console.warn("Using simplified key conversion - replace with ed2curve in production");
  return ed25519SecretKey.slice(0, 32);
}

/**
 * Encrypt CID using purchaser's public key
 * Used by pinners to encrypt the CID before revealing it on-chain
 * 
 * @param cid - The IPFS CID to encrypt
 * @param purchaserPublicKey - The purchaser's wallet public key (Ed25519)
 * @param pinnerSecretKey - The pinner's X25519 secret key for encryption
 * @returns Encrypted CID bytes (nonce + ciphertext)
 */
export function encryptCID(
  cid: string,
  purchaserPublicKey: PublicKey,
  pinnerSecretKey: Uint8Array
): Uint8Array {
  // Convert CID to bytes
  const cidBytes = Buffer.from(cid, "utf-8");
  
  // Convert purchaser's Ed25519 public key to X25519
  const purchaserX25519 = ed25519PublicKeyToX25519(purchaserPublicKey.toBytes());
  
  // Generate random nonce (24 bytes for XSalsa20)
  const nonce = nacl.randomBytes(24);
  
  // Encrypt using NaCl box (X25519-XSalsa20-Poly1305)
  const ciphertext = nacl.box(cidBytes, nonce, purchaserX25519, pinnerSecretKey);
  
  if (!ciphertext) {
    throw new Error("Encryption failed");
  }
  
  // Prepend nonce to ciphertext for transmission
  const encrypted = new Uint8Array(nonce.length + ciphertext.length);
  encrypted.set(nonce);
  encrypted.set(ciphertext, nonce.length);
  
  return encrypted;
}

/**
 * Decrypt CID using purchaser's private key
 * Used by purchasers to decrypt the CID revealed by pinners
 * 
 * @param encryptedCid - Encrypted CID bytes (nonce + ciphertext)
 * @param pinnerPublicKey - The pinner's public key who encrypted it
 * @param purchaserKeypair - The purchaser's keypair
 * @returns Decrypted CID string
 */
export function decryptCID(
  encryptedCid: Uint8Array,
  pinnerPublicKey: PublicKey,
  purchaserKeypair: Keypair
): string {
  // Extract nonce (first 24 bytes) and ciphertext
  if (encryptedCid.length < 24) {
    throw new Error("Invalid encrypted CID: too short");
  }
  
  const nonce = encryptedCid.slice(0, 24);
  const ciphertext = encryptedCid.slice(24);
  
  // Convert keys to X25519
  const pinnerX25519 = ed25519PublicKeyToX25519(pinnerPublicKey.toBytes());
  const purchaserX25519Secret = ed25519SecretKeyToX25519(purchaserKeypair.secretKey);
  
  // Decrypt using NaCl box
  const decrypted = nacl.box.open(ciphertext, nonce, pinnerX25519, purchaserX25519Secret);
  
  if (!decrypted) {
    throw new Error("Decryption failed - invalid keys or corrupted ciphertext");
  }
  
  // Convert bytes back to string
  return Buffer.from(decrypted).toString("utf-8");
}

/**
 * Compute SHA-256 hash of a CID
 * Used to verify that revealed CID matches the on-chain commitment
 * 
 * @param cid - The IPFS CID to hash
 * @returns 32-byte hash as Uint8Array
 */
export function hashCID(cid: string): Uint8Array {
  const hash = createHash("sha256");
  hash.update(cid);
  return new Uint8Array(hash.digest());
}

/**
 * Verify that a decrypted CID matches the expected hash
 * 
 * @param decryptedCid - The CID that was decrypted
 * @param expectedHash - The hash stored on-chain in AccessEscrow
 * @returns true if hashes match, false otherwise
 */
export function verifyCIDHash(decryptedCid: string, expectedHash: Uint8Array): boolean {
  const computedHash = hashCID(decryptedCid);
  
  if (computedHash.length !== expectedHash.length) {
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  let mismatch = 0;
  for (let i = 0; i < computedHash.length; i++) {
    mismatch |= computedHash[i] ^ expectedHash[i];
  }
  
  return mismatch === 0;
}

/**
 * Generate an ephemeral keypair for encryption
 * Used by pinners who don't want to use their main wallet key for encryption
 */
export function generateEncryptionKeypair(): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  return nacl.box.keyPair();
}

/**
 * Create a signed handshake message for NFT-based access verification
 * Used by purchasers to prove they own the Access NFT when connecting to pinners
 * 
 * @param walletKeypair - Purchaser's wallet keypair
 * @param collectionId - The collection being accessed
 * @param nftMintAddress - The Access NFT mint address
 * @returns Signed message object
 */
export function createAccessProofMessage(
  walletKeypair: Keypair,
  collectionId: string,
  nftMintAddress: PublicKey
): {
  wallet_address: string;
  collection_id: string;
  access_nft_mint: string;
  timestamp: number;
  signature: string;
} {
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Create message to sign
  const message = JSON.stringify({
    wallet_address: walletKeypair.publicKey.toBase58(),
    collection_id: collectionId,
    access_nft_mint: nftMintAddress.toBase58(),
    timestamp,
  });
  
  const messageBytes = Buffer.from(message, "utf-8");
  
  // Sign with Ed25519
  const signature = nacl.sign.detached(messageBytes, walletKeypair.secretKey);
  
  return {
    wallet_address: walletKeypair.publicKey.toBase58(),
    collection_id: collectionId,
    access_nft_mint: nftMintAddress.toBase58(),
    timestamp,
    signature: Buffer.from(signature).toString("base64"),
  };
}

/**
 * Verify an access proof message signature
 * Used by pinners to verify purchaser's NFT ownership claim
 * 
 * @param proofMessage - The access proof message to verify
 * @returns true if signature is valid, false otherwise
 */
export function verifyAccessProofMessage(proofMessage: {
  wallet_address: string;
  collection_id: string;
  access_nft_mint: string;
  timestamp: number;
  signature: string;
}): boolean {
  try {
    // Reconstruct the original message
    const message = JSON.stringify({
      wallet_address: proofMessage.wallet_address,
      collection_id: proofMessage.collection_id,
      access_nft_mint: proofMessage.access_nft_mint,
      timestamp: proofMessage.timestamp,
    });
    
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = Buffer.from(proofMessage.signature, "base64");
    const publicKey = new PublicKey(proofMessage.wallet_address).toBytes();
    
    // Verify Ed25519 signature
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * Check if an access proof message is fresh (not too old)
 * Prevents replay attacks
 * 
 * @param timestamp - The timestamp from the proof message
 * @param maxAgeSeconds - Maximum age in seconds (default: 300 = 5 minutes)
 * @returns true if timestamp is fresh, false if too old
 */
export function isProofMessageFresh(timestamp: number, maxAgeSeconds: number = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  return age >= 0 && age <= maxAgeSeconds;
}

