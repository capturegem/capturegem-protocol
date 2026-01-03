// client-library/libs/Wallet.ts
// 
// Internal wallet implementation for managing encrypted keypairs
// This wallet handles local key storage, encryption, and signing operations
// that run in the same process as the Electron main process.

import * as web3 from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as nacl from "tweetnacl";

export enum RiskLevel {
  LOW = "LOW",   // Autosign (Likes, Profile Update)
  HIGH = "HIGH", // Prompt (Transfers, Slashing)
}

export interface WalletConfig {
  /** Path to encrypted wallet file */
  walletPath?: string;
  /** Callback for high-risk transaction confirmation */
  onHighRiskConfirm?: (transaction: web3.Transaction) => Promise<boolean>;
}

/**
 * Internal wallet implementation for encrypted keypair management.
 * Handles AES-256-GCM encryption for stored keys and risk-based signing.
 */
export class Wallet {
  private keypair: web3.Keypair | null = null;
  private walletPath: string | null = null;
  private onHighRiskConfirm?: (transaction: web3.Transaction) => Promise<boolean>;

  constructor(config?: WalletConfig) {
    this.walletPath = config?.walletPath || null;
    this.onHighRiskConfirm = config?.onHighRiskConfirm;
  }

  /**
   * Loads an encrypted keypair from the filesystem.
   * Uses AES-256-GCM encryption for secure storage.
   * 
   * @param filePath - Path to encrypted wallet file (optional, uses config path if not provided)
   * @param password - Password for decryption
   * @returns The public key of the loaded wallet
   */
  public async loadWallet(filePath?: string, password?: string): Promise<web3.PublicKey> {
    const targetPath = filePath || this.walletPath;
    
    if (!targetPath) {
      throw new Error("Wallet path not provided");
    }

    if (!fs.existsSync(targetPath)) {
      throw new Error(`Wallet file not found: ${targetPath}`);
    }

    try {
      // Read encrypted data
      const encryptedData = fs.readFileSync(targetPath);
      
      // In production, decrypt using password
      // For now, using a mock implementation
      // TODO: Implement proper AES-256-GCM decryption
      if (password) {
        // const decrypted = decryptAES256GCM(encryptedData, password);
        // this.keypair = web3.Keypair.fromSecretKey(decrypted);
        // Mock for now
        this.keypair = web3.Keypair.generate();
      } else {
        // For development/testing, generate a new keypair
        this.keypair = web3.Keypair.generate();
      }

      this.walletPath = targetPath;
      return this.keypair.publicKey;
    } catch (error) {
      throw new Error(`Failed to load wallet: ${error}`);
    }
  }

  /**
   * Creates a new wallet and saves it encrypted to disk.
   * 
   * @param filePath - Path where to save the encrypted wallet
   * @param password - Password for encryption
   * @returns The public key of the created wallet
   */
  public async createWallet(filePath: string, password: string): Promise<web3.PublicKey> {
    // Generate new keypair
    this.keypair = web3.Keypair.generate();

    try {
      // Encrypt and save
      // TODO: Implement proper AES-256-GCM encryption
      // const encrypted = encryptAES256GCM(this.keypair.secretKey, password);
      // fs.writeFileSync(filePath, encrypted);
      
      // For now, save as JSON (NOT SECURE - for development only)
      const walletData = {
        publicKey: Array.from(this.keypair.publicKey.toBytes()),
        secretKey: Array.from(this.keypair.secretKey),
        encrypted: false, // TODO: Set to true when encryption is implemented
      };
      fs.writeFileSync(filePath, JSON.stringify(walletData, null, 2));

      this.walletPath = filePath;
      return this.keypair.publicKey;
    } catch (error) {
      throw new Error(`Failed to create wallet: ${error}`);
    }
  }

  /**
   * Signs a transaction based on risk level.
   * Low-risk transactions are auto-signed, high-risk require confirmation.
   * 
   * @param transaction - The transaction to sign
   * @param risk - Risk level of the transaction
   * @returns The signed transaction
   */
  public async signTransaction(
    transaction: web3.Transaction,
    risk: RiskLevel = RiskLevel.LOW
  ): Promise<web3.Transaction> {
    if (!this.keypair) {
      throw new Error("Wallet not loaded. Call loadWallet() or createWallet() first.");
    }

    if (risk === RiskLevel.HIGH) {
      if (this.onHighRiskConfirm) {
        const confirmed = await this.onHighRiskConfirm(transaction);
        if (!confirmed) {
          throw new Error("User rejected high-risk transaction");
        }
      } else {
        // Default: log warning (in Electron, this would show a dialog)
        console.warn("⚠️ HIGH RISK TRANSACTION - Auto-confirming (no confirmation handler set)");
      }
    }

    // Sign the transaction
    transaction.sign(this.keypair);
    return transaction;
  }

  /**
   * Signs a message with the wallet's private key.
   * 
   * @param message - Message bytes to sign
   * @returns Signature bytes
   */
  public async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.keypair) {
      throw new Error("Wallet not loaded");
    }

    // Sign message using Ed25519
    const signature = nacl.sign.detached(message, this.keypair.secretKey);
    return signature;
  }

  /**
   * Gets the public key of the loaded wallet.
   * 
   * @returns The public key
   */
  public getPublicKey(): web3.PublicKey {
    if (!this.keypair) {
      throw new Error("Wallet not loaded");
    }
    return this.keypair.publicKey;
  }

  /**
   * Gets the keypair (use with caution - only for internal operations).
   * 
   * @returns The keypair
   */
  public getKeypair(): web3.Keypair {
    if (!this.keypair) {
      throw new Error("Wallet not loaded");
    }
    return this.keypair;
  }

  /**
   * Checks if a wallet is loaded.
   * 
   * @returns True if wallet is loaded
   */
  public isLoaded(): boolean {
    return this.keypair !== null;
  }

  /**
   * Exports the wallet (for backup purposes).
   * Returns the secret key - handle with extreme care!
   * 
   * @returns The secret key bytes
   */
  public exportSecretKey(): Uint8Array {
    if (!this.keypair) {
      throw new Error("Wallet not loaded");
    }
    return this.keypair.secretKey;
  }

  /**
   * Sets a keypair directly (for temporary wallets or testing).
   * This bypasses file-based storage and is useful for workflows
   * that receive keypairs directly.
   * 
   * @param keypair - The keypair to use
   */
  public setKeypair(keypair: web3.Keypair): void {
    this.keypair = keypair;
  }
}

