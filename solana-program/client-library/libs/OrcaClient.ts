// client-library/libs/OrcaClient.ts
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Keypair,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PriceMath,
  TickUtil,
  PDAUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputTokenWithParams,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  NO_TOKEN_EXTENSION_CONTEXT,
} from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import { WalletManager, RiskLevel } from "./WalletManager";

/**
 * Orca Whirlpool Integration Client
 * 
 * Handles all Orca-related operations for the CaptureGem Protocol:
 * - Pool initialization
 * - Position creation (protocol-controlled)
 * - Liquidity deposits (Flash Deposit pattern)
 * 
 * ⚠️ CRITICAL: All price and tick calculations are done CLIENT-SIDE
 * to avoid expensive on-chain floating-point operations.
 */
export class OrcaClient {
  program: anchor.Program;
  walletManager: WalletManager;
  connection: anchor.web3.Connection;

  // Orca Whirlpool constants
  static readonly ORCA_WHIRLPOOL_PROGRAM_ID = ORCA_WHIRLPOOL_PROGRAM_ID;
  
  // Metaplex Token Metadata Program
  static readonly METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  // Default tick spacings (fee tiers)
  static readonly TICK_SPACING = {
    STABLE: 1,      // 0.01% fee - for stable pairs (USDC/USDT)
    STANDARD: 64,   // 0.05% fee - for standard pairs (most common)
    VOLATILE: 128,  // 0.3% fee - for volatile pairs
  } as const;

  constructor(
    program: anchor.Program,
    walletManager: WalletManager,
    connection: anchor.web3.Connection
  ) {
    this.program = program;
    this.walletManager = walletManager;
    this.connection = connection;
  }

  // =========================================================================
  // PDA DERIVATIONS
  // =========================================================================

