/**
 * Solana Tracker API Client
 * 
 * Fetches token information including images from Solana Tracker
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

export interface SolanaTrackerTokenInfo {
  token: {
    name: string;
    symbol: string;
    mint: string;
    uri: string;
    decimals: number;
    description: string;
    image: string;
    hasFileMetaData: boolean;
  };
}

/**
 * Get token info from Solana Tracker API
 */
export async function getTokenInfo(tokenAddress: string): Promise<SolanaTrackerTokenInfo | null> {
  const apiKey = process.env.SOLANA_TRACKER_API_KEY || 'df52fd6e-4088-4963-b08c-5e8ab839726a';
  
  const options = {
    method: 'GET',
    headers: { 'x-api-key': apiKey }
  };

  try {
    const response = await fetch(`https://data.solanatracker.io/tokens/${tokenAddress}`, options);
    
    if (!response.ok) {
      console.warn(`⚠️ Solana Tracker API error for ${tokenAddress}: ${response.statusText}`);
      return null;
    }
    
    const data = await response.json() as SolanaTrackerTokenInfo;
    return data;
  } catch (error) {
    console.error(`❌ Failed to fetch token info from Solana Tracker:`, error);
    return null;
  }
}

/**
 * Get token image URL from Solana Tracker
 */
export async function getTokenImageUrl(tokenAddress: string): Promise<string | null> {
  const tokenInfo = await getTokenInfo(tokenAddress);
  
  if (!tokenInfo?.token?.image) {
    return null;
  }
  
  return tokenInfo.token.image;
}

/**
 * Search for token by symbol and get image
 */
export async function getTokenImageBySymbol(symbol: string, tokenAddress?: string): Promise<string | null> {
  // If we have a token address, use it directly
  if (tokenAddress) {
    return getTokenImageUrl(tokenAddress);
  }
  
  // Otherwise, we would need to search (Solana Tracker doesn't have a symbol search endpoint)
  // For now, return null if no address provided
  console.warn(`⚠️ Cannot fetch token image for ${symbol} without token address`);
  return null;
}
