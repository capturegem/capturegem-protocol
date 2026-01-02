import { expect } from "chai";
import { SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  program,
  user,
  performer,
  setupAccounts,
  getCollectionPDA,
  getVideoPDA,
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
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
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
});