  /**
   * Derive the Collection PDA
   */
  getCollectionPda(owner: PublicKey, collectionId: string): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("collection"),
        owner.toBuffer(),
        Buffer.from(collectionId),
      ],
      this.program.programId
    );
    return pda;
  }

  /**
   * Derive the Collection Token Mint PDA
   */
  getMintPda(collectionPda: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), collectionPda.toBuffer()],
      this.program.programId
    );
    return pda;
  }

  /**
   * Derive the Liquidity Reserve A (Collection tokens)
   */
  getLiquidityReserveA(
    collectionPda: PublicKey,
    mintPda: PublicKey
  ): PublicKey {
    return getAssociatedTokenAddressSync(
      mintPda,
      collectionPda,
      true // allowOwnerOffCurve for PDA
    );
  }

  /**
   * Derive the Liquidity Reserve B (CAPGM tokens)
   */
  getLiquidityReserveB(
    collectionPda: PublicKey,
    capgmMint: PublicKey
  ): PublicKey {
    return getAssociatedTokenAddressSync(
      capgmMint,
      collectionPda,
      true // allowOwnerOffCurve for PDA
    );
  }

  /**
   * Derive the Orca Whirlpool PDA
   * 
   * ⚠️ IMPORTANT: Orca sorts tokens by address (mintA < mintB)
   */
  getWhirlpoolPda(
    whirlpoolsConfigKey: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    tickSpacing: number
  ): PublicKey {
    // Ensure proper token order
    const [sortedMintA, sortedMintB] = this.sortTokens(mintA, mintB);
    
    return PDAUtil.getWhirlpool(
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpoolsConfigKey,
      sortedMintA,
      sortedMintB,
      tickSpacing
    ).publicKey;
  }

  /**
   * Derive Orca Position PDA
   */
  getPositionPda(positionMint: PublicKey): PublicKey {
    return PDAUtil.getPosition(
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID,
      positionMint
    ).publicKey;
  }

  /**
   * Derive Position Token Account (owned by Collection PDA)
   */
  getPositionTokenAccount(
    positionMint: PublicKey,
    collectionPda: PublicKey
  ): PublicKey {
    return getAssociatedTokenAddressSync(
      positionMint,
      collectionPda,
      true // allowOwnerOffCurve for PDA
    );
  }

  /**
   * Derive Position Metadata PDA
   */
  getPositionMetadataPda(positionMint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        OrcaClient.METADATA_PROGRAM_ID.toBuffer(),
        positionMint.toBuffer(),
      ],
      OrcaClient.METADATA_PROGRAM_ID
    );
    return pda;
  }

  /**
   * Derive Tick Array PDA
   */
  getTickArrayPda(
    whirlpoolPda: PublicKey,
    tickIndex: number,
    tickSpacing: number
  ): PublicKey {
    return PDAUtil.getTickArrayFromTickIndex(
      tickIndex,
      tickSpacing,
      whirlpoolPda,
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
    ).publicKey;
  }

  // =========================================================================
  // TOKEN SORTING (CRITICAL FOR ORCA)
  // =========================================================================

  /**
   * Sort tokens by address (Orca requirement)
   * 
   * ⚠️ CRITICAL: Orca always sorts tokens such that mintA < mintB
   * Failing to sort will cause Token A/B logic to swap!
   */
  sortTokens(mintA: PublicKey, mintB: PublicKey): [PublicKey, PublicKey] {
    const mintABytes = mintA.toBuffer();
    const mintBBytes = mintB.toBuffer();

    // Compare byte-by-byte
    for (let i = 0; i < 32; i++) {
      if (mintABytes[i] < mintBBytes[i]) {
        return [mintA, mintB]; // Already sorted
      } else if (mintABytes[i] > mintBBytes[i]) {
        return [mintB, mintA]; // Need to swap
      }
    }

    // Equal (should never happen with different mints)
    return [mintA, mintB];
  }

  /**
   * Check if tokens are in correct order
   */
  areTokensSorted(mintA: PublicKey, mintB: PublicKey): boolean {
    const [sortedA] = this.sortTokens(mintA, mintB);
    return sortedA.equals(mintA);
  }

  // =========================================================================
  // PRICE & TICK CALCULATIONS (CLIENT-SIDE)
  // =========================================================================

  /**
   * Calculate sqrt price from regular price
   * 
   * Example: If 1 Collection Token = 0.01 CAPGM
   * const sqrtPrice = calculateSqrtPrice(0.01, 6, 6);
   */
  calculateSqrtPrice(
    price: number,
    decimalsA: number,
    decimalsB: number
  ): anchor.BN {
    const priceDecimal = new Decimal(price);
    const sqrtPriceX64 = PriceMath.priceToSqrtPriceX64(
      priceDecimal,
      decimalsA,
      decimalsB
    );
    return new anchor.BN(sqrtPriceX64.toString());
  }

  /**
   * Calculate tick index from price
   * 
   * ⚠️ IMPORTANT: Must round to valid tick for tick spacing!
   */
  calculateTickIndex(
    price: number,
    decimalsA: number,
    decimalsB: number,
    tickSpacing: number
  ): number {
    const priceDecimal = new Decimal(price);
    const rawTick = PriceMath.priceToTickIndex(priceDecimal, decimalsA, decimalsB);
    return TickUtil.getStartTickIndex(rawTick, tickSpacing);
  }

  /**
   * Calculate price from tick index
   */
  tickIndexToPrice(
    tickIndex: number,
    decimalsA: number,
    decimalsB: number
  ): number {
    const priceDecimal = PriceMath.tickIndexToPrice(tickIndex, decimalsA, decimalsB);
    return priceDecimal.toNumber();
  }

  /**
   * Calculate liquidity amounts for deposit
   * 
   * This is the most important calculation - it determines how much
   * of each token is needed to add a specific amount of liquidity.
   */
  async calculateLiquidityAmounts(params: {
    whirlpoolPda: PublicKey;
    positionPda: PublicKey;
    inputTokenMint: PublicKey;
    inputTokenAmount: anchor.BN;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    slippageTolerancePercent: number;
  }): Promise<{
    liquidityAmount: anchor.BN;
    tokenMaxA: anchor.BN;
    tokenMaxB: anchor.BN;
    estimatedTokenA: anchor.BN;
    estimatedTokenB: anchor.BN;
  }> {
    // Build Orca client
    const ctx = WhirlpoolContext.withProvider(
      this.program.provider as anchor.AnchorProvider,
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
    );
    const client = buildWhirlpoolClient(ctx);

    // Fetch pool and position data
    const whirlpool = await client.getPool(params.whirlpoolPda);
    const position = await client.getPosition(params.positionPda);

    const whirlpoolData = whirlpool.getData();
    const positionData = position.getData();

    // Calculate quote
    const quote = increaseLiquidityQuoteByInputTokenWithParams({
      inputTokenMint: params.inputTokenMint,
      inputTokenAmount: params.inputTokenAmount,
      tokenMintA: params.collectionMint,
      tokenMintB: params.capgmMint,
      tickCurrentIndex: whirlpoolData.tickCurrentIndex,
      sqrtPrice: whirlpoolData.sqrtPrice,
      tickLowerIndex: positionData.tickLowerIndex,
      tickUpperIndex: positionData.tickUpperIndex,
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      slippageTolerance: Percentage.fromFraction(
        params.slippageTolerancePercent,
        100
      ),
    });

    return {
      liquidityAmount: new anchor.BN(quote.liquidityAmount.toString()),
      tokenMaxA: new anchor.BN(quote.tokenMaxA.toString()),
      tokenMaxB: new anchor.BN(quote.tokenMaxB.toString()),
      estimatedTokenA: new anchor.BN(quote.tokenEstA.toString()),
      estimatedTokenB: new anchor.BN(quote.tokenEstB.toString()),
    };
  }

  // =========================================================================
  // INSTRUCTION BUILDERS
  // =========================================================================

  /**
   * Initialize Orca Whirlpool
   * 
   * Step 3 in the workflow (after mint_collection_tokens)
   */
  async buildInitializePoolInstruction(params: {
    creator: PublicKey;
    collectionId: string;
    collectionOwner: PublicKey;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    whirlpoolsConfigKey: PublicKey;
    feeTierKey: PublicKey;
    tickSpacing: number;
    initialPrice: number; // e.g., 0.01 means 1 COL = 0.01 CAPGM
    decimalsA: number;
    decimalsB: number;
  }): Promise<TransactionInstruction> {
    const collectionPda = this.getCollectionPda(
      params.collectionOwner,
      params.collectionId
    );

    // Sort tokens (CRITICAL!)
    const [mintA, mintB] = this.sortTokens(
      params.collectionMint,
      params.capgmMint
    );

    // Calculate sqrt price CLIENT-SIDE
    const initialSqrtPrice = this.calculateSqrtPrice(
      params.initialPrice,
      params.decimalsA,
      params.decimalsB
    );

    // Derive Whirlpool PDA
    const whirlpoolPda = this.getWhirlpoolPda(
      params.whirlpoolsConfigKey,
      mintA,
      mintB,
      params.tickSpacing
    );

    // Derive token vaults (Orca creates these)
    const [tokenVaultA] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault_a"), whirlpoolPda.toBuffer()],
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
    );

    const [tokenVaultB] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault_b"), whirlpoolPda.toBuffer()],
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
    );

    return await this.program.methods
      .initializeOrcaPool(params.tickSpacing, initialSqrtPrice)
      .accounts({
        creator: params.creator,
        collection: collectionPda,
        collectionMint: mintA, // Sorted token A
        capgmMint: mintB, // Sorted token B
        whirlpoolConfig: params.whirlpoolsConfigKey,
        whirlpool: whirlpoolPda,
        tokenVaultA: tokenVaultA,
        tokenVaultB: tokenVaultB,
        feeTier: params.feeTierKey,
        whirlpoolProgram: OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
  }

  /**
   * Open Orca Position (protocol-controlled)
   * 
   * Step 4a in the workflow
   * 
   * ⚠️ CRITICAL: Position NFT is owned by Collection PDA, not the user!
   */
  async buildOpenPositionInstruction(params: {
    creator: PublicKey;
    collectionId: string;
    collectionOwner: PublicKey;
    whirlpoolPda: PublicKey;
    positionMintKeypair: Keypair; // Must be signed
    lowerPrice: number;
    upperPrice: number;
    decimalsA: number;
    decimalsB: number;
    tickSpacing: number;
    metadataUpdateAuth: PublicKey; // Orca's metadata authority
  }): Promise<{ instruction: TransactionInstruction; positionMint: Keypair }> {
    const collectionPda = this.getCollectionPda(
      params.collectionOwner,
      params.collectionId
    );

    // Calculate tick indices CLIENT-SIDE
    const tickLowerIndex = this.calculateTickIndex(
      params.lowerPrice,
      params.decimalsA,
      params.decimalsB,
      params.tickSpacing
    );

    const tickUpperIndex = this.calculateTickIndex(
      params.upperPrice,
      params.decimalsA,
      params.decimalsB,
      params.tickSpacing
    );

    // Validate tick range
    if (tickLowerIndex >= tickUpperIndex) {
      throw new Error(
        `Invalid tick range: lower (${tickLowerIndex}) must be < upper (${tickUpperIndex})`
      );
    }

    // Derive PDAs
    const positionPda = this.getPositionPda(params.positionMintKeypair.publicKey);
    const positionTokenAccount = this.getPositionTokenAccount(
      params.positionMintKeypair.publicKey,
      collectionPda // ✅ Collection PDA owns position NFT
    );
    const positionMetadata = this.getPositionMetadataPda(
      params.positionMintKeypair.publicKey
    );

    const instruction = await this.program.methods
      .openOrcaPosition(tickLowerIndex, tickUpperIndex)
      .accounts({
        creator: params.creator,
        collection: collectionPda,
        whirlpool: params.whirlpoolPda,
        position: positionPda,
        positionMint: params.positionMintKeypair.publicKey,
        positionTokenAccount: positionTokenAccount,
        positionMetadata: positionMetadata,
        whirlpoolProgram: OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        metadataProgram: OrcaClient.METADATA_PROGRAM_ID,
        metadataUpdateAuth: params.metadataUpdateAuth,
      })
      .instruction();

    return {
      instruction,
      positionMint: params.positionMintKeypair,
    };
  }

  /**
   * Deposit Liquidity to Orca (Flash Deposit)
   * 
   * Step 4b in the workflow
   * 
   * This uses the Flash Deposit pattern:
   * 1. Pull CAPGM from user → Collection Reserve B
   * 2. Collection PDA signs Orca CPI to deposit both reserves
   */
  async buildDepositLiquidityInstruction(params: {
    creator: PublicKey;
    collectionId: string;
    collectionOwner: PublicKey;
    whirlpoolPda: PublicKey;
    positionPda: PublicKey;
    positionMint: PublicKey;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    creatorCapgmAccount: PublicKey;
    liquidityAmount: anchor.BN;
    tokenMaxA: anchor.BN;
    tokenMaxB: anchor.BN;
    tickSpacing: number;
    tickLowerIndex: number;
    tickUpperIndex: number;
  }): Promise<TransactionInstruction> {
    const collectionPda = this.getCollectionPda(
      params.collectionOwner,
      params.collectionId
    );

    // Sort tokens (CRITICAL!)
    const [mintA, mintB] = this.sortTokens(
      params.collectionMint,
      params.capgmMint
    );

    // Derive reserves
    const collectionReserveA = this.getLiquidityReserveA(
      collectionPda,
      mintA
    );
    const collectionReserveB = this.getLiquidityReserveB(
      collectionPda,
      mintB
    );

    // Derive position accounts
    const positionTokenAccount = this.getPositionTokenAccount(
      params.positionMint,
      collectionPda
    );

    // Derive token vaults
    const [tokenVaultA] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault_a"), params.whirlpoolPda.toBuffer()],
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
    );

    const [tokenVaultB] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault_b"), params.whirlpoolPda.toBuffer()],
      OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID
    );

    // Derive tick arrays
    const tickArrayLower = this.getTickArrayPda(
      params.whirlpoolPda,
      params.tickLowerIndex,
      params.tickSpacing
    );

    const tickArrayUpper = this.getTickArrayPda(
      params.whirlpoolPda,
      params.tickUpperIndex,
      params.tickSpacing
    );

    return await this.program.methods
      .depositLiquidityToOrca(
        params.liquidityAmount,
        params.tokenMaxA,
        params.tokenMaxB
      )
      .accounts({
        creator: params.creator,
        collection: collectionPda,
        whirlpool: params.whirlpoolPda,
        position: params.positionPda,
        positionTokenAccount: positionTokenAccount,
        positionMint: params.positionMint,
        tokenMintA: mintA,
        collectionReserveA: collectionReserveA,
        tokenMintB: mintB,
        creatorTokenB: params.creatorCapgmAccount,
        collectionReserveB: collectionReserveB,
        tokenVaultA: tokenVaultA,
        tokenVaultB: tokenVaultB,
        tickArrayLower: tickArrayLower,
        tickArrayUpper: tickArrayUpper,
        whirlpoolProgram: OrcaClient.ORCA_WHIRLPOOL_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // =========================================================================
  // HIGH-LEVEL TRANSACTION BUILDERS
  // =========================================================================

  /**
   * Build complete transaction to initialize Orca pool
   * 
   * ⚠️ Sets compute unit limit to 300k (pool initialization is expensive)
   */
  async buildInitializePoolTransaction(params: {
    creator: PublicKey;
    collectionId: string;
    collectionOwner: PublicKey;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    whirlpoolsConfigKey: PublicKey;
    feeTierKey: PublicKey;
    tickSpacing: number;
    initialPrice: number;
    decimalsA: number;
    decimalsB: number;
  }): Promise<Transaction> {
    const instruction = await this.buildInitializePoolInstruction(params);

    const tx = new Transaction();

    // Set compute unit limit
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })
    );

    tx.add(instruction);

    return tx;
  }

  /**
   * Build complete transaction to open position
   * 
   * ⚠️ Sets compute unit limit to 250k
   */
  async buildOpenPositionTransaction(params: {
    creator: PublicKey;
    collectionId: string;
    collectionOwner: PublicKey;
    whirlpoolPda: PublicKey;
    lowerPrice: number;
    upperPrice: number;
    decimalsA: number;
    decimalsB: number;
    tickSpacing: number;
    metadataUpdateAuth: PublicKey;
  }): Promise<{ transaction: Transaction; positionMint: Keypair }> {
    const positionMintKeypair = Keypair.generate();

    const { instruction, positionMint } =
      await this.buildOpenPositionInstruction({
        ...params,
        positionMintKeypair,
      });

    const tx = new Transaction();

    // Set compute unit limit
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 })
    );

    tx.add(instruction);

    return {
      transaction: tx,
      positionMint,
    };
  }

  /**
   * Build complete transaction to deposit liquidity (Flash Deposit)
   * 
   * ⚠️ Sets compute unit limit to 400k (Flash Deposit is very expensive)
   */
  async buildDepositLiquidityTransaction(params: {
    creator: PublicKey;
    collectionId: string;
    collectionOwner: PublicKey;
    whirlpoolPda: PublicKey;
    positionPda: PublicKey;
    positionMint: PublicKey;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    inputTokenAmount: anchor.BN; // How much Collection token to deposit
    slippageTolerancePercent: number; // e.g., 1 for 1%
    tickSpacing: number;
    tickLowerIndex: number;
    tickUpperIndex: number;
  }): Promise<Transaction> {
    // Calculate liquidity amounts CLIENT-SIDE
    const quote = await this.calculateLiquidityAmounts({
      whirlpoolPda: params.whirlpoolPda,
      positionPda: params.positionPda,
      inputTokenMint: params.collectionMint,
      inputTokenAmount: params.inputTokenAmount,
      collectionMint: params.collectionMint,
      capgmMint: params.capgmMint,
      slippageTolerancePercent: params.slippageTolerancePercent,
    });

    // Get creator's CAPGM account
    const creatorCapgmAccount = getAssociatedTokenAddressSync(
      params.capgmMint,
      params.creator
    );

    const instruction = await this.buildDepositLiquidityInstruction({
      creator: params.creator,
      collectionId: params.collectionId,
      collectionOwner: params.collectionOwner,
      whirlpoolPda: params.whirlpoolPda,
      positionPda: params.positionPda,
      positionMint: params.positionMint,
      collectionMint: params.collectionMint,
      capgmMint: params.capgmMint,
      creatorCapgmAccount,
      liquidityAmount: quote.liquidityAmount,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
      tickSpacing: params.tickSpacing,
      tickLowerIndex: params.tickLowerIndex,
      tickUpperIndex: params.tickUpperIndex,
    });

    const tx = new Transaction();

    // ⚠️ CRITICAL: Set high compute unit limit for Flash Deposit
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );

    tx.add(instruction);

    return tx;
  }

  // =========================================================================
  // CONVENIENCE METHODS WITH WALLET SIGNING
  // =========================================================================

  /**
   * Initialize Orca pool (with wallet signing)
   */
  async initializePool(params: {
    collectionId: string;
    collectionOwner: PublicKey;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    whirlpoolsConfigKey: PublicKey;
    feeTierKey: PublicKey;
    tickSpacing: number;
    initialPrice: number;
    decimalsA: number;
    decimalsB: number;
  }): Promise<string> {
    const creator = this.walletManager.getPublicKey();

    const tx = await this.buildInitializePoolTransaction({
      creator,
      ...params,
    });

    return await this.walletManager.signTransaction(
      tx,
      RiskLevel.HIGH
    );
  }

  /**
   * Open position (with wallet signing)
   */
  async openPosition(params: {
    collectionId: string;
    collectionOwner: PublicKey;
    whirlpoolPda: PublicKey;
    lowerPrice: number;
    upperPrice: number;
    decimalsA: number;
    decimalsB: number;
    tickSpacing: number;
    metadataUpdateAuth: PublicKey;
  }): Promise<{ signature: string; positionMint: PublicKey }> {
    const creator = this.walletManager.getPublicKey();

    const { transaction, positionMint } =
      await this.buildOpenPositionTransaction({
        creator,
        ...params,
      });

    // Sign transaction with position mint as additional signer
    transaction.partialSign(positionMint);
    
    const signature = await this.walletManager.signTransaction(
      transaction,
      RiskLevel.HIGH
    );

    return {
      signature,
      positionMint: positionMint.publicKey,
    };
  }

  /**
   * Deposit liquidity (with wallet signing)
   */
  async depositLiquidity(params: {
    collectionId: string;
    collectionOwner: PublicKey;
    whirlpoolPda: PublicKey;
    positionPda: PublicKey;
    positionMint: PublicKey;
    collectionMint: PublicKey;
    capgmMint: PublicKey;
    inputTokenAmount: anchor.BN;
    slippageTolerancePercent: number;
    tickSpacing: number;
    tickLowerIndex: number;
    tickUpperIndex: number;
  }): Promise<string> {
    const creator = this.walletManager.getPublicKey();

    const tx = await this.buildDepositLiquidityTransaction({
      creator,
      ...params,
    });

    return await this.walletManager.signTransaction(
      tx,
      RiskLevel.HIGH
    );
  }
}

