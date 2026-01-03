// client-library/libs/ModerationClient.ts

/**
 * ModerationClient - Client library for moderation and copyright claim operations
 * 
 * Handles:
 * 1. Copyright claims for stolen content
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

    // TODO: Update to use ticket-based system (create_ticket with TicketType::CopyrightClaim)
    // Build claim submission transaction
    const tx = await (this.program.methods as any)
      .createTicket(
        collectionPubkey.toBase58(),
        { copyrightClaim: {} }, // TicketType::CopyrightClaim
        JSON.stringify(proof)
      )
      .accountsPartial({
        reporter: claimantKeypair.publicKey,
        ticket: claimPDA,
        systemProgram: SystemProgram.programId,
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

    // TODO: Update to use ModTicket account instead of copyrightClaim
    // Fetch ticket (ModTicket account)
    const ticket = await (this.program.account as any).modTicket.fetch(claimPubkey);
    const claim = ticket as any; // Temporary type assertion

    // Get collection state
    const collectionState = await this.program.account.collectionState.fetch(
      claim.collection
    );

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Claimant: ${claim.claimant.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${claim.collection.toBase58().slice(0, 8)}...`);
    const vaultBalance = (collectionState as any).claimVaultBalance || new BN(0);
    console.log(`   Vault balance: ${vaultBalance.toString()}`);

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
    // TODO: resolve_copyright_claim requires verdict (bool) and vault_amount (u64) parameters
    const vaultAmount = vaultBalance.toNumber();
    const tx = await this.program.methods
      .resolveCopyrightClaim(true, vaultAmount) // verdict: true, vault_amount
      .accountsPartial({
        moderator: moderatorKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorStake: await this.getModeratorStakePDA(moderatorKeypair.publicKey),
        ticket: claimPubkey, // ModTicket account
        collection: claim.collection,
        claimVault: claimVaultPDA,
        claimantTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ Claim approved! Transaction: ${tx}`);
    console.log(`   Tokens transferred to claimant: ${vaultBalance.toString()}`);

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

    const ticket = await (this.program.account as any).modTicket.fetch(claimPubkey);
    const claim = ticket as any;

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Reason: ${reason}`);

    // TODO: Use resolve_copyright_claim with verdict: false instead of rejectCopyrightClaim
    const tx = await this.program.methods
      .resolveCopyrightClaim(false, 0) // verdict: false (rejected)
      .accountsPartial({
        moderator: moderatorKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorStake: await this.getModeratorStakePDA(moderatorKeypair.publicKey),
        ticket: claimPubkey,
        collection: claim.collection,
        claimVault: await this.getClaimVaultPDA(claim.collection),
        claimantTokenAccount: await getAssociatedTokenAddress(
          (await this.program.account.collectionState.fetch(claim.collection)).mint,
          claim.claimant
        ),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
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
    const vaultBalance = (collectionState as any).claimVaultBalance || new BN(0);
    console.log(`   Vault balance: ${vaultBalance.toString()}`);

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
      .accountsPartial({
        authority: callerKeypair.publicKey,
        collection: collectionPubkey,
        claimVault: claimVaultPDA,
        mint: collectionState.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([callerKeypair])
      .rpc();

    console.log(`✅ Unclaimed tokens burned! Transaction: ${tx}`);
    console.log(`   Deflationary effect: -${vaultBalance.toString()} tokens`);

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

    // TODO: Use create_ticket with TicketType::ContentReport instead of reportContent
    const ticketType = { contentReport: {} }; // TicketType::ContentReport
    const tx = await this.program.methods
      .createTicket(
        collectionPubkey.toBase58(),
        ticketType,
        reason
      )
      .accountsPartial({
        reporter: reporterKeypair.publicKey,
        ticket: reportPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([reporterKeypair])
      .rpc();

    console.log(`✅ Content reported! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Blacklist a collection (moderator only)
   * Resolves a ContentReport ticket with verdict: true to blacklist the collection
   * 
   * @param ticketPubkey - ContentReport ticket PDA to resolve
   * @param moderatorKeypair - Moderator's keypair
   * @param collectionPubkey - Collection to blacklist
   * @returns Transaction signature
   */
  async blacklistCollection(
    ticketPubkey: PublicKey,
    moderatorKeypair: Keypair,
    collectionPubkey: PublicKey
  ): Promise<string> {
    console.log("🚫 Blacklisting collection...");

    // Fetch ticket to verify it's a ContentReport
    const ticket = await (this.program.account as any).modTicket.fetch(ticketPubkey);
    
    if (ticket.ticketType?.contentReport === undefined) {
      throw new Error("Ticket is not a ContentReport");
    }

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);

    // Resolve ticket with verdict: true (blacklist)
    const tx = await this.program.methods
      .resolveTicket(true) // true = approved (blacklisted)
      .accountsPartial({
        moderator: moderatorKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorStake: await this.getModeratorStakePDA(moderatorKeypair.publicKey),
        ticket: ticketPubkey,
        collection: collectionPubkey,
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
    // TODO: Fetch ModTicket accounts with TicketType::CopyrightClaim instead
    const tickets = await (this.program.account as any).modTicket.all([
      {
        memcmp: {
          offset: 8 + 32, // Skip discriminator + reporter, target_id starts here
          bytes: collectionPubkey.toBase58(),
        },
      },
    ]);

    return tickets.map((t: any) => {
      const ticket = t.account;
      return {
        collection: collectionPubkey,
        claimant: ticket.reporter,
        proofHash: new Uint8Array(32), // Not stored in ticket
        submittedAt: new BN(0), // Not stored in ticket
        status: ticket.resolved ? (ticket.verdict ? "approved" : "rejected") : "pending",
        moderator: ticket.resolver || undefined,
        resolvedAt: ticket.resolved ? new BN(0) : undefined, // Not stored in ticket
      } as CopyrightClaim;
    });
  }

  /**
   * Get all pending copyright claims (across all collections)
   * 
   * @returns Array of pending claims
   */
  async getAllPendingClaims(): Promise<CopyrightClaim[]> {
    // TODO: Fetch ModTicket accounts with TicketType::CopyrightClaim
    const allTickets = await (this.program.account as any).modTicket.all();
    return allTickets
      .map((t: any) => {
        const ticket = t.account;
        if (ticket.ticketType?.copyrightClaim) {
          return {
            collection: new PublicKey(ticket.targetId), // targetId is collection pubkey as string
            claimant: ticket.reporter,
            proofHash: new Uint8Array(32),
            submittedAt: new BN(0),
            status: ticket.resolved ? (ticket.verdict ? "approved" : "rejected") : "pending",
            moderator: ticket.resolver || undefined,
            resolvedAt: ticket.resolved ? new BN(0) : undefined,
          } as CopyrightClaim;
        }
        return null;
      })
      .filter((claim: CopyrightClaim | null): claim is CopyrightClaim => claim !== null && claim.status === "pending");
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

  /**
   * Helper: Get GlobalState PDA
   */
  private async getGlobalStatePDA(): Promise<PublicKey> {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_state")],
      this.program.programId
    );
    return pda;
  }

  /**
   * Helper: Get ModeratorStake PDA
   */
  private async getModeratorStakePDA(moderator: PublicKey): Promise<PublicKey> {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("moderator_stake"), moderator.toBuffer()],
      this.program.programId
    );
    return pda;
  }

  /**
   * Helper: Get ClaimVault PDA
   */
  private async getClaimVaultPDA(collection: PublicKey): Promise<PublicKey> {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim_vault"), collection.toBuffer()],
      this.program.programId
    );
    return pda;
  }

  /**
   * Submit a CID censorship ticket for a specific CID in a collection
   * Used to censor individual videos without blacklisting the entire collection
   * 
   * @param collectionPubkey - Collection containing the CID
   * @param reporterKeypair - Reporter's keypair
   * @param cid - IPFS CID to censor
   * @param reason - Reason for censorship
   * @returns Transaction signature and ticket PDA
   */
  async submitCidCensorship(
    collectionPubkey: PublicKey,
    reporterKeypair: Keypair,
    cid: string,
    reason: string
  ): Promise<{ transaction: string; ticketPDA: PublicKey }> {
    console.log("🚨 Submitting CID censorship ticket...");

    console.log(`   Reporter: ${reporterKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Collection: ${collectionPubkey.toBase58().slice(0, 8)}...`);
    console.log(`   CID to censor: ${cid}`);
    console.log(`   Reason: ${reason}`);

    // Derive ticket PDA
    const targetId = `${collectionPubkey.toBase58()}-${cid}`;
    const [ticketPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("ticket"), Buffer.from(targetId)],
      this.program.programId
    );

    // Create ticket with TicketType::CidCensorship
    const ticketType = { cidCensorship: {} };
    const tx = await this.program.methods
      .createTicket(
        targetId,
        ticketType,
        `CID: ${cid} | Reason: ${reason}`
      )
      .accountsPartial({
        reporter: reporterKeypair.publicKey,
        ticket: ticketPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([reporterKeypair])
      .rpc();

    console.log(`✅ CID censorship ticket submitted! Transaction: ${tx}`);
    console.log(`   Ticket PDA: ${ticketPDA.toBase58()}`);

    return { transaction: tx, ticketPDA };
  }

  /**
   * Resolve a CID censorship ticket (moderator only)
   * Censors a specific CID in a collection
   * 
   * @param ticketPubkey - CID censorship ticket PDA
   * @param moderatorKeypair - Moderator's keypair
   * @param collectionPubkey - Collection containing the CID
   * @param verdict - true = censor CID, false = keep CID
   * @param cid - The CID being censored
   * @returns Transaction signature
   */
  async resolveCidCensorship(
    ticketPubkey: PublicKey,
    moderatorKeypair: Keypair,
    collectionPubkey: PublicKey,
    verdict: boolean,
    cid: string
  ): Promise<string> {
    console.log(`${verdict ? "🚫" : "✅"} Resolving CID censorship ticket...`);

    // Fetch ticket to verify it's a CidCensorship ticket
    const ticket = await (this.program.account as any).modTicket.fetch(ticketPubkey);
    
    if (ticket.ticketType?.cidCensorship === undefined) {
      throw new Error("Ticket is not a CidCensorship ticket");
    }

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   CID: ${cid}`);
    console.log(`   Verdict: ${verdict ? "CENSOR" : "KEEP"}`);

    const tx = await this.program.methods
      .resolveCidCensorship(verdict, cid)
      .accountsPartial({
        moderator: moderatorKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorStake: await this.getModeratorStakePDA(moderatorKeypair.publicKey),
        ticket: ticketPubkey,
        collection: collectionPubkey,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ CID censorship resolved! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Stake CAPGM tokens to become a moderator
   * 
   * @param moderatorKeypair - Moderator's keypair
   * @param stakeAmount - Amount of CAPGM to stake
   * @returns Transaction signature
   */
  async stakeModerator(
    moderatorKeypair: Keypair,
    stakeAmount: BN
  ): Promise<string> {
    console.log("🔒 Staking CAPGM to become moderator...");

    const globalState = await this.program.account.globalState.fetch(
      await this.getGlobalStatePDA()
    );

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Stake amount: ${stakeAmount.toString()} CAPGM`);
    console.log(`   Minimum required: ${globalState.moderatorStakeMinimum.toString()} CAPGM`);

    if (stakeAmount.lt(new BN(globalState.moderatorStakeMinimum.toString()))) {
      throw new Error(`Stake amount ${stakeAmount.toString()} is below minimum ${globalState.moderatorStakeMinimum.toString()}`);
    }

    // Derive moderator stake PDA
    const moderatorStakePDA = await this.getModeratorStakePDA(moderatorKeypair.publicKey);

    // Get moderator's CAPGM token account
    const moderatorTokenAccount = await getAssociatedTokenAddress(
      globalState.capgmMint,
      moderatorKeypair.publicKey
    );

    const tx = await this.program.methods
      .stakeModerator(stakeAmount.toNumber())
      .accountsPartial({
        moderator: moderatorKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorTokenAccount,
        moderatorStake: moderatorStakePDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ Moderator staked! Transaction: ${tx}`);
    console.log(`   You can now moderate tickets on the platform`);

    return tx;
  }

  /**
   * Unstake CAPGM tokens and stop being a moderator
   * 
   * @param moderatorKeypair - Moderator's keypair
   * @returns Transaction signature
   */
  async unstakeModerator(
    moderatorKeypair: Keypair
  ): Promise<string> {
    console.log("🔓 Unstaking CAPGM moderator stake...");

    const globalState = await this.program.account.globalState.fetch(
      await this.getGlobalStatePDA()
    );

    const moderatorStakePDA = await this.getModeratorStakePDA(moderatorKeypair.publicKey);
    const moderatorStake = await this.program.account.moderatorStake.fetch(moderatorStakePDA);

    console.log(`   Moderator: ${moderatorKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Unstaking: ${moderatorStake.stakeAmount.toString()} CAPGM`);

    // Get moderator's CAPGM token account
    const moderatorTokenAccount = await getAssociatedTokenAddress(
      globalState.capgmMint,
      moderatorKeypair.publicKey
    );

    // Note: unstake_moderator instruction may not exist yet in Rust code
    // This assumes it will be implemented similar to stake_moderator
    const tx = await (this.program.methods as any)
      .unstakeModerator()
      .accountsPartial({
        moderator: moderatorKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorStake: moderatorStakePDA,
        moderatorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([moderatorKeypair])
      .rpc();

    console.log(`✅ Moderator unstaked! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Slash a malicious moderator (admin only)
   * Burns their staked CAPGM as punishment for bad behavior
   * 
   * @param adminKeypair - Admin's keypair
   * @param moderatorPubkey - Moderator to slash
   * @returns Transaction signature
   */
  async slashModerator(
    adminKeypair: Keypair,
    moderatorPubkey: PublicKey
  ): Promise<string> {
    console.log("⚔️ Slashing malicious moderator...");

    console.log(`   Admin: ${adminKeypair.publicKey.toBase58().slice(0, 8)}...`);
    console.log(`   Moderator to slash: ${moderatorPubkey.toBase58().slice(0, 8)}...`);

    const globalState = await this.program.account.globalState.fetch(
      await this.getGlobalStatePDA()
    );

    const moderatorStakePDA = await this.getModeratorStakePDA(moderatorPubkey);

    const tx = await this.program.methods
      .slashModerator()
      .accountsPartial({
        superModerator: adminKeypair.publicKey,
        globalState: await this.getGlobalStatePDA(),
        moderatorStake: moderatorStakePDA,
      })
      .signers([adminKeypair])
      .rpc();

    console.log(`✅ Moderator slashed! Transaction: ${tx}`);

    return tx;
  }

  /**
   * Get moderator stake information
   * 
   * @param moderatorPubkey - Moderator's public key
   * @returns Moderator stake details or null if not staked
   */
  async getModeratorStake(
    moderatorPubkey: PublicKey
  ): Promise<{
    moderator: PublicKey;
    stakeAmount: BN;
    isActive: boolean;
    slashCount: number;
  } | null> {
    try {
      const moderatorStakePDA = await this.getModeratorStakePDA(moderatorPubkey);
      const stake = await this.program.account.moderatorStake.fetch(moderatorStakePDA);

      return {
        moderator: stake.moderator,
        stakeAmount: new BN(stake.stakeAmount.toString()),
        isActive: stake.isActive,
        slashCount: stake.slashCount,
      };
    } catch (error) {
      console.error(`Moderator ${moderatorPubkey.toBase58()} not staked:`, error);
      return null;
    }
  }

  /**
   * Get a specific ticket by PDA
   * 
   * @param ticketPubkey - Ticket PDA
   * @returns Ticket details
   */
  async getTicket(ticketPubkey: PublicKey): Promise<any> {
    const ticket = await (this.program.account as any).modTicket.fetch(ticketPubkey);
    return ticket;
  }

  /**
   * Get all tickets of a specific type
   * 
   * @param ticketType - Type of tickets to fetch
   * @returns Array of tickets
   */
  async getTicketsByType(
    ticketType: "contentReport" | "copyrightClaim" | "cidCensorship"
  ): Promise<any[]> {
    const allTickets = await (this.program.account as any).modTicket.all();
    
    return allTickets
      .filter((t: any) => {
        const ticket = t.account;
        return ticket.ticketType?.[ticketType] !== undefined;
      })
      .map((t: any) => ({
        pubkey: t.publicKey,
        ...t.account,
      }));
  }

  /**
   * Get all tickets submitted by a specific reporter
   * 
   * @param reporterPubkey - Reporter's public key
   * @returns Array of tickets
   */
  async getTicketsByReporter(reporterPubkey: PublicKey): Promise<any[]> {
    const tickets = await (this.program.account as any).modTicket.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: reporterPubkey.toBase58(),
        },
      },
    ]);

    return tickets.map((t: any) => ({
      pubkey: t.publicKey,
      ...t.account,
    }));
  }

  /**
   * Get all pending tickets (unresolved)
   * 
   * @returns Array of pending tickets
   */
  async getAllPendingTickets(): Promise<any[]> {
    const allTickets = await (this.program.account as any).modTicket.all();
    
    return allTickets
      .filter((t: any) => !t.account.resolved)
      .map((t: any) => ({
        pubkey: t.publicKey,
        ...t.account,
      }));
  }

  /**
   * Check if a user is an active moderator
   * 
   * @param userPubkey - User's public key
   * @returns true if user is an active moderator
   */
  async isModerator(userPubkey: PublicKey): Promise<boolean> {
    try {
      const stake = await this.getModeratorStake(userPubkey);
      if (!stake) return false;

      const globalState = await this.program.account.globalState.fetch(
        await this.getGlobalStatePDA()
      );

      return (
        stake.isActive &&
        stake.stakeAmount.gte(new BN(globalState.moderatorStakeMinimum.toString()))
      );
    } catch (error) {
      return false;
    }
  }
}

