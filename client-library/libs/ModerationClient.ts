// client-library/libs/ModerationClient.ts

/**
 * ModerationClient - Client library for moderation and copyright claim operations
 * 
 * Handles:
 * 1. Copyright claims (PerformerClaim) for stolen content
 * 2. Moderator approval/rejection of claims
 * 3. Burning unclaimed tokens from Claim Vault after 6 months
 * 4. Content reporting and blacklisting
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { SolanaProgram } from "../../solana-program/target/types/solana_program";

/**
 * Off-chain proof for copyright claims
 * Contains links to external evidence
 */
export interface OffChainProof {
  originalUploadUrl?: string; // Link to original upload (YouTube, OnlyFans, etc.)
  socialMediaProfile?: string; // Verified social media
  timestampProof?: string; // Archive.org link, blockchain timestamp, etc.
  additionalEvidence?: string[]; // Other supporting links
  description: string; // Explanation of the claim
}

/**
 * Copyright claim information
 */
export interface CopyrightClaim {
  collection: PublicKey;
  claimant: PublicKey;
  proofHash: Uint8Array; // SHA-256 hash of proof JSON
  submittedAt: BN;
  status: "pending" | "approved" | "rejected";
  moderator?: PublicKey;
  resolvedAt?: BN;
}

/**
 * Content report for illegal/TOS violations
 */
export interface ContentReport {
  collection: PublicKey;
  reporter: PublicKey;
  reason: string;
  category: "illegal" | "copyright" | "tos_violation" | "spam";
  submittedAt: BN;
  status: "pending" | "approved" | "rejected";
  moderator?: PublicKey;
}

/**
 * Claim submission result
 */
export interface ClaimSubmissionResult {
  transaction: string;
  claimPDA: PublicKey;
  proofHash: Uint8Array;
}

export class ModerationClient {
  constructor(
    private program: Program<SolanaProgram>,
    private connection: Connection,
    private provider: AnchorProvider
  ) {}

  /**
   * Submit a copyright claim for stolen content
   * 
   * @param collectionPubkey - The collection being claimed
   * @param claimantKeypair - Claimant's keypair (true rights holder)
   * @param proof - Off-chain proof of ownership
   * @returns Claim submission result
   */
  async submitCopyrightClaim(
    collectionPubkey: PublicKey,
    claimantKeypair: Keypair,
    proof: OffChainProof
  ): Promise<ClaimSubmissionResult> {
    console.log("📝 Submitting copyright claim...");

    // Hash the proof for on-chain storage
    const proofJSON = JSON.stringify(proof);
    const proofHash = await this.hashProof(proofJSON);

    console.log(`   Claimant: ${claimantKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);
    console.log(`   Proof hash: ${Buffer.from(proofHash).toString('hex').slice(0, 16)}...`);

    // Derive copyright claim PDA
    const [claimPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("copyright_claim"),
        collectionPubkey.toBuffer(),
        claimantKeypair.publicKey.toBuffer(),
      ],
      this.program.programId
    );

    // Build claim submission transaction
    const tx = await this.program.methods
      .submitCopyrightClaim(Array.from(proofHash))
      .accounts({
        claimant: claimantKeypair.publicKey,
        collection: collectionPubkey,
        copyrightClaim: claimPDA,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([claimantKeypair])
      .rpc();

    console.log(`✅ Claim submitted! Transaction: ${tx}`);
    console.log(`   Claim PDA: ${claimPDA.toBase58()}`);
    console.log(`\n📋 Off-chain proof stored at: [IPFS/Arweave URL here]`);

    return {
      transaction: tx,
      claimPDA,
      proofHash,
    };
  }

  /**
   * Approve a copyright claim (moderator only)
   * Transfers 10% Claim Vault tokens to claimant
   * 
   * @param claimPubkey - The copyright claim PDA
   * @param moderatorKeypair - Moderator's keypair (must be authorized)
   * @returns Transaction signature
   */
  async approveCopyrightClaim(
    claimPubkey: PublicKey,
    moderatorKeypair: Keypair
  ): Promise<string> {
    console.log("✅ Approving copyright claim...");

    // Fetch claim
    const claim = await this.program.account.copyrightClaim.fetch(claimPubkey);

    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      claim.collection
    );

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Claimant: ${claim.claimant.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${claim.collection.toBase58().slice(0, 8)}...`);
    console.log(`   Vault balance: ${collectionState.claimVaultBalance.toString()}`);

    // Derive Claim Vault PDA
    const [claimVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim_vault"), claim.collection.toBuffer()],
      this.program.programId
    );

    // Get token accounts
    const vaultTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      claimVaultPDA,
      true
    );

