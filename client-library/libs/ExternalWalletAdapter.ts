// client-library/libs/ExternalWalletAdapter.ts
// 
// Adapters for external wallets (Phantom, Solflare, etc.)
// Supports QR code connection for mobile wallets

import * as web3 from "@solana/web3.js";
import { ExternalWallet } from "./WalletManager";

/**
 * Phantom wallet adapter implementation.
 * Supports connection via QR code scanning.
 */
export class PhantomWalletAdapter implements ExternalWallet {
  public readonly id: string;
  public readonly name: string = "Phantom";
  public publicKey: web3.PublicKey;
  private phantom: any; // Phantom wallet instance
  private connected: boolean = false;

  constructor() {
    this.id = `phantom-${Date.now()}`;
    // Initialize with dummy public key (will be set on connect)
    this.publicKey = web3.PublicKey.default;
  }

  /**
   * Connects to Phantom wallet.
   * In Electron, this can be done via:
   * 1. Browser extension (if available)
   * 2. QR code scanning (mobile Phantom)
   * 3. Deep link (mobile apps)
   * 
   * @param connectionMethod - How to connect ("extension" | "qr" | "deeplink")
   * @returns The public key of the connected wallet
   */
  public async connect(connectionMethod: "extension" | "qr" | "deeplink" = "extension"): Promise<web3.PublicKey> {
    if (connectionMethod === "extension") {
      return await this.connectViaExtension();
    } else if (connectionMethod === "qr") {
      return await this.connectViaQR();
    } else {
      return await this.connectViaDeepLink();
    }
  }

  /**
   * Connects via browser extension (if available in Electron).
   */
  private async connectViaExtension(): Promise<web3.PublicKey> {
    // Check if window.phantom?.solana exists (browser extension)
    // In Electron, this would check the renderer process's window object
    if (typeof globalThis !== "undefined" && (globalThis as any).phantom?.solana) {
      this.phantom = (globalThis as any).phantom.solana;
      const response = await this.phantom.connect();
      this.publicKey = new web3.PublicKey(response.publicKey);
      this.connected = true;
      return this.publicKey;
    }

    throw new Error("Phantom extension not found. Use QR code or deep link instead.");
  }

  /**
   * Connects via QR code scanning.
   * Generates a QR code that the user can scan with their mobile Phantom wallet.
   * 
   * @returns The public key of the connected wallet
   */
  private async connectViaQR(): Promise<web3.PublicKey> {
    // Generate a connection request
    // In a real implementation, you would:
    // 1. Generate a unique session ID
    // 2. Create a QR code with connection URL
    // 3. Poll for connection confirmation
    // 4. Receive public key via WebSocket or polling

    // For now, this is a placeholder
    // TODO: Implement QR code generation and polling mechanism
    throw new Error("QR code connection not yet implemented. Use a QR code library like 'qrcode' to generate codes.");
  }

  /**
   * Connects via deep link (mobile apps).
   */
  private async connectViaDeepLink(): Promise<web3.PublicKey> {
    // Generate deep link URL
    // In Electron, use shell.openExternal() to open the link
    // The mobile app will handle the connection and return via callback

    // For now, this is a placeholder
    throw new Error("Deep link connection not yet implemented.");
  }

  /**
   * Signs a transaction using Phantom wallet.
   */
  public async signTransaction(transaction: web3.Transaction): Promise<web3.Transaction> {
    if (!this.connected || !this.phantom) {
      throw new Error("Phantom wallet not connected");
    }

    // Phantom requires transactions to be serialized
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const signed = await this.phantom.signTransaction(serialized);
    return web3.Transaction.from(signed);
  }

  /**
   * Signs a message using Phantom wallet.
   */
  public async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.connected || !this.phantom) {
      throw new Error("Phantom wallet not connected");
    }

    const encodedMessage = new Uint8Array(message);
    const signed = await this.phantom.signMessage(encodedMessage, "utf8");
    return new Uint8Array(signed.signature);
  }

  /**
   * Checks if wallet is connected.
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnects the wallet.
   */
  public async disconnect(): Promise<void> {
    if (this.phantom && this.connected) {
      try {
        await this.phantom.disconnect();
      } catch (error) {
        // Ignore errors on disconnect
      }
    }
    this.connected = false;
    this.phantom = null;
  }
}

/**
 * Helper function to generate QR code data for wallet connection.
 * Uses the 'qrcode' library if available.
 * 
 * @param connectionUrl - URL or data to encode in QR code
 * @returns QR code data URL (can be displayed as image)
 */
export async function generateWalletQRCode(connectionUrl: string): Promise<string> {
  // Dynamic import to avoid requiring qrcode if not installed
  try {
    const QRCode = await import("qrcode");
    const qrDataUrl = await QRCode.toDataURL(connectionUrl, {
      errorCorrectionLevel: "M",
      type: "image/png",
      width: 300,
    });
    return qrDataUrl;
  } catch (error) {
    throw new Error(
      "QR code generation requires 'qrcode' package. Install it with: npm install qrcode @types/qrcode"
    );
  }
}

/**
 * Creates a Phantom wallet adapter and connects it.
 * 
 * @param connectionMethod - How to connect
 * @returns Connected Phantom wallet adapter
 */
export async function createPhantomWallet(
  connectionMethod: "extension" | "qr" | "deeplink" = "extension"
): Promise<PhantomWalletAdapter> {
  const adapter = new PhantomWalletAdapter();
  await adapter.connect(connectionMethod);
  return adapter;
}

