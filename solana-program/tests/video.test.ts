import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program,
  user,
  performer,
  setupAccounts,
  getCollectionPDA,
  getMintPDA,
  getVideoPDA,
  oracleFeed,
} from "./helpers/setup";
import {
  COLLECTION_ID,
  COLLECTION_NAME,
  CONTENT_CID,
  ACCESS_THRESHOLD_USD,
  VIDEO_ID,
  ROOT_CID,
  MAX_VIDEO_LIMIT,
} from "./helpers/constants";

describe("Video Upload", () => {
  let collectionPDA: any;

  before(async () => {
    await setupAccounts();
    
    // Ensure protocol and user account are initialized
    const { ensureProtocolInitialized, ensureUserAccountInitialized } = await import("./helpers/setup");
    await ensureProtocolInitialized();
    await ensureUserAccountInitialized(user);
    
    // Create a collection for testing
    const { COLLECTION_NAME, CONTENT_CID, ACCESS_THRESHOLD_USD } = await import("./helpers/constants");
    
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    const [mintPDA] = getMintPDA(collectionPDA);
    
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
    }
  });

  it("Successfully uploads video", async () => {
    const [videoPDA] = getVideoPDA(collectionPDA, VIDEO_ID);

    const tx = await program.methods
      .uploadVideo(VIDEO_ID, ROOT_CID)
      .accountsPartial({
        owner: user.publicKey,
        collection: collectionPDA,
        video: videoPDA,
        performerWallet: null,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([user])
      .rpc();

    const video = await program.account.videoState.fetch(videoPDA);
    expect(video.collection.toString()).to.equal(collectionPDA.toString());
    expect(video.videoId).to.equal(VIDEO_ID);
    expect(video.rootCid).to.equal(ROOT_CID);

    const collection = await program.account.collectionState.fetch(collectionPDA);
    expect(collection.videoCount).to.equal(1);
  });

  it("Fails if video_count >= max_video_limit", async () => {
    // Upload videos up to limit
    for (let i = 2; i <= MAX_VIDEO_LIMIT; i++) {
      const [videoPDA] = getVideoPDA(collectionPDA, `video-${i}`);
      await program.methods
        .uploadVideo(`video-${i}`, ROOT_CID)
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          video: videoPDA,
          performerWallet: null,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
    }

    // Try to upload one more
    const [videoPDA] = getVideoPDA(collectionPDA, "video-over-limit");
    try {
      await program.methods
        .uploadVideo("video-over-limit", ROOT_CID)
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          video: videoPDA,
          performerWallet: null,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: unknown) {
      expect(err.toString()).to.include("VideoLimitExceeded");
    }
  });

  it("Fails if video_id exceeds MAX_ID_LEN", async () => {
    const longVideoId = "a".repeat(33); // MAX_ID_LEN is 32
    const [videoPDA] = getVideoPDA(collectionPDA, longVideoId);

    try {
      await program.methods
        .uploadVideo(longVideoId, ROOT_CID)
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          video: videoPDA,
          performerWallet: null,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: unknown) {
      const errStr = err.toString();
      // The error might be "StringTooLong" or "Max seed length" if PDA derivation fails
      const hasExpectedError = errStr.includes("StringTooLong") || 
                               errStr.includes("Max seed length") ||
                               errStr.includes("String length exceeds") ||
                               errStr.includes("seed") ||
                               errStr.includes("too long");
      if (!hasExpectedError) {
        console.log("Unexpected error:", errStr);
      }
      expect(hasExpectedError).to.be.true;
    }
  });

  it("Fails if root_cid exceeds MAX_URL_LEN", async () => {
    const longCid = "a".repeat(201); // MAX_URL_LEN is 200
    const [videoPDA] = getVideoPDA(collectionPDA, "video-invalid-cid");

    try {
      await program.methods
        .uploadVideo("video-invalid-cid", longCid)
        .accountsPartial({
          owner: user.publicKey,
          collection: collectionPDA,
          video: videoPDA,
          performerWallet: null,
          systemProgram: SystemProgram.programId,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .signers([user])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: unknown) {
      expect(err.toString()).to.include("StringTooLong");
    }
  });

  it("Successfully uploads video with performer wallet", async () => {
    // Use a fresh collection to avoid video limit issues
    const freshCollectionId = "test-collection-performer";
    const [freshCollectionPDA] = getCollectionPDA(user.publicKey, freshCollectionId);
    const [freshMintPDA] = getMintPDA(freshCollectionPDA);
    
    // Create the collection if it doesn't exist
    try {
      await program.account.collectionState.fetch(freshCollectionPDA);
    } catch {
      await program.methods
        .createCollection(
          freshCollectionId,
          COLLECTION_NAME,
          CONTENT_CID,
          ACCESS_THRESHOLD_USD,
          MAX_VIDEO_LIMIT
        )
        .accountsPartial({
          owner: user.publicKey,
          collection: freshCollectionPDA,
          oracleFeed: oracleFeed.publicKey,
          mint: freshMintPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
    }
    
    const [videoPDA] = getVideoPDA(freshCollectionPDA, "video-with-performer");

    const tx = await program.methods
      .uploadVideo("video-with-performer", ROOT_CID)
      .accountsPartial({
        owner: user.publicKey,
        collection: freshCollectionPDA,
        video: videoPDA,
        performerWallet: performer.publicKey,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([user])
      .rpc();

    const video = await program.account.videoState.fetch(videoPDA);
    expect(video.performerWallet?.toString()).to.equal(performer.publicKey.toString());
  });
});
