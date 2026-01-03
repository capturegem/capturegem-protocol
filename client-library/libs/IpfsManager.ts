// client-library/libs/IpfsManager.ts
import { spawn, ChildProcess } from "child_process";
import * as path from "path";

// Type definition for IPFS client
// ipfs-http-client v60+ may have incomplete type definitions
interface IPFSHTTPClient {
  add(data: string | Uint8Array): Promise<{ cid: { toString: () => string } }>;
  [key: string]: any;
}

// Use require to avoid TypeScript module resolution issues
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const ipfsHttpClient = require("ipfs-http-client");
const create = ipfsHttpClient.create as (options?: { url?: string }) => Promise<IPFSHTTPClient>;

export class IpfsManager {
  private ipfsProcess: ChildProcess | null = null;
  private client: IPFSHTTPClient | null = null;
  private isRunning: boolean = false;

  constructor() {}

  /**
   * Spawns the bundled 'kubo' (go-ipfs) binary.
   */
  public async startDaemon(): Promise<void> {
    if (this.isRunning) return;

    const binaryPath = path.join(__dirname, "bin", "ipfs"); // Path to bundled binary
    
    console.log("Starting IPFS Daemon...");
    
    // In a real Electron app, you'd handle repo initialization (`ipfs init`) first.
    this.ipfsProcess = spawn(binaryPath, ["daemon", "--enable-pubsub-experiment"]);

    this.ipfsProcess.stdout?.on("data", async (data) => {
      console.log(`IPFS: ${data}`);
      if (data.toString().includes("Daemon is ready")) {
        this.isRunning = true;
        await this.connectClient();
      }
    });

    this.ipfsProcess.stderr?.on("data", (data) => console.error(`IPFS Error: ${data}`));
  }

  private async connectClient(): Promise<void> {
    // Default API port 5001
    this.client = await create({ url: "http://127.0.0.1:5001" });
  }

  public async uploadMetadata(metadata: any): Promise<string> {
    if (!this.client) throw new Error("IPFS not started");
    const { cid } = await this.client.add(JSON.stringify(metadata));
    return cid.toString();
  }

  public async stopDaemon() {
    if (this.ipfsProcess) {
      this.ipfsProcess.kill();
      this.isRunning = false;
    }
  }
}
