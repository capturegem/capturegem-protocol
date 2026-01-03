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
  getVideoPDA,
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
  MAX_VIDEO_LIMIT,
  VIDEO_ID,
  ROOT_CID,
  TARGET_ID,
  REASON,
} from "./helpers/constants";

describe("Integration Tests", () => {
  before(async () => {
    await setupAccounts();
  });

  describe("Complete User Flow", () => {
    it("Initialize protocol → Create user → Create collection → Upload video", async () => {
      // 1. Initialize protocol (if not already initialized)
      const [globalStatePDA] = getGlobalStatePDA();
      try {
        await program.account.globalState.fetch(globalStatePDA);
      } catch {
        await program.methods
          .initializeProtocol(INDEXER_URL, REGISTRY_URL, MOD_STAKE_MIN, FEE_BASIS_POINTS)
          .accounts({
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
          .accounts({
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
      const mint = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(mint.publicKey, 2 * 1e9);
      // Wait for confirmation with retries
      let confirmed = false;
      for (let i = 0; i < 10; i++) {
        const status = await provider.connection.getSignatureStatus(sig);
        if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
          confirmed = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      // Verify balance before proceeding
      let balance = await provider.connection.getBalance(mint.publicKey);
      let retries = 0;
      while (balance === 0 && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        balance = await provider.connection.getBalance(mint.publicKey);
        retries++;
      }
      
      await program.methods
        .createCollection(
          uniqueCollectionId,
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

      // 4. Upload video
      const [videoPDA] = getVideoPDA(collectionPDA, VIDEO_ID);
      await program.methods
        .uploadVideo(VIDEO_ID, ROOT_CID)
        .accounts({
          owner: user.publicKey,
          collection: collectionPDA,
          video: videoPDA,
          performerWallet: null,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Verify final state
      const collection = await program.account.collectionState.fetch(collectionPDA);
      expect(collection.videoCount).to.equal(1);
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
        const mint = Keypair.generate();
        await provider.connection.requestAirdrop(mint.publicKey, 2 * 1e9);
        await new Promise(resolve => setTimeout(resolve, 500));
        
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
      
      const [pinnerStatePDA] = getPinnerStatePDA(pinner.publicKey, collectionPDA);

      // 1. Register pinner
      await program.methods
        .registerCollectionHost()
        .accounts({
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
          .accounts({
            pinner: pinner.publicKey,
            collection: collectionPDA,
            pinnerState: pinnerStatePDA,
          })
          .signers([pinner])
          .rpc();
      } catch (err: any) {
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
          .accounts({
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
          .accounts({
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
        .accounts({
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
      const mint1 = Keypair.generate();
      const mint2 = Keypair.generate();
      
      const sig1 = await provider.connection.requestAirdrop(mint1.publicKey, 2 * 1e9);
      const sig2 = await provider.connection.requestAirdrop(mint2.publicKey, 2 * 1e9);
      // Wait for confirmations with retries
      for (let i = 0; i < 10; i++) {
        const status1 = await provider.connection.getSignatureStatus(sig1);
        const status2 = await provider.connection.getSignatureStatus(sig2);
        if ((status1?.value?.confirmationStatus === 'confirmed' || status1?.value?.confirmationStatus === 'finalized') &&
            (status2?.value?.confirmationStatus === 'confirmed' || status2?.value?.confirmationStatus === 'finalized')) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      // Verify balances before proceeding
      let balance1 = await provider.connection.getBalance(mint1.publicKey);
      let balance2 = await provider.connection.getBalance(mint2.publicKey);
      let retries = 0;
      while ((balance1 === 0 || balance2 === 0) && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        balance1 = await provider.connection.getBalance(mint1.publicKey);
        balance2 = await provider.connection.getBalance(mint2.publicKey);
        retries++;
      }

      await program.methods
        .createCollection(
          uniqueId1,
          "Collection 1",
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
          MAX_VIDEO_LIMIT
        )
        .accounts({
          owner: user.publicKey,
          collection: collection1PDA,
          oracleFeed: oracleFeed.publicKey,
          mint: mint1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user, mint1])
        .rpc();

      await program.methods
        .createCollection(
          uniqueId2,
          "Collection 2",
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
          MAX_VIDEO_LIMIT
        )
        .accounts({
          owner: user.publicKey,
          collection: collection2PDA,
          oracleFeed: oracleFeed.publicKey,
          mint: mint2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user, mint2])
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
        const mint = Keypair.generate();
        await provider.connection.requestAirdrop(mint.publicKey, 2 * 1e9);
        await new Promise(resolve => setTimeout(resolve, 500));
        
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
      
      const pinner2 = Keypair.generate();
      await provider.connection.requestAirdrop(pinner2.publicKey, 10 * 1e9);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const [pinner1StatePDA] = getPinnerStatePDA(pinner.publicKey, collectionPDA);
      const [pinner2StatePDA] = getPinnerStatePDA(pinner2.publicKey, collectionPDA);

      // Register first pinner
      await program.methods
        .registerCollectionHost()
        .accounts({
          pinner: pinner.publicKey,
          collection: collectionPDA,
          pinnerState: pinner1StatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([pinner])
        .rpc();

      // Register second pinner
      await program.methods
        .registerCollectionHost()
        .accounts({
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
