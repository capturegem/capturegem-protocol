import { expect } from "chai";
import { Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  program,
  user,
  performer,
  setupAccounts,
  getCollectionPDA,
  getVideoPDA,
  oracleFeed,
} from "./helpers/setup";
import {
  COLLECTION_ID,
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
    const mint = Keypair.generate();
    
    // Airdrop to mint keypair if it's used as signer
    const { provider } = await import("./helpers/setup");
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
  });

  it("Successfully uploads video", async () => {
    const [videoPDA] = getVideoPDA(collectionPDA, VIDEO_ID);

    const tx = await program.methods
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
    }

    // Try to upload one more
    const [videoPDA] = getVideoPDA(collectionPDA, "video-over-limit");
    try {
      await program.methods
        .uploadVideo("video-over-limit", ROOT_CID)
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
      expect.fail("Should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("VideoLimitExceeded");
    }
  });

  it("Fails if video_id exceeds MAX_ID_LEN", async () => {
    const longVideoId = "a".repeat(33); // MAX_ID_LEN is 32
    const [videoPDA] = getVideoPDA(collectionPDA, longVideoId);

    try {
      await program.methods
        .uploadVideo(longVideoId, ROOT_CID)
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
      expect.fail("Should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("StringTooLong");
    }
  });

  it("Fails if root_cid exceeds MAX_URL_LEN", async () => {
    const longCid = "a".repeat(201); // MAX_URL_LEN is 200
    const [videoPDA] = getVideoPDA(collectionPDA, "video-invalid-cid");

    try {
      await program.methods
        .uploadVideo("video-invalid-cid", longCid)
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
      expect.fail("Should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("StringTooLong");
    }
  });

  it("Successfully uploads video with performer wallet", async () => {
    const [videoPDA] = getVideoPDA(collectionPDA, "video-with-performer");

    const tx = await program.methods
      .uploadVideo("video-with-performer", ROOT_CID)
      .accounts({
        owner: user.publicKey,
        collection: collectionPDA,
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
