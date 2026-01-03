// client-library/libs/PDAUtils.ts

/**
 * PDAUtils - Program Derived Address utility functions
 * 
 * Centralized PDA derivation for all protocol accounts
 * Ensures consistency across the client library
 */

import { PublicKey } from "@solana/web3.js";

export class PDAUtils {
  /**
   * Derive CollectionState PDA
   * 
   * Seeds: ["collection", owner, collection_id]
   */
  static deriveCollectionState(
    owner: PublicKey,
    collectionId: string,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("collection"),
        owner.toBuffer(),
        Buffer.from(collectionId),
      ],
      programId
    );
  }

  /**
   * Derive AccessEscrow PDA
   * 
   * Seeds: ["access_escrow", purchaser, collection]
   */
  static deriveAccessEscrow(
    purchaser: PublicKey,
    collection: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("access_escrow"),
        purchaser.toBuffer(),
        collection.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive CidReveal PDA
   * 
   * Seeds: ["cid_reveal", escrow, pinner]
   */
  static deriveCidReveal(
    escrow: PublicKey,
    pinner: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("cid_reveal"),
        escrow.toBuffer(),
        pinner.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive StakingPool PDA
   * 
   * Seeds: ["staking_pool", collection]
   */
  static deriveStakingPool(
    collection: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("staking_pool"),
        collection.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive StakerPosition PDA
   * 
   * Seeds: ["staker_position", staker, pool]
   */
  static deriveStakerPosition(
    staker: PublicKey,
    pool: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("staker_position"),
        staker.toBuffer(),
        pool.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive PeerTrustState PDA
   * 
   * Seeds: ["peer_trust", peer]
   */
  static derivePeerTrust(
    peer: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("peer_trust"),
        peer.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive ClaimVault PDA
   * 
   * Seeds: ["claim_vault", collection]
   */
  static deriveClaimVault(
    collection: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_vault"),
        collection.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive PerformerEscrow PDA
   * 
   * Seeds: ["performer_escrow", collection]
   */
  static derivePerformerEscrow(
    collection: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("performer_escrow"),
        collection.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive GlobalState PDA
   * 
   * Seeds: ["global_state"]
   */
  static deriveGlobalState(
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("global_state")],
      programId
    );
  }

  /**
   * Derive CopyrightClaim PDA
   * 
   * Seeds: ["copyright_claim", collection, claimant]
   */
  static deriveCopyrightClaim(
    collection: PublicKey,
    claimant: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("copyright_claim"),
        collection.toBuffer(),
        claimant.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive ContentReport PDA
   * 
   * Seeds: ["content_report", collection, reporter]
   */
  static deriveContentReport(
    collection: PublicKey,
    reporter: PublicKey,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("content_report"),
        collection.toBuffer(),
        reporter.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive Whirlpool PDA (Orca)
   * 
   * Seeds: ["whirlpool", config, token_mint_a, token_mint_b, tick_spacing]
   */
  static deriveWhirlpool(
    whirlpoolsConfig: PublicKey,
    tokenMintA: PublicKey,
    tokenMintB: PublicKey,
    tickSpacing: number,
    orcaProgramId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("whirlpool"),
        whirlpoolsConfig.toBuffer(),
        tokenMintA.toBuffer(),
        tokenMintB.toBuffer(),
        Buffer.from([tickSpacing]),
      ],
      orcaProgramId
    );
  }

  /**
   * Derive Position PDA (Orca)
   * 
   * Seeds: ["position", position_mint]
   */
  static derivePosition(
    positionMint: PublicKey,
    orcaProgramId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        positionMint.toBuffer(),
      ],
      orcaProgramId
    );
  }

  /**
   * Derive all PDAs for a collection (convenience method)
   * Returns all common PDAs associated with a collection
   */
  static deriveCollectionPDAs(
    owner: PublicKey,
    collectionId: string,
    programId: PublicKey
  ): {
    collectionState: PublicKey;
    stakingPool: PublicKey;
    claimVault: PublicKey;
  } {
    const [collectionState] = this.deriveCollectionState(owner, collectionId, programId);
    const [stakingPool] = this.deriveStakingPool(collectionState, programId);
    const [claimVault] = this.deriveClaimVault(collectionState, programId);

    return {
      collectionState,
      stakingPool,
      claimVault,
    };
  }

  /**
   * Derive all PDAs for a purchase (convenience method)
   * Returns all PDAs associated with a content purchase
   */
  static derivePurchasePDAs(
    purchaser: PublicKey,
    collection: PublicKey,
    pinner: PublicKey,
    programId: PublicKey
  ): {
    accessEscrow: PublicKey;
    cidReveal: PublicKey;
    stakingPool: PublicKey;
  } {
    const [accessEscrow] = this.deriveAccessEscrow(purchaser, collection, programId);
    const [cidReveal] = this.deriveCidReveal(accessEscrow, pinner, programId);
    const [stakingPool] = this.deriveStakingPool(collection, programId);

    return {
      accessEscrow,
      cidReveal,
      stakingPool,
    };
  }

  /**
   * Validate that a PDA was derived correctly
   * Useful for debugging PDA mismatches
   */
  static validatePDA(
    expectedPda: PublicKey,
    seeds: (Buffer | Uint8Array)[],
    programId: PublicKey
  ): boolean {
    try {
      const [derivedPda] = PublicKey.findProgramAddressSync(seeds, programId);
      return derivedPda.equals(expectedPda);
    } catch {
      return false;
    }
  }

  /**
   * Find all PDAs for a given seed pattern
   * Useful for debugging and exploration
   */
  static async findPDAsByPrefix(
    seedPrefix: string,
    programId: PublicKey,
    maxBump: number = 255
  ): Promise<Array<{ pda: PublicKey; bump: number }>> {
    const results: Array<{ pda: PublicKey; bump: number }> = [];

    for (let bump = 0; bump <= maxBump; bump++) {
      try {
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from(seedPrefix), Buffer.from([bump])],
          programId
        );
        results.push({ pda, bump });
      } catch {
        // Invalid bump, skip
      }
    }

    return results;
  }
}

