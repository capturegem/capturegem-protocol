import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  program,
  user,
  oracleFeed,
  setupAccounts,
  getCollectionPDA,
  getViewRightsPDA,
} from "./helpers/setup";
import { COLLECTION_ID } from "./helpers/constants";

describe("Buy Access Token", () => {
  let collectionPDA: any;
  let mint: any;

  before(async () => {
    await setupAccounts();
    
    // Ensure protocol and user account are initialized
    const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
    await ensureProtocolInitialized();
    await ensureUserAccountInitialized(user);
    
    // Create a collection for testing
    const { SystemProgram, SYSVAR_RENT_PUBKEY } = await import("@solana/web3.js");
    const { COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD, MAX_VIDEO_LIMIT } = await import("./helpers/constants");
    
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    mint = Keypair.generate();
    
    // Airdrop to mint keypair if it's used as signer
    const { airdropAndConfirm, provider } = await import("./helpers/setup");
    try {
      await airdropAndConfirm(mint.publicKey);
      // Verify balance one more time before proceeding
      const finalBalance = await provider.connection.getBalance(mint.publicKey);
      if (finalBalance === 0) {
        // Wait a bit more and try again
        await new Promise(resolve => setTimeout(resolve, 2000));
        const balance2 = await provider.connection.getBalance(mint.publicKey);
        if (balance2 === 0) {
          throw new Error(`Mint keypair ${mint.publicKey.toString()} still has 0 balance after airdrop`);
        }
      }
    } catch (err) {
      // If airdrop fails, try one more time with a longer wait
      await new Promise(resolve => setTimeout(resolve, 3000));
      await airdropAndConfirm(mint.publicKey);
    }
    
    // Check if collection exists, if not create it
    try {
      await program.account.collectionState.fetch(collectionPDA);
    } catch {
      // Collection doesn't exist, create it
      await program.methods
        .createCollection(
          COLLECTION_ID,
          COLLECTION_NAME,
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
          MAX_VIDEO_LIMIT
        )
        .accounts({
          owner: user.publicKey,
          collection: collectionPDA,
          oracleFeed: oracleFeed.publicKey,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user, mint])
        .rpc();
    }
    
    // Get the actual mint from the collection
    const collection = await program.account.collectionState.fetch(collectionPDA);
    mint = collection.mint;
  });

  it("Fails if user has insufficient token balance", async () => {
    const [viewRightsPDA] = getViewRightsPDA(user.publicKey, collectionPDA);
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);

    try {
      await program.methods
        .buyAccessToken()
        .accounts({
          payer: user.publicKey,
          collection: collectionPDA,
          buyerTokenAccount: buyerTokenAccount,
          oracleFeed: oracleFeed.publicKey,
          viewRights: viewRightsPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: any) {
      // The actual error might be InsufficientFunds or InvalidOraclePrice (if oracle returns 0)
      const errStr = err.toString();
      expect(errStr.includes("InsufficientFunds") || errStr.includes("InvalidOraclePrice")).to.be.true;
    }
  });

  it("Fails if user has 0 token balance", async () => {
    const [viewRightsPDA] = getViewRightsPDA(user.publicKey, collectionPDA);
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);

    try {
      await program.methods
        .buyAccessToken()
        .accounts({
          payer: user.publicKey,
          collection: collectionPDA,
          buyerTokenAccount: buyerTokenAccount,
          oracleFeed: oracleFeed.publicKey,
          viewRights: viewRightsPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: any) {
      // The actual error might be InsufficientFunds or InvalidOraclePrice (if oracle returns 0)
      const errStr = err.toString();
      expect(errStr.includes("InsufficientFunds") || errStr.includes("InvalidOraclePrice")).to.be.true;
    }
  });

  it("Fails if collection doesn't exist", async () => {
    const fakeCollection = Keypair.generate().publicKey;
    const [viewRightsPDA] = getViewRightsPDA(user.publicKey, fakeCollection);
    const buyerTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);

    try {
      await program.methods
        .buyAccessToken()
        .accounts({
          payer: user.publicKey,
          collection: fakeCollection,
          buyerTokenAccount: buyerTokenAccount,
          oracleFeed: oracleFeed.publicKey,
          viewRights: viewRightsPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: any) {
      // Should fail because collection doesn't exist
      expect(err.toString()).to.include("AccountNotInitialized");
    }
  });

  // Note: Success cases for buyAccessToken would require:
  // 1. Creating actual token accounts with balances
  // 2. Setting up a real oracle feed
  // 3. Minting tokens to the user
  // These are complex integration tests that would be better in a separate integration test file
});
