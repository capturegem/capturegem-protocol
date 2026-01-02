// library-source/libs/IndexerClient.ts
import axios, { AxiosInstance } from "axios";

export interface CollectionMetadata {
  id: string;
  title: string;
  thumbnailUrl: string;
  videoCount: number;
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
  public async resolveProfile(pubkey: string) {
    const response = await this.api.get(`/user/${pubkey}/profile`);
    return response.data;
  }
}
