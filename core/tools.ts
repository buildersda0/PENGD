import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Coin } from '../models/coin.js';
import {
  executeClaimFees,
  executeBuyback,
  executeBurnTokens,
  executeAirdropSol,
  executeAirdropTokens,
  executeSendSolToTreasury,
  executeSendTokensToTreasury,
  ExecutionResult
} from '../engine/executor.js';
import { solTrackerClient } from '../clients/soltracker.js';
import database from '../database.js';

// Import research, deployment, and twitter tools
import { RESEARCH_TOOLS, executeResearchToolCall } from './research-tools.js';
import { DEPLOYMENT_TOOLS, executeDeploymentToolCall } from './deployment-tools.js';
import { TWITTER_TOOLS, executeTwitterToolCall } from './twitter-tools.js';

/**
 * MCP Tool Definitions
 * Exposes agent actions as callable MCP tools
 */

// Coin management tools (existing)
const COIN_TOOLS: Tool[] = [
  {
    name: 'get_coin_state',
    description: 'Get current state and statistics for a token including fees, holders, market cap, and agent balance',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        }
      },
      required: ['coin_mint']
    }
  },
  {
    name: 'buyback',
    description: 'Buy tokens using SOL from the market to add to agent holdings',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        },
        amount_sol: {
          type: 'number',
          description: 'Amount of SOL to spend on buyback',
          minimum: 0.03
        }
      },
      required: ['coin_mint', 'amount_sol']
    }
  },
  {
    name: 'burn_tokens',
    description: 'Burn tokens the agent currently holds to reduce supply permanently',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        },
        percentage: {
          type: 'number',
          description: 'Percentage of held tokens to burn (1-100)',
          minimum: 1,
          maximum: 100
        }
      },
      required: ['coin_mint', 'percentage']
    }
  },
  {
    name: 'airdrop_sol',
    description: 'Distribute SOL rewards to token holders proportionally based on their holdings',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        },
        amount_sol: {
          type: 'number',
          description: 'Total amount of SOL to distribute',
          minimum: 0.03
        }
      },
      required: ['coin_mint', 'amount_sol']
    }
  },
  {
    name: 'airdrop_tokens',
    description: 'Distribute held tokens to token holders proportionally based on their holdings',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        },
        percentage: {
          type: 'number',
          description: 'Percentage of held tokens to airdrop (1-100)',
          minimum: 1,
          maximum: 100
        }
      },
      required: ['coin_mint', 'percentage']
    }
  },
  {
    name: 'send_sol_to_treasury',
    description: 'Send SOL to the project treasury wallet for strategic activities like DexScreener boosts ($99-$3999), marketing campaigns, or development. The treasury owner can use these funds to purchase visibility boosts and grow the token.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        },
        amount_sol: {
          type: 'number',
          description: 'Amount of SOL to send to treasury',
          minimum: 0.03
        }
      },
      required: ['coin_mint', 'amount_sol']
    }
  },
  {
    name: 'send_tokens_to_treasury',
    description: 'Send held tokens to the project treasury wallet',
    inputSchema: {
      type: 'object',
      properties: {
        coin_mint: {
          type: 'string',
          description: 'Token mint address'
        },
        percentage: {
          type: 'number',
          description: 'Percentage of held tokens to send (1-100)',
          minimum: 1,
          maximum: 100
        }
      },
      required: ['coin_mint', 'percentage']
    }
  }
];

/**
 * Combined MCP Tools - All available tools for agents
 */
export const MCP_TOOLS: Tool[] = [
  ...COIN_TOOLS,
  ...RESEARCH_TOOLS,
  ...DEPLOYMENT_TOOLS,
  ...TWITTER_TOOLS,
];

/**
 * Tool execution handlers
 */

export async function handleGetCoinState(args: any): Promise<any> {
  const { coin_mint } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  // Fetch current data
  const [tokenInfo, holders] = await Promise.all([
    solTrackerClient.getTokenInfo(coin_mint),
    solTrackerClient.getHolders(coin_mint)
  ]);

  return {
    name: coin.name,
    symbol: coin.symbol,
    mint: coin_mint,
    status: coin.status,
    market_cap: tokenInfo?.marketCap || 0,
    holders: holders.length,
    stats: coin.stats,
    enabled_actions: coin.enabled_actions
  };
}

