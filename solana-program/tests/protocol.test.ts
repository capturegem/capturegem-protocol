import { expect } from "chai";
import { SystemProgram } from "@solana/web3.js";
import {
  program,
  admin,
  treasury,
  capgmMint,
  setupAccounts,
  getGlobalStatePDA,
} from "./helpers/setup";
import {
  INDEXER_URL,
  REGISTRY_URL,
  MOD_STAKE_MIN,
  FEE_BASIS_POINTS,
} from "./helpers/constants";

describe("Protocol Initialization", () => {
  before(async () => {
    await setupAccounts();
  });

  it("Successfully initializes protocol", async () => {
    const [globalStatePDA] = getGlobalStatePDA();

    const tx = await program.methods
      .initializeProtocol(
        INDEXER_URL,
        REGISTRY_URL,
        MOD_STAKE_MIN,
        FEE_BASIS_POINTS
      )
      .accounts({
        admin: admin.publicKey,
        globalState: globalStatePDA,
        treasury: treasury.publicKey,
        capgmMint: capgmMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const globalState = await program.account.globalState.fetch(globalStatePDA);
    expect(globalState.admin.toString()).to.equal(admin.publicKey.toString());
    expect(globalState.treasury.toString()).to.equal(treasury.publicKey.toString());
    expect(globalState.indexerApiUrl).to.equal(INDEXER_URL);
    expect(globalState.nodeRegistryUrl).to.equal(REGISTRY_URL);
    expect(globalState.moderatorStakeMinimum.toString()).to.equal(MOD_STAKE_MIN.toString());
    expect(globalState.capgmMint.toString()).to.equal(capgmMint.publicKey.toString());
    expect(globalState.feeBasisPoints).to.equal(FEE_BASIS_POINTS);
  });

  it("Fails if indexer_url exceeds MAX_URL_LEN", async () => {
    const longUrl = "a".repeat(201); // MAX_URL_LEN is 200
    const [globalStatePDA] = getGlobalStatePDA();

    try {
      await program.methods
        .initializeProtocol(
          longUrl,
          REGISTRY_URL,
          MOD_STAKE_MIN,
          FEE_BASIS_POINTS
        )
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePDA,
          treasury: treasury.publicKey,
          capgmMint: capgmMint.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("StringTooLong");
    }
  });

  it("Fails if registry_url exceeds MAX_URL_LEN", async () => {
    const longUrl = "a".repeat(201); // MAX_URL_LEN is 200
    const [globalStatePDA] = getGlobalStatePDA();

    try {
      await program.methods
        .initializeProtocol(
          INDEXER_URL,
          longUrl,
          MOD_STAKE_MIN,
          FEE_BASIS_POINTS
        )
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePDA,
          treasury: treasury.publicKey,
          capgmMint: capgmMint.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      expect.fail("Should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("StringTooLong");
    }
  });

  it("Fails if called twice (already initialized)", async () => {
    const [globalStatePDA] = getGlobalStatePDA();

    try {
      await program.methods
        .initializeProtocol(
          INDEXER_URL,
          REGISTRY_URL,
          MOD_STAKE_MIN,
          FEE_BASIS_POINTS
        )
        .accounts({
          admin: admin.publicKey,
          globalState: globalStatePDA,
          treasury: treasury.publicKey,
          capgmMint: capgmMint.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      expect.fail("Should have failed - already initialized");
    } catch (err: any) {
      // Should fail because account already exists
      expect(err.toString()).to.include("already in use");
    }
  });
});
