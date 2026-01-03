// client-library/libs/IndexerClient.ts
import axios, { AxiosInstance } from "axios";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface CollectionMetadata {
  id: string;
  title: string;
  thumbnailUrl: string;
  videoCount: number;
}

/**
 * Trusted node information from indexer
 */
export interface TrustedNode {
  peerId: string; // IPFS peer ID
  walletAddress: string; // Solana wallet
  trustScore: number; // 0-100
  successfulDeliveries: number;
  averageLatencyMs: number;
  uptimePercentage: number;
  multiaddr?: string;
}

/**
 * Orca pool information from indexer
 */
export interface PoolInfo {
  poolAddress: string;
  currentPrice: number;
  liquidity: string;
  volume24h: string;
  priceChange24h: number;
  tokenAReserve: string;
  tokenBReserve: string;
  fee: number;
}

/**
 * Moderation statistics
 */
export interface ModerationStats {
  pendingReports: number;
  pendingClaims: number;
  totalBlacklisted: number;
  activeModerators: number;
}

export class IndexerClient {
  private api: AxiosInstance;

  constructor(baseUrl: string) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
    });
  }

  /**
   * Fetch list of collections with optional filtering.
   */
  public async getCollections(category?: string): Promise<CollectionMetadata[]> {
    try {
      const response = await this.api.get("/collections", {
        params: { category }
      });
      return response.data;
    } catch (error) {
      console.error("Indexer Error:", error);
      return [];
    }
  }

  /**
   * Full text search via Indexer.
   */
  public async search(query: string): Promise<CollectionMetadata[]> {
    const response = await this.api.get("/collections/search", {
      params: { q: query }
    });
    return response.data;
  }

  /**
   * Resolve an IPNS key to a user profile object.
   */
  public async resolveProfile(pubkey: string): Promise<any> {
    const response = await this.api.get(`/user/${pubkey}/profile`);
    return response.data;
  }

  /**
   * Get trusted nodes with high trust scores
   * Used for prioritizing peer connections
   * 
   * @param minTrustScore - Minimum trust score (0-100, default: 50)
   * @returns Array of trusted nodes sorted by trust score
   */
  public async getTrustedNodes(minTrustScore: number = 50): Promise<TrustedNode[]> {
    try {
      const response = await this.api.get("/nodes/trusted", {
        params: { min_score: minTrustScore }
      });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch trusted nodes:", error);
      return [];
    }
  }

  /**
   * Get real-time Orca pool information for a collection
   * 
   * @param collectionId - Collection identifier
   * @returns Pool pricing and liquidity data
   */
  public async getCollectionPoolInfo(collectionId: string): Promise<PoolInfo | null> {
    try {
      const response = await this.api.get(`/collections/${collectionId}/pool`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch pool info for ${collectionId}:`, error);
      return null;
    }
  }

  /**
   * Get collection details by ID
   * 
   * @param collectionId - Collection identifier
   * @returns Collection metadata with extended information
   */
  public async getCollection(collectionId: string): Promise<CollectionMetadata | null> {
    try {
      const response = await this.api.get(`/collections/${collectionId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch collection ${collectionId}:`, error);
      return null;
    }
  }

  /**
   * Report content for moderation
   * 
   * @param collectionId - Collection to report
   * @param reason - Report reason
   * @param category - Report category
   * @param reporterSignature - Signed message proving report authenticity
   * @returns Report ID
   */
  public async reportContent(
    collectionId: string,
    reason: string,
    category: "illegal" | "copyright" | "tos_violation" | "spam",
    reporterSignature: string
  ): Promise<string> {
    try {
      const response = await this.api.post(`/collections/${collectionId}/report`, {
        reason,
        category,
        signature: reporterSignature,
      });
      return response.data.reportId;
    } catch (error) {
      console.error(`Failed to report collection ${collectionId}:`, error);
      throw error;
    }
  }

  /**
   * Get moderation statistics
   * 
   * @returns Current moderation stats
   */
  public async getModerationStats(): Promise<ModerationStats> {
    try {
      const response = await this.api.get("/moderation/stats");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch moderation stats:", error);
      return {
        pendingReports: 0,
        pendingClaims: 0,
        totalBlacklisted: 0,
        activeModerators: 0,
      };
    }
  }

  /**
   * Get pending content reports (moderator view)
   * 
   * @param moderatorToken - Authentication token for moderators
   * @returns Array of pending reports
   */
  public async getPendingReports(moderatorToken: string): Promise<any[]> {
    try {
      const response = await this.api.get("/moderation/reports/pending", {
        headers: { Authorization: `Bearer ${moderatorToken}` }
      });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch pending reports:", error);
      return [];
    }
  }

  /**
   * Get pending copyright claims (moderator view)
   * 
   * @param moderatorToken - Authentication token for moderators
   * @returns Array of pending claims
   */
  public async getPendingClaims(moderatorToken: string): Promise<any[]> {
    try {
      const response = await this.api.get("/moderation/claims/pending", {
        headers: { Authorization: `Bearer ${moderatorToken}` }
      });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch pending claims:", error);
      return [];
    }
  }

  /**
   * Check if a collection is blacklisted
   * 
   * @param collectionId - Collection to check
   * @returns true if blacklisted
   */
  public async isBlacklisted(collectionId: string): Promise<boolean> {
    try {
      const response = await this.api.get(`/collections/${collectionId}/blacklisted`);
      return response.data.blacklisted === true;
    } catch (error) {
      console.error(`Failed to check blacklist status for ${collectionId}:`, error);
      return false;
    }
  }

  /**
   * Get trending collections
   * 
   * @param limit - Number of collections to return (default: 10)
   * @param timeframe - Timeframe for trending calculation (24h, 7d, 30d)
   * @returns Array of trending collections
   */
  public async getTrendingCollections(
    limit: number = 10,
    timeframe: "24h" | "7d" | "30d" = "24h"
  ): Promise<CollectionMetadata[]> {
    try {
      const response = await this.api.get("/collections/trending", {
        params: { limit, timeframe }
      });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch trending collections:", error);
      return [];
    }
  }

  /**
   * Get collections by creator
   * 
   * @param creatorPubkey - Creator's wallet address
   * @returns Array of collections by this creator
   */
  public async getCollectionsByCreator(creatorPubkey: string): Promise<CollectionMetadata[]> {
    try {
      const response = await this.api.get(`/creators/${creatorPubkey}/collections`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch collections for creator ${creatorPubkey}:`, error);
      return [];
    }
  }

  /**
   * Get peer connection information for a collection
   * Returns list of pinners actively hosting the collection
   * 
   * @param collectionId - Collection identifier
   * @returns Array of pinner nodes
   */
  public async getCollectionPinners(collectionId: string): Promise<TrustedNode[]> {
    try {
      const response = await this.api.get(`/collections/${collectionId}/pinners`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch pinners for ${collectionId}:`, error);
      return [];
    }
  }

  /**
   * Announce as a pinner for a collection
   * Registers your node as actively hosting a collection
   * 
   * @param collectionId - Collection being pinned
   * @param peerId - IPFS peer ID
   * @param walletAddress - Pinner's wallet address
   * @param multiaddr - Multiaddr for connections
   * @param signature - Signed proof of wallet ownership
   * @returns Success status
   */
  public async announcePinner(
    collectionId: string,
    peerId: string,
    walletAddress: string,
    multiaddr: string,
    signature: string
  ): Promise<boolean> {
    try {
      await this.api.post(`/collections/${collectionId}/pinners`, {
        peer_id: peerId,
        wallet_address: walletAddress,
        multiaddr,
        signature,
      });
      return true;
    } catch (error) {
      console.error(`Failed to announce as pinner for ${collectionId}:`, error);
      return false;
    }
  }

  /**
   * Get staking statistics for a collection
   * 
   * @param collectionId - Collection identifier
   * @returns Staking pool statistics
   */
  public async getStakingStats(collectionId: string): Promise<{
    totalStaked: string;
    totalStakers: number;
    apy: number;
    rewardRate: string;
  } | null> {
    try {
      const response = await this.api.get(`/collections/${collectionId}/staking`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch staking stats for ${collectionId}:`, error);
      return null;
    }
  }
}

