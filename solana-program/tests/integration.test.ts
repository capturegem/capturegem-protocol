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
      // 1. Initialize protocol
      const [globalStatePDA] = getGlobalStatePDA();
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

      // 2. Initialize user account
      const [userAccountPDA] = getUserAccountPDA(user.publicKey);
      await program.methods
        .initializeUserAccount(IPNS_KEY)
        .accounts({
          authority: user.publicKey,
          userAccount: userAccountPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // 3. Create collection
      const [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
      const mint = Keypair.generate();
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
      const [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
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
      const [globalStatePDA] = getGlobalStatePDA();
      const [ticketPDA] = getModTicketPDA(TARGET_ID);
      const [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);

      // 1. Create ticket
      await program.methods
        .createTicket(TARGET_ID, { contentReport: {} }, REASON)
        .accounts({
          reporter: user.publicKey,
          ticket: ticketPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // 2. Stake moderator
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
      const [collection1PDA] = getCollectionPDA(user.publicKey, "collection-1");
      const [collection2PDA] = getCollectionPDA(user.publicKey, "collection-2");
      const mint1 = Keypair.generate();
      const mint2 = Keypair.generate();

      await program.methods
        .createCollection(
          "collection-1",
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
          "collection-2",
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
      expect(collection1.collectionId).to.equal("collection-1");
      expect(collection2.collectionId).to.equal("collection-2");
    });

    it("Multiple pinners per collection", async () => {
      const [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
      const pinner2 = Keypair.generate();
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
