import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program,
  admin,
  user,
  pinner,
  performer,
  moderator,
  treasury,
  capgmMint,
  oracleFeed,
  setupAccounts,
  getGlobalStatePDA,
  getUserAccountPDA,
  getCollectionPDA,
  getMintPDA,
  getPinnerStatePDA,
  getModTicketPDA,
  getModeratorStakePDA,
  provider,
} from "./helpers/setup";
import {
  INDEXER_URL,
  REGISTRY_URL,
  MOD_STAKE_MIN,
  FEE_BASIS_POINTS,
  IPNS_KEY,
  COLLECTION_ID,
  COLLECTION_NAME,
  CONTENT_CID,
  ACCESS_THRESHOLD_USD,
  TARGET_ID,
  REASON,
} from "./helpers/constants";

describe("Integration Tests", () => {
  before(async () => {
    await setupAccounts();
  });

  describe("Complete User Flow", () => {
    it("Initialize protocol → Create user → Create collection", async () => {
      // 1. Initialize protocol (if not already initialized)
      const [globalStatePDA] = getGlobalStatePDA();
      try {
        await program.account.globalState.fetch(globalStatePDA);
      } catch {
        await program.methods
          .initializeProtocol(INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS)
          .accountsPartial({
            admin: admin.publicKey,
            globalState: globalStatePDA,
            treasury: treasury.publicKey,
            capgmMint: capgmMint.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
      }

      // 2. Initialize user account (if not already initialized)
      const [userAccountPDA] = getUserAccountPDA(user.publicKey);
      try {
        await program.account.userAccount.fetch(userAccountPDA);
      } catch {
        await program.methods
          .initializeUserAccount(IPNS_KEY)
          .accountsPartial({
            authority: user.publicKey,
            userAccount: userAccountPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
      }

      // 3. Create collection (use unique ID to avoid conflicts)
      const uniqueCollectionId = `collection-${Date.now()}`;
      const [collectionPDA] = getCollectionPDA(user.publicKey, uniqueCollectionId);
      const [mintPDA] = getMintPDA(collectionPDA);
      
      const poolAddress = Keypair.generate().publicKey;
      const claimVault = Keypair.generate().publicKey;

      await program.methods
        .createCollection(
          uniqueCollectionId,
          COLLECTION_NAME,
          CONTENT_CID,
          ACCESS_THRESHOLD_USD
        )
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          oracleFeed: oracleFeed.publicKey,
          poolAddress: poolAddress,
          claimVault: claimVault,
          mint: mintPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Verify final state
      const collection = await program.account.collectionState.fetch(collectionPDA);
      expect(collection.collectionId).to.equal(uniqueCollectionId);
    });
  });

  describe("Complete Pinner Flow", () => {
    it("Register → Submit audit → Claim rewards", async () => {
      // Ensure prerequisites exist
      const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
      await ensureProtocolInitialized();
      await ensureUserAccountInitialized(user);
      
      // Create collection if it doesn't exist
      const [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
      try {
        await program.account.collectionState.fetch(collectionPDA);
      } catch {
        const [mintPDA] = getMintPDA(collectionPDA);
        const poolAddress = Keypair.generate().publicKey;
        const claimVault = Keypair.generate().publicKey;
        
        await program.methods
          .createCollection(
            COLLECTION_ID,
            COLLECTION_NAME,
            CONTENT_CID,
            ACCESS_THRESHOLD_USD
          )
          .accountsPartial({
            owner: user.publicKey,
            collection: collectionPDA,
            oracleFeed: oracleFeed.publicKey,
            poolAddress: poolAddress,
            claimVault: claimVault,
            mint: mintPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([user])
          .rpc();
      }
      
      const [pinnerStatePDA] = getPinnerStatePDA(pinner.publicKey, collectionPDA);

      // 1. Register pinner
      await program.methods
        .registerCollectionHost()
        .accountsPartial({
          pinner: pinner.publicKey,
          collection: collectionPDA,
          pinnerState: pinnerStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([pinner])
        .rpc();

      // 2. Submit successful audit
      const authority = Keypair.generate();
      await provider.connection.requestAirdrop(authority.publicKey, 2 * 1e9);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await program.methods
        .submitAuditResult(true)
        .accounts({
          authority: authority.publicKey,
          pinnerState: pinnerStatePDA,
        })
        .signers([authority])
        .rpc();

      // 3. Try to claim rewards (will fail if no rewards, but flow is correct)
      try {
        await program.methods
          .claimRewards()
          .accountsPartial({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
          })
          .signers([pinner])
          .rpc();
      } catch (err: unknown) {
        // Expected if no rewards in pool
        expect(err.toString()).to.include("InsufficientFunds");
      }
    });
  });

  describe("Complete Moderation Flow", () => {
    it("Create ticket → Stake moderator → Resolve ticket", async () => {
      // Ensure protocol is initialized
      const { ensureProtocolInitialized } = await import("./helpers/setup");
      await ensureProtocolInitialized();
      
      const [globalStatePDA] = getGlobalStatePDA();
      // Use unique target ID to avoid conflicts
      const uniqueTargetId = `target-${Date.now()}`;
      const [ticketPDA] = getModTicketPDA(uniqueTargetId);
      const [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);

      // 1. Create ticket
      try {
        await program.account.modTicket.fetch(ticketPDA);
      } catch {
        await program.methods
          .createTicket(uniqueTargetId, { contentReport: {} }, REASON)
          .accountsPartial({
            reporter: user.publicKey,
            ticket: ticketPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
      }

      // 2. Stake moderator (if not already staked)
      try {
        await program.account.moderatorStake.fetch(moderatorStakePDA);
      } catch {
        const moderatorTokenAccount = Keypair.generate().publicKey;
        await program.methods
          .stakeModerator(MOD_STAKE_MIN)
          .accountsPartial({
            moderator: moderator.publicKey,
            globalState: globalStatePDA,
            moderatorTokenAccount: moderatorTokenAccount,
            moderatorStake: moderatorStakePDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([moderator])
          .rpc();
      }

      // 3. Resolve ticket
      await program.methods
        .resolveTicket(true)
        .accountsPartial({
          moderator: moderator.publicKey,
          globalState: globalStatePDA,
          moderatorStake: moderatorStakePDA,
          ticket: ticketPDA,
        })
        .signers([moderator])
        .rpc();

      const ticket = await program.account.modTicket.fetch(ticketPDA);
      expect(ticket.resolved).to.be.true;
      expect(ticket.verdict).to.be.true;
    });
  });

  describe("Edge Cases", () => {
    it("Multiple collections per owner", async () => {
      // Ensure prerequisites
      const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
      await ensureProtocolInitialized();
      await ensureUserAccountInitialized(user);
      
      // Use unique collection IDs to avoid conflicts
      const uniqueId1 = `collection-1-${Date.now()}`;
      const uniqueId2 = `collection-2-${Date.now()}`;
      const [collection1PDA] = getCollectionPDA(user.publicKey, uniqueId1);
      const [collection2PDA] = getCollectionPDA(user.publicKey, uniqueId2);
      const [mint1PDA] = getMintPDA(collection1PDA);
      const [mint2PDA] = getMintPDA(collection2PDA);

      const poolAddress1 = Keypair.generate().publicKey;
      const claimVault1 = Keypair.generate().publicKey;
      const poolAddress2 = Keypair.generate().publicKey;
      const claimVault2 = Keypair.generate().publicKey;

      await program.methods
        .createCollection(
          uniqueId1,
          "Collection 1",
          CONTENT_CID,
          ACCESS_THRESHOLD_USD
        )
        .accountsPartial({
          owner: user.publicKey,
          collection: collection1PDA,
          oracleFeed: oracleFeed.publicKey,
          poolAddress: poolAddress1,
          claimVault: claimVault1,
          mint: mint1PDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      await program.methods
        .createCollection(
          uniqueId2,
          "Collection 2",
          CONTENT_CID,
          ACCESS_THRESHOLD_USD
        )
        .accountsPartial({
          owner: user.publicKey,
          collection: collection2PDA,
          oracleFeed: oracleFeed.publicKey,
          poolAddress: poolAddress2,
          claimVault: claimVault2,
          mint: mint2PDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      const collection1 = await program.account.collectionState.fetch(collection1PDA);
      const collection2 = await program.account.collectionState.fetch(collection2PDA);
      expect(collection1.collectionId).to.equal(uniqueId1);
      expect(collection2.collectionId).to.equal(uniqueId2);
    });

    it("Multiple pinners per collection", async () => {
      // Ensure prerequisites
      const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
      await ensureProtocolInitialized();
      await ensureUserAccountInitialized(user);
      
      // Create collection if it doesn't exist
      const [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
      try {
        await program.account.collectionState.fetch(collectionPDA);
      } catch {
        const [mintPDA] = getMintPDA(collectionPDA);
        const poolAddress = Keypair.generate().publicKey;
        const claimVault = Keypair.generate().publicKey;
        
        await program.methods
          .createCollection(
            COLLECTION_ID,
            COLLECTION_NAME,
            CONTENT_CID,
            ACCESS_THRESHOLD_USD
          )
          .accountsPartial({
            owner: user.publicKey,
            collection: collectionPDA,
            oracleFeed: oracleFeed.publicKey,
            poolAddress: poolAddress,
            claimVault: claimVault,
            mint: mintPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([user])
          .rpc();
      }
      
      const pinner2 = Keypair.generate();
      await provider.connection.requestAirdrop(pinner2.publicKey, 10 * 1e9);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const [pinner1StatePDA] = getPinnerStatePDA(pinner.publicKey, collectionPDA);
      const [pinner2StatePDA] = getPinnerStatePDA(pinner2.publicKey, collectionPDA);

      // Register first pinner (check if already registered)
      try {
        await program.account.pinnerState.fetch(pinner1StatePDA);
        // Already registered, skip
      } catch {
        // Not registered, proceed with registration
        await program.methods
          .registerCollectionHost()
          .accountsPartial({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinner1StatePDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([pinner])
          .rpc();
      }

      // Register second pinner
      await program.methods
        .registerCollectionHost()
        .accountsPartial({
          pinner: pinner2.publicKey,
          collection: collectionPDA,
          pinnerState: pinner2StatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([pinner2])
        .rpc();

      const collection = await program.account.collectionState.fetch(collectionPDA);
      expect(collection.totalShares.toString()).to.equal("2");
    });
  });
});
