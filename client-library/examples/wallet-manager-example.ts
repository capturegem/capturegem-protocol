// client-library/examples/wallet-manager-example.ts
//
// Example: Using WalletManager with multiple wallets (internal + external)
//
// This demonstrates:
// 1. Creating and loading internal wallets
// 2. Adding external wallets (Phantom)
// 3. Signing transactions through WalletManager
// 4. Switching between wallets

import { Connection, Keypair, Transaction, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { WalletManager, RiskLevel } from "../libs/WalletManager";
import { createPhantomWallet, generateWalletQRCode } from "../libs/ExternalWalletAdapter";
import * as path from "path";
import * as os from "os";

async function main() {
  console.log("🔐 WalletManager Example\n");
  console.log("=" .repeat(60));

  // ============================================================================
  // 1. Setup Connection
  // ============================================================================
  
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const walletManager = new WalletManager(connection);

  // ============================================================================
  // 2. Create Internal Wallet
  // ============================================================================
  
  console.log("\n📝 Creating internal wallet...");
  
  const walletPath = path.join(os.homedir(), ".capturegem", "wallet.json");
  const password = "my-secure-password"; // In production, prompt user for this
  
  // Create a new internal wallet
  const internalWalletPubkey = await walletManager.createInternalWallet(
    "main-wallet",
    walletPath,
    password,
    {
      // Optional: Set confirmation handler for high-risk transactions
      onHighRiskConfirm: async (tx: Transaction) => {
        console.log("⚠️  High-risk transaction detected!");
        console.log("Transaction:", tx);
        // In Electron, this would show a dialog
        // For now, auto-confirm
        return true;
      },
    }
  );
  
  console.log(`✅ Internal wallet created: ${internalWalletPubkey.toBase58()}`);

  // ============================================================================
  // 3. Load Another Internal Wallet (if exists)
  // ============================================================================
  
  const backupWalletPath = path.join(os.homedir(), ".capturegem", "backup-wallet.json");
  
  try {
    console.log("\n📂 Loading backup wallet...");
    const backupPubkey = await walletManager.loadInternalWallet(
      "backup-wallet",
      backupWalletPath,
      password
    );
    console.log(`✅ Backup wallet loaded: ${backupPubkey.toBase58()}`);
  } catch (error) {
    console.log("ℹ️  Backup wallet not found (this is okay)");
  }

  // ============================================================================
  // 4. Add External Wallet (Phantom)
  // ============================================================================
  
  console.log("\n👻 Adding Phantom wallet...");
  
  try {
    // Try to connect via extension first
    const phantomWallet = await createPhantomWallet("extension");
    await walletManager.addExternalWallet("phantom-wallet", phantomWallet);
    console.log(`✅ Phantom wallet connected: ${phantomWallet.publicKey.toBase58()}`);
  } catch (error) {
    console.log("ℹ️  Phantom extension not available, using QR code method...");
    
    // In a real app, you would:
    // 1. Generate a connection URL
    // 2. Generate QR code
    // 3. Display QR code to user
    // 4. Poll for connection confirmation
    // 5. Add wallet once connected
    
    const connectionUrl = "https://phantom.app/connect?session=abc123";
    try {
      const qrCodeDataUrl = await generateWalletQRCode(connectionUrl);
      console.log("📱 QR Code generated (would display in UI)");
      console.log("   Data URL length:", qrCodeDataUrl.length);
      
      // In Electron, you would:
      // - Display the QR code in a window
      // - Poll for connection
      // - Once connected, add the wallet
    } catch (qrError) {
      console.log("⚠️  QR code generation requires 'qrcode' package");
      console.log("   Install with: npm install qrcode @types/qrcode");
    }
  }

  // ============================================================================
  // 5. List All Wallets
  // ============================================================================
  
  console.log("\n📋 Registered Wallets:");
  const wallets = walletManager.getWallets();
  wallets.forEach((wallet) => {
    console.log(`  - ${wallet.name} (${wallet.type})`);
    console.log(`    ID: ${wallet.id}`);
    console.log(`    Public Key: ${wallet.publicKey.toBase58()}`);
    console.log(`    Active: ${wallet.isActive ? "✅" : "❌"}`);
  });

  // ============================================================================
  // 6. Switch Active Wallet
  // ============================================================================
  
  console.log("\n🔄 Switching active wallet...");
  
  if (wallets.length > 1) {
    const newActiveId = wallets.find((w) => !w.isActive)?.id;
    if (newActiveId) {
      walletManager.setActiveWallet(newActiveId);
      console.log(`✅ Switched to: ${newActiveId}`);
      console.log(`   Active public key: ${walletManager.getActivePublicKey().toBase58()}`);
    }
  }

  // ============================================================================
  // 7. Sign Transaction
  // ============================================================================
  
  console.log("\n✍️  Signing transaction...");
  
  try {
    // Create a simple transaction
    const activePubkey = walletManager.getActivePublicKey();
    const transaction = new Transaction().add(
      // Example: Transfer instruction (would need proper instruction here)
      // For demo purposes, just create an empty transaction
    );
    
    // Sign with low risk (auto-sign)
    const signedTx = await walletManager.signTransaction(transaction, RiskLevel.LOW);
    console.log("✅ Transaction signed (low risk - auto-signed)");
    
    // Sign with high risk (requires confirmation)
    const signedTxHighRisk = await walletManager.signTransaction(transaction, RiskLevel.HIGH);
    console.log("✅ Transaction signed (high risk - confirmed)");
    
    // Sign and send
    // const signature = await walletManager.signAndSendTransaction(transaction, RiskLevel.LOW);
    // console.log(`✅ Transaction sent: ${signature}`);
  } catch (error) {
    console.error("❌ Error signing transaction:", error);
  }

  // ============================================================================
  // 8. Sign Message
  // ============================================================================
  
  console.log("\n✍️  Signing message...");
  
  try {
    const message = new Uint8Array(Buffer.from("Hello, CaptureGem!"));
    const signature = await walletManager.signMessage(message);
    console.log("✅ Message signed");
    console.log("   Signature:", Buffer.from(signature).toString("base64"));
  } catch (error) {
    console.error("❌ Error signing message:", error);
  }

  // ============================================================================
  // 9. Cleanup
  // ============================================================================
  
  console.log("\n🧹 Cleaning up...");
  
  // Disconnect external wallets
  for (const wallet of wallets) {
    if (wallet.type === "external" && wallet.externalWallet) {
      await wallet.externalWallet.disconnect();
      console.log(`✅ Disconnected: ${wallet.name}`);
    }
  }

  console.log("\n✅ Example complete!");
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { main };