export async function handleBuyback(args: any): Promise<ExecutionResult> {
  const { coin_mint, amount_sol } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  if (!coin.enabled_actions?.buyback) {
    throw new Error('Buyback action is not enabled for this coin');
  }

  return await executeBuyback(coin, amount_sol);
}

export async function handleBurnTokens(args: any): Promise<ExecutionResult> {
  const { coin_mint, percentage } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  if (!coin.enabled_actions?.burn) {
    throw new Error('Burn action is not enabled for this coin');
  }

  return await executeBurnTokens(coin, percentage);
}

export async function handleAirdropSol(args: any): Promise<ExecutionResult> {
  const { coin_mint, amount_sol } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  if (!coin.enabled_actions?.airdrop_sol) {
    throw new Error('Airdrop SOL action is not enabled for this coin');
  }

  const holders = await solTrackerClient.getHolders(coin_mint);
  
  return await executeAirdropSol(coin, amount_sol, holders);
}

export async function handleAirdropTokens(args: any): Promise<ExecutionResult> {
  const { coin_mint, percentage } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  if (!coin.enabled_actions?.airdrop_tokens) {
    throw new Error('Airdrop tokens action is not enabled for this coin');
  }

  const holders = await solTrackerClient.getHolders(coin_mint);
  
  return await executeAirdropTokens(coin, percentage, holders);
}

export async function handleSendSolToTreasury(args: any): Promise<ExecutionResult> {
  const { coin_mint, amount_sol } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  if (!coin.enabled_actions?.treasury_sol) {
    throw new Error('Send SOL to treasury action is not enabled for this coin');
  }

  if (!coin.treasury_wallet) {
    throw new Error('Treasury wallet is not configured for this coin. Please set a treasury wallet before using treasury actions.');
  }

  return await executeSendSolToTreasury(coin, amount_sol);
}

export async function handleSendTokensToTreasury(args: any): Promise<ExecutionResult> {
  const { coin_mint, percentage } = args;
  
  const coinsCollection = database.getCollection<Coin>('coins');
  const coin = await coinsCollection.findOne({ mint: coin_mint });
  
  if (!coin) {
    throw new Error(`Coin ${coin_mint} not found`);
  }

  if (!coin.enabled_actions?.treasury_tokens) {
    throw new Error('Send tokens to treasury action is not enabled for this coin');
  }

  if (!coin.treasury_wallet) {
    throw new Error('Treasury wallet is not configured for this coin. Please set a treasury wallet before using treasury actions.');
  }

  return await executeSendTokensToTreasury(coin, percentage);
}

/**
 * Route tool calls to appropriate handlers
 */
export async function executeToolCall(toolName: string, args: any): Promise<any> {
  // Coin management tools
  switch (toolName) {
    case 'get_coin_state':
      return await handleGetCoinState(args);
    case 'buyback':
      return await handleBuyback(args);
    case 'burn_tokens':
      return await handleBurnTokens(args);
    case 'airdrop_sol':
      return await handleAirdropSol(args);
    case 'airdrop_tokens':
      return await handleAirdropTokens(args);
    case 'send_sol_to_treasury':
      return await handleSendSolToTreasury(args);
    case 'send_tokens_to_treasury':
      return await handleSendTokensToTreasury(args);
  }

  // Research tools
  const researchTools = ['scan_market_meta', 'find_twitter_opportunities', 'analyze_token_patterns', 'find_all_opportunities'];
  if (researchTools.includes(toolName)) {
    return await executeResearchToolCall(toolName, args);
  }

  // Deployment tools
  const deploymentTools = ['get_rolling_summary', 'get_wallet_balance', 'deploy_token', 'get_recent_deployments', 'can_deploy_now'];
  if (deploymentTools.includes(toolName)) {
    return await executeDeploymentToolCall(toolName, args);
  }

  // Twitter tools
  const twitterTools = ['search_twitter_custom', 'search_twitter_fresh', 'get_tweet_details'];
  if (twitterTools.includes(toolName)) {
    return await executeTwitterToolCall(toolName, args);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}