    const claimantTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      claim.claimant
    );

    // Build approval transaction
    const tx = await this.program.methods
      .resolveCopyrightClaim()
      .accounts({
        moderator: moderatorKeypair.publicKey,
        claimant: claim.claimant,
        collection: claim.collection,
        copyrightClaim: claimPubkey,
        claimVault: claimVaultPDA,
        vaultTokenAccount,
        claimantTokenAccount,
        collectionMint: collectionState.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ Claim approved! Transaction: ${tx}`);
    console.log(`   Tokens transferred to claimant: ${collectionState.claimVaultBalance.toString()}`);

    return tx;
  }

  /**
   * Reject a copyright claim (moderator only)
   * 
   * @param claimPubkey - The copyright claim PDA
   * @param moderatorKeypair - Moderator's keypair
   * @param reason - Rejection reason
   * @returns Transaction signature
   */
  async rejectCopyrightClaim(
    claimPubkey: PublicKey,
    moderatorKeypair: Keypair,
    reason: string
  ): Promise<string> {
    console.log("❌ Rejecting copyright claim...");

    const claim = await this.program.account.copyrightClaim.fetch(claimPubkey);

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Reason: ${reason}`);

    const tx = await this.program.methods
      .rejectCopyrightClaim()
      .accounts({
        moderator: moderatorKeypair.publicKey,
        collection: claim.collection,
        copyrightClaim: claimPubkey,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ Claim rejected! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Burn unclaimed tokens from Claim Vault (permissionless after 6 months)
   * Implements the deflationary mechanism for unclaimed IP reserves
   * 
   * @param collectionPubkey - The collection with expired claim period
   * @param callerKeypair - Any keypair (permissionless)
   * @returns Transaction signature
   */
  async burnUnclaimedTokens(
    collectionPubkey: PublicKey,
    callerKeypair: Keypair
  ): Promise<string> {
    console.log("🔥 Burning unclaimed tokens from Claim Vault...");

    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );

    // Check if 6 months have passed (assumption: createdAt field exists)
    const currentTime = Math.floor(Date.now() / 1000);
    const sixMonthsInSeconds = 6 * 30 * 24 * 60 * 60; // ~6 months
    
    // Note: You'll need to add a createdAt field to CollectionState in Rust
    // For now, we'll skip the time check and let the Rust program handle it

    console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);
    console.log(`   Vault balance: ${collectionState.claimVaultBalance.toString()}`);

    // Derive Claim Vault PDA
    const [claimVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim_vault"), collectionPubkey.toBuffer()],
      this.program.programId
    );

    // Get vault token account
    const vaultTokenAccount = await getAssociatedTokenAddress(
      collectionState.mint,
      claimVaultPDA,
      true
    );

    // Build burn transaction
    const tx = await this.program.methods
      .burnUnclaimedTokens()
      .accounts({
        caller: callerKeypair.publicKey,
        collection: collectionPubkey,
        claimVault: claimVaultPDA,
        vaultTokenAccount,
        collectionMint: collectionState.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([callerKeypair])
      .rpc();

    console.log(`✅ Unclaimed tokens burned! Transaction: ${tx}`);
    console.log(`   Deflationary effect: -${collectionState.claimVaultBalance.toString()} tokens`);

    return tx;
  }

  /**
   * Submit a content report for illegal/TOS violations
   * 
   * @param collectionPubkey - Collection to report
   * @param reporterKeypair - Reporter's keypair
   * @param reason - Report reason
   * @param category - Report category
   * @returns Transaction signature
   */
  async reportContent(
    collectionPubkey: PublicKey,
    reporterKeypair: Keypair,
    reason: string,
    category: "illegal" | "copyright" | "tos_violation" | "spam"
  ): Promise<string> {
    console.log("🚨 Reporting content...");

    console.log(`   Reporter: ${reporterKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);
    console.log(`   Category: ${category}`);
    console.log(`   Reason: ${reason}`);

    // Derive content report PDA
    const [reportPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("content_report"),
        collectionPubkey.toBuffer(),
        reporterKeypair.publicKey.toBuffer(),
      ],
      this.program.programId
    );

    const tx = await this.program.methods
      .reportContent(reason, category)
      .accounts({
        reporter: reporterKeypair.publicKey,
        collection: collectionPubkey,
        contentReport: reportPDA,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([reporterKeypair])
      .rpc();

    console.log(`✅ Content reported! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Blacklist a collection (moderator only)
   * Prevents content from being displayed in official clients
   * 
   * @param collectionPubkey - Collection to blacklist
   * @param moderatorKeypair - Moderator's keypair
   * @returns Transaction signature
   */
  async blacklistCollection(
    collectionPubkey: PublicKey,
    moderatorKeypair: Keypair
  ): Promise<string> {
    console.log("🚫 Blacklisting collection...");

    const tx = await this.program.methods
      .blacklistCollection()
      .accounts({
        moderator: moderatorKeypair.publicKey,
        collection: collectionPubkey,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ Collection blacklisted! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Get all copyright claims for a collection
   * 
   * @param collectionPubkey - Collection public key
   * @returns Array of copyright claims
   */
  async getCollectionClaims(collectionPubkey: PublicKey): Promise<CopyrightClaim[]> {
    const claims = await this.program.account.copyrightClaim.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: collectionPubkey.toBase58(),
        },
      },
    ]);

    return claims.map(c => c.account as any as CopyrightClaim);
  }

  /**
   * Get all pending copyright claims (across all collections)
   * 
   * @returns Array of pending claims
   */
  async getAllPendingClaims(): Promise<CopyrightClaim[]> {
    const allClaims = await this.program.account.copyrightClaim.all();
    return allClaims
      .map(c => c.account as any as CopyrightClaim)
      .filter(claim => claim.status === "pending");
  }

  /**
   * Check if a collection's claim period has expired (6 months)
   * 
   * @param collectionPubkey - Collection public key
   * @returns true if claim period expired
   */
  async isClaimPeriodExpired(collectionPubkey: PublicKey): Promise<boolean> {
    const collectionState = await this.program.account.collectionState.fetch(
      collectionPubkey
    );

    // Assuming createdAt field exists on CollectionState
    // You'll need to add this field in the Rust program
    const createdAt = (collectionState as any).createdAt?.toNumber() || 0;
    const currentTime = Math.floor(Date.now() / 1000);
    const sixMonths = 6 * 30 * 24 * 60 * 60;

    return currentTime >= createdAt + sixMonths;
  }

  /**
   * Hash proof data for on-chain storage
   * 
   * @param proofJSON - JSON string of proof
   * @returns SHA-256 hash
   */
  private async hashProof(proofJSON: string): Promise<Uint8Array> {
    const { createHash } = await import("crypto");
    const hash = createHash("sha256");
    hash.update(proofJSON);
    return new Uint8Array(hash.digest());
  }
}

