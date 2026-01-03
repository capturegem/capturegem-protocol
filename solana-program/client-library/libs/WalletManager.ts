// client-library/libs/WalletManager.ts
// 
// WalletManager manages multiple wallets (internal and external) and routes
// transaction signing requests to the appropriate wallet.
// Runs in the same process as Electron main.ts.

import * as web3 from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { Wallet, RiskLevel as WalletRiskLevel } from "./Wallet";

// Re-export RiskLevel for backwards compatibility
export { WalletRiskLevel as RiskLevel };

/**
 * Interface for external wallet adapters (Phantom, etc.)
 */
export interface ExternalWallet {
  /** Unique identifier for this wallet */
  id: string;
  /** Wallet name (e.g., "Phantom", "Solflare") */
  name: string;
  /** Public key of the wallet */
  publicKey: web3.PublicKey;
  /** Sign a transaction */
  signTransaction(transaction: web3.Transaction): Promise<web3.Transaction>;
  /** Sign a message */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Check if wallet is connected */
  isConnected(): boolean;
  /** Disconnect the wallet */
  disconnect(): Promise<void>;
}

/**
 * Wallet entry in the manager's registry
 */
interface WalletEntry {
  id: string;
  name: string;
  type: "internal" | "external";
  publicKey: web3.PublicKey;
  wallet?: Wallet; // For internal wallets
  externalWallet?: ExternalWallet; // For external wallets
  isActive: boolean;
}

/**
 * WalletManager manages multiple wallets and routes signing requests.
 * 
 * Architecture:
 * - Internal wallets use the Wallet class (encrypted keypair storage)
 * - External wallets use adapters (Phantom, etc.) connected via QR code or other methods
 * - All signing operations go through WalletManager, which routes to the appropriate wallet
 */
export class WalletManager {
  private wallets: Map<string, WalletEntry> = new Map();
  private activeWalletId: string | null = null;
  private connection: Connection | null = null;

  constructor(connection?: Connection) {
    this.connection = connection || null;
  }

  /**
   * Sets the Solana connection for sending transactions.
   * 
   * @param connection - Solana RPC connection
   */
  public setConnection(connection: Connection): void {
    this.connection = connection;
  }

  /**
   * Creates and adds an internal wallet.
   * 
   * @param walletId - Unique identifier for this wallet
   * @param walletPath - Path to encrypted wallet file
   * @param password - Password for decryption (optional for development)
   * @param config - Optional wallet configuration
   * @returns The public key of the created wallet
   */
  public async createInternalWallet(
    walletId: string,
    walletPath: string,
    password?: string,
    config?: { onHighRiskConfirm?: (tx: web3.Transaction) => Promise<boolean> }
  ): Promise<web3.PublicKey> {
    const wallet = new Wallet({ walletPath, onHighRiskConfirm: config?.onHighRiskConfirm });
    const publicKey = await wallet.createWallet(walletPath, password || "");

    const entry: WalletEntry = {
      id: walletId,
      name: `Internal Wallet (${publicKey.toBase58().slice(0, 8)}...)`,
      type: "internal",
      publicKey,
      wallet,
      isActive: false,
    };

    this.wallets.set(walletId, entry);

    // Set as active if it's the first wallet
    if (this.activeWalletId === null) {
      this.setActiveWallet(walletId);
    }

    return publicKey;
  }

  /**
   * Loads an existing internal wallet.
   * 
   * @param walletId - Unique identifier for this wallet
   * @param walletPath - Path to encrypted wallet file
   * @param password - Password for decryption
   * @param config - Optional wallet configuration
   * @returns The public key of the loaded wallet
   */
  public async loadInternalWallet(
    walletId: string,
    walletPath: string,
    password?: string,
    config?: { onHighRiskConfirm?: (tx: web3.Transaction) => Promise<boolean> }
  ): Promise<web3.PublicKey> {
    const wallet = new Wallet({ walletPath, onHighRiskConfirm: config?.onHighRiskConfirm });
    const publicKey = await wallet.loadWallet(walletPath, password);

    const entry: WalletEntry = {
      id: walletId,
      name: `Internal Wallet (${publicKey.toBase58().slice(0, 8)}...)`,
      type: "internal",
      publicKey,
      wallet,
      isActive: false,
    };

    this.wallets.set(walletId, entry);

    // Set as active if it's the first wallet
    if (this.activeWalletId === null) {
      this.setActiveWallet(walletId);
    }

    return publicKey;
  }

  /**
   * Adds an external wallet (e.g., Phantom via QR code).
   * 
   * @param walletId - Unique identifier for this wallet
   * @param externalWallet - The external wallet adapter
   * @returns The public key of the added wallet
   */
  public async addExternalWallet(
    walletId: string,
    externalWallet: ExternalWallet
  ): Promise<web3.PublicKey> {
    if (!externalWallet.isConnected()) {
      throw new Error(`External wallet ${externalWallet.name} is not connected`);
    }

    const entry: WalletEntry = {
      id: walletId,
      name: externalWallet.name,
      type: "external",
      publicKey: externalWallet.publicKey,
      externalWallet,
      isActive: false,
    };

    this.wallets.set(walletId, entry);

    // Set as active if it's the first wallet
    if (this.activeWalletId === null) {
      this.setActiveWallet(walletId);
    }

    return externalWallet.publicKey;
  }

