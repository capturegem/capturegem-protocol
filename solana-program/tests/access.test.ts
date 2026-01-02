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
    [collectionPDA] = getCollectionPDA(user.publicKey, COLLECTION_ID);
    // Note: In real tests, you'd fetch the mint from collection state
    mint = Keypair.generate().publicKey;
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
      expect(err.toString()).to.include("InsufficientFunds");
    }
  });
});
