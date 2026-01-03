import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  program,
  user,
  oracleFeed,
  setupAccounts,
  getCollectionPDA,
  getMintPDA,
  getAccessEscrowPDA,
  provider,
} from "./helpers/setup";
import { COLLECTION_ID, COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD } from "./helpers/constants";

describe("Access Escrow", () => {
  let collectionPDA: PublicKey;
  let mint: PublicKey;
  let purchaser: Keypair;

  before(async () => {
    await setupAccounts();
    
    // Ensure protocol and user account are initialized
    const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
    await ensureProtocolInitialized();
    await ensureUserAccountInitialized(user);
    
    // Create a collection for testing
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    const [mintPDA] = getMintPDA(collectionPDA);
    
    // Check if collection exists, if not create it
    try {
      await program.account.collectionState.fetch(collectionPDA);
      // Get the actual mint from the collection
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
          poolAddress: Keypair.generate().publicKey, // Mock pool address
          claimVault: Keypair.generate().publicKey, // Mock claim vault
          mint: mintPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
      
      mint = mintPDA;
    }

    // Create a purchaser for testing
    purchaser = Keypair.generate();
    await provider.connection.requestAirdrop(purchaser.publicKey, 10 * 1e9);
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  describe("Create Access Escrow", () => {
    it("Fails if amount_locked is 0", async () => {
      const [accessEscrowPDA] = getAccessEscrowPDA(purchaser.publicKey, collectionPDA);
      const purchaserTokenAccount = await getAssociatedTokenAddress(mint, purchaser.publicKey);
      const escrowTokenAccount = Keypair.generate().publicKey; // Mock escrow token account

      try {
        await program.methods
          .createAccessEscrow(new (await import("@coral-xyz/anchor")).BN(0))
          .accountsPartial({
            purchaser: purchaser.publicKey,
            collection: collectionPDA,
            purchaserTokenAccount: purchaserTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            accessEscrow: accessEscrowPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([purchaser])
          .rpc();
        expect.fail("Should have failed - amount is 0");
      } catch (err: unknown) {
        const errStr = err.toString();
        expect(errStr.includes("InsufficientFunds")).to.be.true;
      }
    });

    it("Fails if collection doesn't exist", async () => {
      const fakeCollection = Keypair.generate().publicKey;
      const [accessEscrowPDA] = getAccessEscrowPDA(purchaser.publicKey, fakeCollection);
      const purchaserTokenAccount = await getAssociatedTokenAddress(mint, purchaser.publicKey);
      const escrowTokenAccount = Keypair.generate().publicKey;

      try {
        await program.methods
          .createAccessEscrow(new (await import("@coral-xyz/anchor")).BN(1000))
          .accountsPartial({
            purchaser: purchaser.publicKey,
            collection: fakeCollection,
            purchaserTokenAccount: purchaserTokenAccount,
            escrowTokenAccount: escrowTokenAccount,
            accessEscrow: accessEscrowPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([purchaser])
          .rpc();
        expect.fail("Should have failed - collection doesn't exist");
      } catch (err: unknown) {
        // Should fail because collection doesn't exist
        expect(err.toString()).to.include("AccountNotInitialized");
      }
    });
  });

  describe("Release Escrow", () => {
    it("Fails if access escrow doesn't exist", async () => {
      const fakePurchaser = Keypair.generate();
      const [accessEscrowPDA] = getAccessEscrowPDA(fakePurchaser.publicKey, collectionPDA);
      const escrowTokenAccount = Keypair.generate().publicKey;

      try {
        await program.methods
          .releaseEscrow(
            [Keypair.generate().publicKey],
            [new (await import("@coral-xyz/anchor")).BN(100)]
          )
          .accountsPartial({
            purchaser: fakePurchaser.publicKey,
            collection: collectionPDA,
            accessEscrow: accessEscrowPDA,
            escrowTokenAccount: escrowTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([fakePurchaser])
          .rpc();
        expect.fail("Should have failed - escrow doesn't exist");
      } catch (err: unknown) {
        expect(err.toString()).to.include("AccountNotInitialized");
      }
    });

    it("Fails if peer_wallets and peer_weights length mismatch", async () => {
      const [accessEscrowPDA] = getAccessEscrowPDA(purchaser.publicKey, collectionPDA);
      const escrowTokenAccount = Keypair.generate().publicKey;

      try {
        await program.methods
          .releaseEscrow(
            [Keypair.generate().publicKey, Keypair.generate().publicKey],
            [new (await import("@coral-xyz/anchor")).BN(100)]
          )
          .accountsPartial({
            purchaser: purchaser.publicKey,
            collection: collectionPDA,
            accessEscrow: accessEscrowPDA,
            escrowTokenAccount: escrowTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([purchaser])
          .rpc();
        expect.fail("Should have failed - length mismatch");
      } catch (err: unknown) {
        const errStr = err.toString();
        expect(errStr.includes("InvalidFeeConfig") || errStr.includes("constraint")).to.be.true;
      }
    });

    it("Fails if peer_wallets is empty", async () => {
      const [accessEscrowPDA] = getAccessEscrowPDA(purchaser.publicKey, collectionPDA);
      const escrowTokenAccount = Keypair.generate().publicKey;

      try {
        await program.methods
          .releaseEscrow(
            [],
            []
          )
          .accountsPartial({
            purchaser: purchaser.publicKey,
            collection: collectionPDA,
            accessEscrow: accessEscrowPDA,
            escrowTokenAccount: escrowTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
          })
          .signers([purchaser])
          .rpc();
        expect.fail("Should have failed - empty peer list");
      } catch (err: unknown) {
        const errStr = err.toString();
        expect(errStr.includes("InvalidFeeConfig") || errStr.includes("constraint")).to.be.true;
      }
    });
  });
});