  /**
   * Removes a wallet from the manager.
   * 
   * @param walletId - ID of the wallet to remove
   */
  public async removeWallet(walletId: string): Promise<void> {
    const entry = this.wallets.get(walletId);
    if (!entry) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    // Disconnect external wallets
    if (entry.type === "external" && entry.externalWallet) {
      await entry.externalWallet.disconnect();
    }

    // If this was the active wallet, switch to another
    if (this.activeWalletId === walletId) {
      this.wallets.delete(walletId);
      const remainingWallets = Array.from(this.wallets.values());
      if (remainingWallets.length > 0) {
        this.setActiveWallet(remainingWallets[0].id);
      } else {
        this.activeWalletId = null;
      }
    } else {
      this.wallets.delete(walletId);
    }
  }

  /**
   * Sets the active wallet for signing operations.
   * 
   * @param walletId - ID of the wallet to activate
   */
  public setActiveWallet(walletId: string): void {
    const entry = this.wallets.get(walletId);
    if (!entry) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    // Deactivate current active wallet
    if (this.activeWalletId) {
      const currentEntry = this.wallets.get(this.activeWalletId);
      if (currentEntry) {
        currentEntry.isActive = false;
      }
    }

    // Activate new wallet
    entry.isActive = true;
    this.activeWalletId = walletId;
  }

  /**
   * Gets the active wallet's public key.
   * 
   * @returns The public key of the active wallet
   */
  public getActivePublicKey(): web3.PublicKey {
    if (!this.activeWalletId) {
      throw new Error("No active wallet. Create or load a wallet first.");
    }

    const entry = this.wallets.get(this.activeWalletId);
    if (!entry) {
      throw new Error("Active wallet not found");
    }

    return entry.publicKey;
  }

  /**
   * Gets the active wallet entry.
   * 
   * @returns The active wallet entry
   */
  private getActiveWallet(): WalletEntry {
    if (!this.activeWalletId) {
      throw new Error("No active wallet. Create or load a wallet first.");
    }

    const entry = this.wallets.get(this.activeWalletId);
    if (!entry) {
      throw new Error("Active wallet not found");
    }

    return entry;
  }

  /**
   * Signs a transaction using the active wallet.
   * Routes to internal Wallet or external wallet adapter as appropriate.
   * 
   * @param transaction - The transaction to sign
   * @param risk - Risk level (for internal wallets, determines auto-sign behavior)
   * @returns The signed transaction
   */
  public async signTransaction(
    transaction: web3.Transaction,
    risk: WalletRiskLevel = WalletRiskLevel.LOW
  ): Promise<web3.Transaction> {
    const entry = this.getActiveWallet();

    if (entry.type === "internal" && entry.wallet) {
      // Use internal wallet with risk-based signing
      return await entry.wallet.signTransaction(transaction, risk);
    } else if (entry.type === "external" && entry.externalWallet) {
      // Use external wallet (external wallets handle their own confirmation)
      return await entry.externalWallet.signTransaction(transaction);
    } else {
      throw new Error(`Invalid wallet entry for ${entry.id}`);
    }
  }

  /**
   * Signs a message using the active wallet.
   * 
   * @param message - Message bytes to sign
   * @returns Signature bytes
   */
  public async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const entry = this.getActiveWallet();

    if (entry.type === "internal" && entry.wallet) {
      return await entry.wallet.signMessage(message);
    } else if (entry.type === "external" && entry.externalWallet) {
      return await entry.externalWallet.signMessage(message);
    } else {
      throw new Error(`Invalid wallet entry for ${entry.id}`);
    }
  }

  /**
   * Signs and sends a transaction using the active wallet.
   * 
   * @param transaction - The transaction to sign and send
   * @param risk - Risk level
   * @returns Transaction signature
   */
  public async signAndSendTransaction(
    transaction: web3.Transaction,
    risk: WalletRiskLevel = WalletRiskLevel.LOW
  ): Promise<string> {
    if (!this.connection) {
      throw new Error("Connection not set. Call setConnection() first.");
    }

    const signedTransaction = await this.signTransaction(transaction, risk);
    const signature = await this.connection.sendRawTransaction(
      signedTransaction.serialize(),
      { skipPreflight: false }
    );

    return signature;
  }

  /**
   * Gets all registered wallets.
   * 
   * @returns Array of wallet entries
   */
  public getWallets(): WalletEntry[] {
    return Array.from(this.wallets.values());
  }

  /**
   * Gets a specific wallet by ID.
   * 
   * @param walletId - ID of the wallet
   * @returns The wallet entry, or null if not found
   */
  public getWallet(walletId: string): WalletEntry | null {
    return this.wallets.get(walletId) || null;
  }

  /**
   * Gets the active wallet ID.
   * 
   * @returns The active wallet ID, or null if none
   */
  public getActiveWalletId(): string | null {
    return this.activeWalletId;
  }
}
