import dotenv from 'dotenv';

dotenv.config();

const SOLTRACKER_API = "https://data.solanatracker.io";
const API_KEY = process.env.SOLANATRACKER_API_KEY || "";

export interface Holder {
  address: string;
  balance: number;
}

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  price_usd: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  holders: number;
  image?: string;
  description?: string;
}

export class SolTrackerClient {
  async getCreatorFees(mint: string): Promise<number> {
    // SolTracker doesn't have creator fees endpoint, so we'll use PumpPortal for this
    // This is a placeholder that returns 0
    // In practice, we'll use the PumpPortal client for fees
    return 0;
  }

  async getHolders(mint: string): Promise<Holder[]> {
    try {
      const url = `${SOLTRACKER_API}/tokens/${mint}/holders`;
      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      if (API_KEY) {
        headers["x-api-key"] = API_KEY;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        console.warn(`Failed to fetch holders for ${mint}: ${response.status}`);
        return [];
      }

      const data = await response.json() as { 
        total?: number;
        accounts?: Array<{ 
          wallet?: string; 
          owner?: string; 
          address?: string; 
          amount?: number; 
          balance?: number 
        }>;
        holders?: Array<{ 
          owner?: string; 
          address?: string; 
          amount?: number; 
          balance?: number 
        }>;
      };
      
      // Transform to our format
      // API returns either 'accounts' or 'holders' array
      const accountsArray = data.accounts || data.holders || [];
      const holders: Holder[] = accountsArray.map((h: any) => ({
        address: h.wallet || h.owner || h.address || '',
        balance: h.amount || h.balance || 0,
      }));

      return holders;
    } catch (error) {
      console.error('Error fetching holders:', error);
      return [];
    }
  }

  async getTokenInfo(mint: string): Promise<TokenInfo | null> {
    try {
      const url = `${SOLTRACKER_API}/tokens/${mint}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      if (API_KEY) {
        headers["x-api-key"] = API_KEY;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        console.warn(`Failed to fetch token info for ${mint}: ${response.status}`);
        return null;
      }

      const data = await response.json() as {
        mint?: string;
        token?: {
          name?: string;
          symbol?: string;
          image?: string;
          description?: string;
        };
        name?: string;
        symbol?: string;
        image?: string;
        description?: string;
        holders?: number;
        pools?: Array<{
          price?: { usd?: number };
          marketCap?: { usd?: number };
          liquidity?: { usd?: number };
          volume?: { h24?: number };
        }>;
      };
      const pools = data.pools || [];
      const pool = pools[0]; // Get first pool
      
      // Extract token metadata (can be in 'token' object or root)
      const tokenData = data.token || data;

      return {
        mint: data.mint || mint,
        name: tokenData.name || data.name || "Unknown",
        symbol: tokenData.symbol || data.symbol || "???",
        price_usd: pool?.price?.usd || 0,
        marketCap: pool?.marketCap?.usd || 0,
        liquidity: pool?.liquidity?.usd || 0,
        volume24h: pool?.volume?.h24 || 0,
        holders: data.holders || 0,
        image: tokenData.image || data.image,
        description: tokenData.description || data.description,
      };
    } catch (error) {
      console.error('Error fetching token info:', error);
      return null;
    }
  }

  async getSOLPrice(): Promise<number> {
    try {
      // Get SOL price from a reliable source
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json() as { solana?: { usd?: number } };
      return data?.solana?.usd || 0;
    } catch (error) {
      console.error('Error fetching SOL price:', error);
      return 0;
    }
  }
}

export const solTrackerClient = new SolTrackerClient();
