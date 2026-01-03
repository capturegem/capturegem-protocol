import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, PublicKey } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import {
  program,
  user,
  oracleFeed,
  setupAccounts,
  getCollectionPDA,
  getMintPDA,
  provider,
} from "./helpers/setup";
import {
  COLLECTION_ID,
  COLLECTION_NAME,
  CONTENT_CID,
  ACCESS_THRESHOLD_USD,
} from "./helpers/constants";

describe("Mint Collection Tokens", () => {
  let collectionPDA: PublicKey;
  let mint: PublicKey;
  let creatorTokenAccount: PublicKey;
  let orcaPoolTokenAccount: PublicKey;
  let orcaProgram: PublicKey;

  before(async () => {
    await setupAccounts();
    
    // Ensure protocol and user account are initialized
    const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
    await ensureProtocolInitialized();
    await ensureUserAccountInitialized(user);
    
    // Create a collection for testing
    const { SystemProgram } = await import("@solana/web3.js");
    
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    const [mintPDA] = getMintPDA(collectionPDA);
    
    // Check if collection exists, if not create it
    try {
      await program.account.collectionState.fetch(collectionPDA);
      const collection = await program.account.collectionState.fetch(collectionPDA);
      mint = collection.mint;
    } catch {
      // Collection doesn't exist, create it
      await program.methods
        .createCollection(
          COLLECTION_ID,
          COLLECTION_NAME,
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
        )
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          oracleFeed: oracleFeed.publicKey,
          mint: mintPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
      
      mint = mintPDA;
    }

    // Get or create creator's token account
    creatorTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);
    
    // Create creator's token account if it doesn't exist
    try {
      await getAccount(provider.connection, creatorTokenAccount);
    } catch {
      const createATAInstruction = createAssociatedTokenAccountInstruction(
        user.publicKey,
        creatorTokenAccount,
        user.publicKey,
        mint
      );
      const tx = await provider.sendAndConfirm(
        new (await import("@solana/web3.js")).Transaction().add(createATAInstruction),
        [user]
      );
    }

    // Create a mock Orca pool token account
    // For testing, we'll use an associated token account owned by a test keypair
    const orcaPoolOwner = Keypair.generate();
    await provider.connection.requestAirdrop(orcaPoolOwner.publicKey, 10 * 1e9);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    orcaPoolTokenAccount = await getAssociatedTokenAddress(mint, orcaPoolOwner.publicKey);
    
    // Create the Orca pool token account if it doesn't exist
    try {
      await getAccount(provider.connection, orcaPoolTokenAccount);
    } catch {
      const createOrcaATAInstruction = createAssociatedTokenAccountInstruction(
        orcaPoolOwner.publicKey,
        orcaPoolTokenAccount,
        orcaPoolOwner.publicKey,
        mint
      );
      const tx = await provider.sendAndConfirm(
        new (await import("@solana/web3.js")).Transaction().add(createOrcaATAInstruction),
        [orcaPoolOwner]
      );
    }
    
    // For testing, we'll use a dummy Orca program ID
    // In production, this would be the actual Orca Whirlpool or StableSwap program ID
    orcaProgram = Keypair.generate().publicKey;
  });

  it("Successfully mints collection tokens with correct distribution", async () => {
    const mintAmount = new (await import("@coral-xyz/anchor")).BN(1_000_000_000); // 1000 tokens (6 decimals)
    const expectedCreatorAmount = mintAmount.toNumber() * 0.1; // 10%
    const expectedOrcaAmount = mintAmount.toNumber() * 0.9; // 90%

    // Get initial balances
    let creatorBalance = 0;
    let orcaBalance = 0;
    try {
      const account = await getAccount(provider.connection, creatorTokenAccount);
      creatorBalance = Number(account.amount);
    } catch {
      creatorBalance = 0;
    }
    try {
      const account = await getAccount(provider.connection, orcaPoolTokenAccount);
      orcaBalance = Number(account.amount);
    } catch {
      orcaBalance = 0;
    }

    // Get initial mint supply
    const mintInfoBefore = await getMint(provider.connection, mint);
    const supplyBefore = Number(mintInfoBefore.supply);

    // Execute mint instruction
    await program.methods
      .mintCollectionTokens(mintAmount)
      .accountsPartial({
        creator: user.publicKey,
        collection: collectionPDA,
        mint: mint,
        creatorTokenAccount: creatorTokenAccount,
        orcaLiquidityPool: orcaPoolTokenAccount,
        orcaProgram: orcaProgram,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify creator received 10% (with small tolerance for rounding)
    const creatorAccount = await getAccount(provider.connection, creatorTokenAccount);
    const newCreatorBalance = Number(creatorAccount.amount);
    const creatorReceived = newCreatorBalance - creatorBalance;
    
    // Allow for rounding differences (should be within 1 token)
    expect(creatorReceived).to.be.at.least(expectedCreatorAmount - 1_000_000);
    expect(creatorReceived).to.be.at.most(expectedCreatorAmount + 1_000_000);

    // Verify Orca pool received 90% (with small tolerance for rounding)
    const orcaAccount = await getAccount(provider.connection, orcaPoolTokenAccount);
    const newOrcaBalance = Number(orcaAccount.amount);
    const orcaReceived = newOrcaBalance - orcaBalance;
    
    // Allow for rounding differences
    expect(orcaReceived).to.be.at.least(expectedOrcaAmount - 1_000_000);
    expect(orcaReceived).to.be.at.most(expectedOrcaAmount + 1_000_000);

    // Verify the sum equals the total minted amount (accounting for rounding)
    const totalDistributed = creatorReceived + orcaReceived;
    expect(totalDistributed).to.equal(mintAmount.toNumber());

    // Verify mint supply increased by the full amount
    const mintInfoAfter = await getMint(provider.connection, mint);
    const supplyAfter = Number(mintInfoAfter.supply);
    expect(supplyAfter - supplyBefore).to.equal(mintAmount.toNumber());
  });

  it("Fails if called by non-owner", async () => {
    const unauthorizedUser = Keypair.generate();
    await provider.connection.requestAirdrop(unauthorizedUser.publicKey, 10 * 1e9);
    await new Promise(resolve => setTimeout(resolve, 500));

    const mintAmount = new (await import("@coral-xyz/anchor")).BN(1_000_000_000);

    try {
      await program.methods
        .mintCollectionTokens(mintAmount)
        .accountsPartial({
          creator: unauthorizedUser.publicKey,
          collection: collectionPDA,
          mint: mint,
          creatorTokenAccount: creatorTokenAccount,
          orcaLiquidityPool: orcaPoolTokenAccount,
          orcaProgram: orcaProgram,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorizedUser])
        .rpc();
      expect.fail("Should have failed - unauthorized user");
    } catch (err: unknown) {
      const errStr = err.toString();
      expect(errStr.includes("Unauthorized") || errStr.includes("constraint")).to.be.true;
    }
  });

  it("Fails if amount is 0", async () => {
    const mintAmount = new (await import("@coral-xyz/anchor")).BN(0);

    try {
      await program.methods
        .mintCollectionTokens(mintAmount)
        .accountsPartial({
          creator: user.publicKey,
          collection: collectionPDA,
          mint: mint,
          creatorTokenAccount: creatorTokenAccount,
          orcaLiquidityPool: orcaPoolTokenAccount,
          orcaProgram: orcaProgram,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed - amount is 0");
    } catch (err: unknown) {
      const errStr = err.toString();
      expect(errStr.includes("InvalidFeeConfig") || errStr.includes("amount")).to.be.true;
    }
  });

  it("Fails if collection doesn't exist", async () => {
    const fakeCollection = Keypair.generate().publicKey;
    const [fakeMintPDA] = getMintPDA(fakeCollection);
    const mintAmount = new (await import("@coral-xyz/anchor")).BN(1_000_000_000);

    try {
      await program.methods
        .mintCollectionTokens(mintAmount)
        .accountsPartial({
          creator: user.publicKey,
          collection: fakeCollection,
          mint: fakeMintPDA,
          creatorTokenAccount: creatorTokenAccount,
          orcaLiquidityPool: orcaPoolTokenAccount,
          orcaProgram: orcaProgram,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed - collection doesn't exist");
    } catch (err: unknown) {
      const errStr = err.toString();
      expect(
        errStr.includes("AccountNotInitialized") || 
        errStr.includes("constraint") ||
        errStr.includes("Unauthorized")
      ).to.be.true;
    }
  });

  it("Fails if mint doesn't match collection's mint", async () => {
    const fakeMint = Keypair.generate().publicKey;
    const mintAmount = new (await import("@coral-xyz/anchor")).BN(1_000_000_000);

    try {
      await program.methods
        .mintCollectionTokens(mintAmount)
        .accountsPartial({
          creator: user.publicKey,
          collection: collectionPDA,
          mint: fakeMint,
          creatorTokenAccount: creatorTokenAccount,
          orcaLiquidityPool: orcaPoolTokenAccount,
          orcaProgram: orcaProgram,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed - mint doesn't match");
    } catch (err: unknown) {
      const errStr = err.toString();
      expect(errStr.includes("Unauthorized") || errStr.includes("constraint")).to.be.true;
    }
  });

  it("Handles rounding correctly for odd amounts", async () => {
    // Test with an amount that doesn't divide evenly by 100
    const mintAmount = new (await import("@coral-xyz/anchor")).BN(1_000_000_003); // 1000.000003 tokens
    
    // Get initial balances
    let creatorBalance = 0;
    try {
      const account = await getAccount(provider.connection, creatorTokenAccount);
      creatorBalance = Number(account.amount);
    } catch {
      creatorBalance = 0;
    }

    const mintInfoBefore = await getMint(provider.connection, mint);
    const supplyBefore = Number(mintInfoBefore.supply);

    // Execute mint instruction
    await program.methods
      .mintCollectionTokens(mintAmount)
      .accountsPartial({
        creator: user.publicKey,
        collection: collectionPDA,
        mint: mint,
        creatorTokenAccount: creatorTokenAccount,
        orcaLiquidityPool: orcaPoolTokenAccount,
        orcaProgram: orcaProgram,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify total supply increased by exact amount
    const mintInfoAfter = await getMint(provider.connection, mint);
    const supplyAfter = Number(mintInfoAfter.supply);
    expect(supplyAfter - supplyBefore).to.equal(mintAmount.toNumber());

    // Verify creator received approximately 10% (with remainder handling)
    const creatorAccount = await getAccount(provider.connection, creatorTokenAccount);
    const newCreatorBalance = Number(creatorAccount.amount);
    const creatorReceived = newCreatorBalance - creatorBalance;
    
    // Creator should get 10% + any rounding remainder
    // For 1000000003, 10% = 100000000.3, which rounds to 100000000
    // Remainder = 3, so creator gets 100000003 total
    const expectedCreatorMin = 100_000_000; // 10% rounded down
    const expectedCreatorMax = 100_000_003; // 10% + remainder
    
    expect(creatorReceived).to.be.at.least(expectedCreatorMin);
    expect(creatorReceived).to.be.at.most(expectedCreatorMax);
  });

  it("Can mint multiple times and accumulates correctly", async () => {
    const firstMintAmount = new (await import("@coral-xyz/anchor")).BN(500_000_000); // 500 tokens
    const secondMintAmount = new (await import("@coral-xyz/anchor")).BN(300_000_000); // 300 tokens

    // Get initial balances
    let creatorBalance = 0;
    try {
      const account = await getAccount(provider.connection, creatorTokenAccount);
      creatorBalance = Number(account.amount);
    } catch {
      creatorBalance = 0;
    }

    const mintInfoBefore = await getMint(provider.connection, mint);
    const supplyBefore = Number(mintInfoBefore.supply);

    // First mint
    await program.methods
      .mintCollectionTokens(firstMintAmount)
      .accountsPartial({
        creator: user.publicKey,
        collection: collectionPDA,
        mint: mint,
        creatorTokenAccount: creatorTokenAccount,
        orcaLiquidityPool: orcaPoolTokenAccount,
        orcaProgram: orcaProgram,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Second mint
    await program.methods
      .mintCollectionTokens(secondMintAmount)
      .accountsPartial({
        creator: user.publicKey,
        collection: collectionPDA,
        mint: mint,
        creatorTokenAccount: creatorTokenAccount,
        orcaLiquidityPool: orcaPoolTokenAccount,
        orcaProgram: orcaProgram,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify total supply increased by both amounts
    const mintInfoAfter = await getMint(provider.connection, mint);
    const supplyAfter = Number(mintInfoAfter.supply);
    const totalMinted = firstMintAmount.toNumber() + secondMintAmount.toNumber();
    expect(supplyAfter - supplyBefore).to.equal(totalMinted);

    // Verify creator received approximately 10% of total
    const creatorAccount = await getAccount(provider.connection, creatorTokenAccount);
    const newCreatorBalance = Number(creatorAccount.amount);
    const creatorReceived = newCreatorBalance - creatorBalance;
    const expectedCreatorTotal = totalMinted * 0.1;
    
    // Allow for rounding differences
    expect(creatorReceived).to.be.at.least(expectedCreatorTotal - 1_000_000);
    expect(creatorReceived).to.be.at.most(expectedCreatorTotal + 1_000_000);
  });
});
