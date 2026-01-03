// library-source/examples/orca-workflow-example.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { OrcaClient } from "../libs/OrcaClient";
import { WalletManager, RiskLevel } from "../libs/WalletManager";

/**
 * Complete Orca Integration Workflow Example
 * 
 * This demonstrates the full 4-step process:
 * 1. create_collection() - Create collection and mint
 * 2. mint_collection_tokens() - Mint 80% to liquidity reserve
 * 3. initialize_orca_pool() - Create Whirlpool on Orca
 * 4. open_orca_position() + deposit_liquidity_to_orca() - Add liquidity
 * 
 * ⚠️ IMPORTANT: Creator Must Provide CAPGM Liquidity
 * 
 * When depositing the 80% of collection tokens to Orca, the creator MUST
 * provide CAPGM tokens to pair with them. This is the "Cost of Business"
 * that prevents spam collections and ensures creator commitment.
 * 
 * Minimum Required: ~50-100 CAPGM tokens (~$50-100 USD equivalent)
 * 
 * ⚠️ This example assumes you have already completed steps 1-2
 */

async function main() {
  // =========================================================================
  // SETUP
  // =========================================================================

  // Initialize Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load your program
  const programId = new PublicKey("YOUR_PROGRAM_ID");
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) throw new Error("IDL not found");
  const program = new anchor.Program(idl, programId, provider);

  // Initialize clients
  const walletManager = new WalletManager(provider.wallet);
  const orcaClient = new OrcaClient(
    program,
    walletManager,
    provider.connection
  );

  // Collection details (from previous steps)
  const collectionId = "my-collection-001";
  const collectionOwner = provider.wallet.publicKey;
  const collectionPda = orcaClient.getCollectionPda(
    collectionOwner,
    collectionId
  );
  const collectionMint = orcaClient.getMintPda(collectionPda);

  // CAPGM token mint (your quote/base currency)
  const capgmMint = new PublicKey("YOUR_CAPGM_MINT");

  // Orca configuration (Devnet example)
  // ⚠️ These addresses are network-specific (mainnet/devnet)
  const ORCA_WHIRLPOOLS_CONFIG_DEVNET = new PublicKey(
    "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"
  );

  // Fee tier for standard pairs (64 tick spacing = 0.05% fee)
  const FEE_TIER_STANDARD_DEVNET = new PublicKey(
    "YOUR_FEE_TIER_ADDRESS" // Get from Orca docs
  );

  // Orca metadata update authority (network-specific)
  const ORCA_METADATA_UPDATE_AUTH = new PublicKey(
    "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr" // Orca's authority
  );

  // Token decimals
  const DECIMALS_A = 6; // Collection token
  const DECIMALS_B = 6; // CAPGM token

  console.log("=== Orca Integration Workflow ===");
  console.log("Collection ID:", collectionId);
  console.log("Collection PDA:", collectionPda.toString());
  console.log("Collection Mint:", collectionMint.toString());
  console.log("CAPGM Mint:", capgmMint.toString());

  // =========================================================================
  // STEP 3: INITIALIZE ORCA POOL
  // =========================================================================

  console.log("\n=== Step 3: Initialize Orca Pool ===");

  // Sort tokens (CRITICAL!)
  const [mintA, mintB] = orcaClient.sortTokens(collectionMint, capgmMint);
  console.log("Sorted Token A:", mintA.toString());
  console.log("Sorted Token B:", mintB.toString());

  // Check if already sorted correctly
  const isSorted = orcaClient.areTokensSorted(collectionMint, capgmMint);
  if (!isSorted) {
    console.warn("⚠️ Tokens needed sorting! Make sure to use sorted mints.");
  }

  // Define initial price
  // Example: 1 Collection Token = 0.01 CAPGM
  const initialPrice = 0.01;
  const tickSpacing = OrcaClient.TICK_SPACING.STANDARD; // 64

  console.log("Initial price:", initialPrice);
  console.log("Tick spacing:", tickSpacing);

  // Calculate sqrt price (client-side)
  const initialSqrtPrice = orcaClient.calculateSqrtPrice(
    initialPrice,
    DECIMALS_A,
    DECIMALS_B
  );
  console.log("Initial sqrt price:", initialSqrtPrice.toString());

  // Derive Whirlpool PDA
  const whirlpoolPda = orcaClient.getWhirlpoolPda(
    ORCA_WHIRLPOOLS_CONFIG_DEVNET,
    mintA,
    mintB,
    tickSpacing
  );
  console.log("Whirlpool PDA:", whirlpoolPda.toString());

  // Initialize pool
  try {
    const initPoolSig = await orcaClient.initializePool({
      collectionId,
      collectionOwner,
      collectionMint: mintA,
      capgmMint: mintB,
      whirlpoolsConfigKey: ORCA_WHIRLPOOLS_CONFIG_DEVNET,
      feeTierKey: FEE_TIER_STANDARD_DEVNET,
      tickSpacing,
      initialPrice,
      decimalsA: DECIMALS_A,
      decimalsB: DECIMALS_B,
    });

    console.log("✅ Pool initialized!");
    console.log("   Signature:", initPoolSig);
  } catch (error) {
    console.error("❌ Pool initialization failed:", error);
    throw error;
  }

  // =========================================================================
  // STEP 4A: OPEN POSITION (PROTOCOL-CONTROLLED)
  // =========================================================================

  console.log("\n=== Step 4a: Open Position ===");

  // Define price range
  // Example: Position covers 1 COL = 0.005 to 0.02 CAPGM
  const lowerPrice = 0.005;
  const upperPrice = 0.02;

  console.log("Price range:", lowerPrice, "to", upperPrice);

  // Calculate tick indices (client-side)
  const tickLowerIndex = orcaClient.calculateTickIndex(
    lowerPrice,
    DECIMALS_A,
    DECIMALS_B,
    tickSpacing
  );

  const tickUpperIndex = orcaClient.calculateTickIndex(
    upperPrice,
    DECIMALS_A,
    DECIMALS_B,
    tickSpacing
  );

  console.log("Tick range:", tickLowerIndex, "to", tickUpperIndex);

  // Open position
  let positionMint: PublicKey;
  let positionPda: PublicKey;

  try {
    const result = await orcaClient.openPosition({
      collectionId,
      collectionOwner,
      whirlpoolPda,
      lowerPrice,
      upperPrice,
      decimalsA: DECIMALS_A,
      decimalsB: DECIMALS_B,
      tickSpacing,
      metadataUpdateAuth: ORCA_METADATA_UPDATE_AUTH,
    });

    positionMint = result.positionMint;
    positionPda = orcaClient.getPositionPda(positionMint);

    console.log("✅ Position opened!");
    console.log("   Signature:", result.signature);
    console.log("   Position Mint:", positionMint.toString());
    console.log("   Position PDA:", positionPda.toString());
    console.log("   NFT Owner: Collection PDA (protocol-controlled) ✅");
  } catch (error) {
    console.error("❌ Position opening failed:", error);
    throw error;
  }

  // =========================================================================
  // STEP 4B: DEPOSIT LIQUIDITY (FLASH DEPOSIT)
  // =========================================================================

  console.log("\n=== Step 4b: Deposit Liquidity (Flash Deposit) ===");
  
  // ⚠️ CRITICAL REQUIREMENT: Creator Must Provide CAPGM
  console.log("\n⚠️  CREATOR LIQUIDITY REQUIREMENT:");
  console.log("   The creator MUST provide CAPGM tokens to pair with collection tokens.");
  console.log("   This is the 'Cost of Business' that prevents spam collections.");
  console.log("   Minimum: MIN_INITIAL_CAPGM_LIQUIDITY (~50-100 CAPGM)");
  console.log("   ");
  console.log("   Economic Rationale:");
  console.log("   • Prevents spam collections");
  console.log("   • Ensures creator commitment ('skin in the game')");
  console.log("   • Enables healthy price discovery");
  console.log("   • Creator recovers via 10% allocation + staking rewards");
  console.log("");

  // Define how much to deposit
  // Example: Deposit 800 Collection tokens (the 80% from minting)
  const depositAmount = new anchor.BN(800_000_000); // 800 tokens (6 decimals)
  const slippageTolerance = 1; // 1%

  console.log("Deposit amount:", depositAmount.toString(), "Collection tokens");
  console.log("Slippage tolerance:", slippageTolerance + "%");

  // Calculate required CAPGM amount (client-side)
  console.log("\nCalculating liquidity amounts...");

  const quote = await orcaClient.calculateLiquidityAmounts({
    whirlpoolPda,
    positionPda,
    inputTokenMint: mintA, // Collection token
    inputTokenAmount: depositAmount,
    collectionMint: mintA,
    capgmMint: mintB,
    slippageTolerancePercent: slippageTolerance,
  });

  console.log("\nLiquidity calculation:");
  console.log("   Liquidity:", quote.liquidityAmount.toString());
  console.log("   Max Token A (Collection):", quote.tokenMaxA.toString());
  console.log("   Max Token B (CAPGM):", quote.tokenMaxB.toString(), "← Creator must provide this");
  console.log("   Est Token A:", quote.estimatedTokenA.toString());
  console.log("   Est Token B:", quote.estimatedTokenB.toString());

  // Check user's CAPGM balance
  console.log("\n✅ Validating creator's CAPGM balance...");
  
  const creatorCapgmAccount = anchor.utils.token.associatedAddress({
    mint: mintB,
    owner: provider.wallet.publicKey,
  });

  try {
    const capgmAccountInfo = await provider.connection.getAccountInfo(
      creatorCapgmAccount
    );

    if (!capgmAccountInfo) {
      throw new Error(
        "❌ Creator CAPGM account not found. Please create and fund it first.\n" +
        "   The creator must have sufficient CAPGM to pair with collection tokens.\n" +
        "   Required: " + quote.tokenMaxB.toString() + " CAPGM tokens"
      );
    }

    // Parse token account to check balance
    const tokenAccountData = await provider.connection.getTokenAccountBalance(
      creatorCapgmAccount
    );
    const capgmBalance = new anchor.BN(tokenAccountData.value.amount);

    console.log("   Creator CAPGM balance:", capgmBalance.toString());
    console.log("   Required CAPGM amount:", quote.tokenMaxB.toString());

    if (capgmBalance.lt(quote.tokenMaxB)) {
      throw new Error(
        "❌ Insufficient CAPGM balance!\n" +
        "   Balance: " + capgmBalance.toString() + "\n" +
        "   Required: " + quote.tokenMaxB.toString() + "\n" +
        "   Please acquire more CAPGM tokens before depositing liquidity."
      );
    }

    console.log("✅ Creator has sufficient CAPGM balance");
  } catch (error) {
    console.error("❌ CAPGM validation failed:", error);
    throw error;
  }

  // Deposit liquidity
  console.log("\n📤 Depositing liquidity to Orca (Flash Deposit)...");
  console.log("   This will:");
  console.log("   1. Transfer " + quote.tokenMaxB.toString() + " CAPGM from creator → Collection Reserve B");
  console.log("   2. Pair with " + quote.tokenMaxA.toString() + " Collection tokens");
  console.log("   3. Deposit both to Orca Whirlpool with protocol control");
  console.log("");
  try {
    const depositSig = await orcaClient.depositLiquidity({
      collectionId,
      collectionOwner,
      whirlpoolPda,
      positionPda,
      positionMint,
      collectionMint: mintA,
      capgmMint: mintB,
      inputTokenAmount: depositAmount,
      slippageTolerancePercent: slippageTolerance,
      tickSpacing,
      tickLowerIndex,
      tickUpperIndex,
    });

    console.log("✅ Liquidity deposited!");
    console.log("   Signature:", depositSig);
    console.log("\n🎉 Flash Deposit complete!");
    console.log("   Phase 1: Pulled CAPGM from creator → Collection Reserve B");
    console.log("   Phase 2: Collection PDA signed Orca CPI");
    console.log("   Phase 3: Deposited liquidity to Orca pool");
    console.log("\n✅ Protocol now controls all liquidity!");
  } catch (error) {
    console.error("❌ Liquidity deposit failed:", error);
    throw error;
  }

  // =========================================================================
  // VERIFICATION
  // =========================================================================

  console.log("\n=== Verification ===");

  // Check position token account ownership
  const positionTokenAccount = orcaClient.getPositionTokenAccount(
    positionMint,
    collectionPda
  );

  try {
    const tokenAccountInfo = await provider.connection.getParsedAccountInfo(
      positionTokenAccount
    );

    if (tokenAccountInfo.value) {
      const parsed = tokenAccountInfo.value.data as any;
      const owner = new PublicKey(parsed.parsed.info.owner);

      console.log("Position Token Account:", positionTokenAccount.toString());
      console.log("   Owner:", owner.toString());
      console.log(
        "   Collection PDA:",
        collectionPda.toString()
      );

      if (owner.equals(collectionPda)) {
        console.log("   ✅ Position correctly owned by Collection PDA!");
      } else {
        console.warn("   ⚠️  Position owned by different account!");
      }
    }
  } catch (error) {
    console.error("Verification failed:", error);
  }

  console.log("\n=== Workflow Complete! ===");
  console.log("Next steps:");
  console.log("1. Monitor liquidity position on Orca");
  console.log("2. Collect trading fees");
  console.log("3. Implement liquidity management strategies");
}

// Run the example
main()
  .then(() => {
    console.log("\n✅ Example completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Example failed:", error);
    process.exit(1);
  });

