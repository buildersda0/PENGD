/**
 * Deployment MCP Tools
 * 
 * Exposes deployment functionality and rolling summary as MCP tools for Clawdbot
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { launchToken, LaunchTokenRequest } from '../clients/pumpportal.js';
import { generateTokenImage, isOpenAIConfigured } from '../clients/openai.js';
import { summaryManager, RollingSummary, DeploymentRecord } from '../services/summary-manager.js';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { keypairFromPrivateKey } from '../utils/wallet.js';
import database from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

const MIN_WALLET_RESERVE = 0.3; // Minimum SOL to keep in wallet
const MIN_DEPLOYMENT_INTERVAL = 4 * 60 * 1000; // 4 minutes between deployments
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com/";

// Track last deployment time
let lastDeploymentTime = 0;

// In-memory cache of deployed tweet IDs (refreshed periodically)
let deployedTweetIds: Set<string> = new Set();
let lastTweetIdCacheRefresh = 0;
const TWEET_ID_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Extract tweet ID from a tweet URL
 * Handles both x.com and twitter.com URLs
 */
function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Refresh the deployed tweet IDs cache from database
 */
async function refreshDeployedTweetIds(): Promise<void> {
  try {
    // Get all deployments from MongoDB
    const db = database.getDb();
    const deploymentsCol = db.collection('deployments');
    const deployments = await deploymentsCol.find({
      'metadata.tweet_url': { $exists: true, $ne: null }
    }).toArray();

    deployedTweetIds = new Set();
    for (const deployment of deployments) {
      const tweetUrl = deployment.metadata?.tweet_url;
      if (tweetUrl) {
        const tweetId = extractTweetId(tweetUrl);
        if (tweetId) {
          deployedTweetIds.add(tweetId);
        }
      }
    }
    lastTweetIdCacheRefresh = Date.now();
    console.log(`📋 Refreshed deployed tweet cache: ${deployedTweetIds.size} tweets`);
  } catch (error) {
    console.error('Failed to refresh deployed tweet IDs:', error);
  }
}

/**
 * Check if a tweet has already been tokenized
 */
async function checkTweetAlreadyTokenized(tweetUrl: string): Promise<{ exists: boolean; existingToken?: string }> {
  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) {
    return { exists: false };
  }

  // Refresh cache if stale
  if (Date.now() - lastTweetIdCacheRefresh > TWEET_ID_CACHE_TTL) {
    await refreshDeployedTweetIds();
  }

  // Quick check against cache
  if (deployedTweetIds.has(tweetId)) {
    // Confirm with database lookup for the token name
    try {
      const db = database.getDb();
      const deploymentsCol = db.collection('deployments');
      const existing = await deploymentsCol.findOne({
        'metadata.tweet_url': { $regex: tweetId }
      });
      if (existing) {
        return { 
          exists: true, 
          existingToken: `${existing.name} ($${existing.symbol})` 
        };
      }
    } catch (error) {
      // Cache said yes, assume it's correct
      return { exists: true, existingToken: 'Unknown token' };
    }
  }

  // Double-check database directly in case cache is stale
  try {
    const db = database.getDb();
    const deploymentsCol = db.collection('deployments');
    const existing = await deploymentsCol.findOne({
      'metadata.tweet_url': { $regex: tweetId }
    });
    if (existing) {
      // Update cache
      deployedTweetIds.add(tweetId);
      return { 
        exists: true, 
        existingToken: `${existing.name} ($${existing.symbol})` 
      };
    }
  } catch (error) {
    console.error('Failed to check database for duplicate tweet:', error);
  }

  return { exists: false };
}

/**
 * MCP Tool: get_rolling_summary
 * Get the agent's learning history
 */
export const getRollingSummaryTool: Tool = {
  name: 'get_rolling_summary',
  description: `Get the rolling summary of past deployments and learnings.
    
    Returns:
    - Summary text (AI-compressed learnings)
    - Statistics (total deployed, profitable, loss, profit)
    - Per-strategy performance (specific_moment, emerging_trend, pattern_based)
    - Key learnings extracted from history
    
    Use this to validate decisions against historical performance.
    Always call before deploying to learn from past mistakes.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export async function handleGetRollingSummary(): Promise<RollingSummary> {
  console.log('🔧 MCP Tool: get_rolling_summary');
  return await summaryManager.getRollingSummary();
}

/**
 * MCP Tool: get_wallet_balance
 * Check current wallet balance
 */
export const getWalletBalanceTool: Tool = {
  name: 'get_wallet_balance',
  description: `Check the current wallet balance in SOL.
    
    Returns:
    - balance_sol: Current SOL balance
    - available_for_deployment: Balance minus reserve
    - can_deploy: Whether balance is sufficient for deployment
    - reserve_amount: Amount kept as minimum reserve
    
    Call this before deployment to ensure sufficient funds.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export interface WalletBalanceResult {
  balance_sol: number;
  available_for_deployment: number;
  can_deploy: boolean;
  reserve_amount: number;
  wallet_address: string;
}

export async function handleGetWalletBalance(): Promise<WalletBalanceResult> {
  console.log('🔧 MCP Tool: get_wallet_balance');
  
  const privateKey = process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('AGENT_PRIVATE_KEY not configured');
  }

  const keypair = keypairFromPrivateKey(privateKey);
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;
  const available = Math.max(0, balanceSOL - MIN_WALLET_RESERVE);

  return {
    balance_sol: balanceSOL,
    available_for_deployment: available,
    can_deploy: available >= 0.05, // Minimum for deployment + fees
    reserve_amount: MIN_WALLET_RESERVE,
    wallet_address: keypair.publicKey.toBase58(),
  };
}

/**
 * MCP Tool: deploy_token
 * Deploy a new token on pump.fun
 */
export const deployTokenTool: Tool = {
  name: 'deploy_token',
  description: `Deploy a new token on pump.fun.
    
    This tool will:
    1. Generate an image using OpenAI DALL-E 3
    2. Upload metadata to Pump.fun IPFS
    3. Deploy the token via PumpPortal
    4. Track the deployment in MongoDB
    
    Safety checks:
    - Wallet balance must be > 0.3 SOL reserve + deployment amount
    - Minimum 4 minutes between deployments
    - Only deploy when confidence > 70%
    
    Returns deployment result with mint address and transaction.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Token name (e.g., "Lobster Way")'
      },
      symbol: {
        type: 'string',
        description: 'Token symbol (3-6 chars, e.g., "LBSTR")'
      },
      description: {
        type: 'string',
        description: 'Token description'
      },
      theme: {
        type: 'string',
        description: 'Theme/concept for image generation (e.g., "cute lobster mascot with sunglasses")'
      },
      strategy: {
        type: 'string',
        enum: ['specific_moment', 'emerging_trend', 'pattern_based'],
        description: 'Strategy used for this deployment'
      },
      confidence_score: {
        type: 'number',
        description: 'Confidence score (0-100)',
        minimum: 0,
        maximum: 100
      },
      initial_buy_sol: {
        type: 'number',
        description: 'Initial buy amount in SOL (default 0.05)',
        minimum: 0.01,
        default: 0.05
      },
      image_style: {
        type: 'string',
        enum: ['cartoon', 'realistic', 'pixel', 'neon', 'minimalist'],
        description: 'Image style for generation (default: cartoon)'
      },
      tweet_url: {
        type: 'string',
        description: 'Optional: URL of viral tweet if using specific_moment strategy'
      },
      virality_score: {
        type: 'number',
        description: 'Optional: Virality score from Twitter if applicable'
      }
    },
    required: ['name', 'symbol', 'description', 'theme', 'strategy']
  }
};

export interface DeployTokenArgs {
  name: string;
  symbol: string;
  description: string;
  theme: string;
  strategy: 'specific_moment' | 'emerging_trend' | 'pattern_based';
  confidence_score?: number;
  initial_buy_sol?: number;
  image_style?: 'cartoon' | 'realistic' | 'pixel' | 'neon' | 'minimalist';
  tweet_url?: string;
  virality_score?: number;
}

export interface DeploymentResult {
  success: boolean;
  mint?: string;
  signature?: string;
  url?: string;
  error?: string;
  deployment_id?: string;
}

export async function handleDeployToken(args: DeployTokenArgs): Promise<DeploymentResult> {
  console.log('🔧 MCP Tool: deploy_token');
  console.log(`🚀 Deploying: ${args.name} (${args.symbol})`);

  // Safety check 0: Duplicate tweet prevention
  if (args.tweet_url) {
    const duplicateCheck = await checkTweetAlreadyTokenized(args.tweet_url);
    if (duplicateCheck.exists) {
      console.warn(`⚠️ Tweet already tokenized: ${duplicateCheck.existingToken}`);
      return {
        success: false,
        error: `This tweet has already been tokenized as "${duplicateCheck.existingToken}". ` +
               `Tweet URL: ${args.tweet_url}`,
      };
    }
  }

  // Safety check 1: Minimum interval between deployments
  const timeSinceLastDeployment = Date.now() - lastDeploymentTime;
  if (lastDeploymentTime > 0 && timeSinceLastDeployment < MIN_DEPLOYMENT_INTERVAL) {
    const waitSeconds = Math.ceil((MIN_DEPLOYMENT_INTERVAL - timeSinceLastDeployment) / 1000);
    return {
      success: false,
      error: `Too soon since last deployment. Wait ${waitSeconds} seconds.`,
    };
  }

  // Safety check 2: Confidence score
  const confidence = args.confidence_score || 70;
  if (confidence < 60) {
    return {
      success: false,
      error: `Confidence too low (${confidence}%). Minimum 60% required.`,
    };
  }

  // Get private key
  const privateKey = process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    return {
      success: false,
      error: 'AGENT_PRIVATE_KEY not configured',
    };
  }

  // Safety check 3: Wallet balance
  const balanceResult = await handleGetWalletBalance();
  const initialBuy = args.initial_buy_sol || 0.05;
  
  if (!balanceResult.can_deploy) {
    return {
      success: false,
      error: `Insufficient balance: ${balanceResult.balance_sol.toFixed(4)} SOL. ` +
             `Need at least ${MIN_WALLET_RESERVE + 0.05} SOL.`,
    };
  }

  if (balanceResult.available_for_deployment < initialBuy) {
    return {
      success: false,
      error: `Not enough available SOL. Available: ${balanceResult.available_for_deployment.toFixed(4)}, ` +
             `Needed: ${initialBuy}`,
    };
  }

  try {
    // Step 1: Generate image
    console.log('🎨 Generating token image...');
    let imageUrl: string;
    
    if (isOpenAIConfigured()) {
      imageUrl = await generateTokenImage({
        theme: args.theme,
        style: args.image_style || 'cartoon',
      });
    } else {
      // Fallback: use a placeholder image service
      console.warn('⚠️ OpenAI not configured, using placeholder image');
      imageUrl = `https://via.placeholder.com/512/7C3AED/FFFFFF?text=${encodeURIComponent(args.symbol)}`;
    }

    // Step 2: Launch token
    console.log('🚀 Launching token on pump.fun...');
    const launchRequest: LaunchTokenRequest = {
      name: args.name,
      symbol: args.symbol.toUpperCase().substring(0, 6),
      description: args.description,
      imageUrl,
      initialBuyAmount: initialBuy,
    };

    const result = await launchToken(privateKey, launchRequest);

    if (result.error) {
      return {
        success: false,
        error: result.error,
      };
    }

    // Step 3: Record deployment
    const deploymentRecord: Omit<DeploymentRecord, '_id'> = {
      mint: result.mint!,
      name: args.name,
      symbol: args.symbol,
      theme: args.theme,
      strategy: args.strategy,
      deployed_at: new Date(),
      initial_buy_sol: initialBuy,
      performance: {
        current_market_cap: 0,
        peak_market_cap: 0,
        holders: 0,
        fees_collected: 0,
        profit_sol: 0,
        outcome: 'active',
      },
      metadata: {
        tweet_url: args.tweet_url,
        virality_score: args.virality_score,
        confidence_score: confidence,
        reasoning: `Deployed using ${args.strategy} strategy`,
      },
    };

    await summaryManager.recordDeployment(deploymentRecord);

    // Update last deployment time
    lastDeploymentTime = Date.now();

    console.log(`✅ Token deployed successfully!`);
    console.log(`   Mint: ${result.mint}`);
    console.log(`   URL: https://pump.fun/${result.mint}`);

    return {
      success: true,
      mint: result.mint,
      signature: result.signature,
      url: `https://pump.fun/${result.mint}`,
      deployment_id: result.mint,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Deployment failed:', error);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * MCP Tool: get_recent_deployments
 * Get recent deployment history
 */
export const getRecentDeploymentsTool: Tool = {
  name: 'get_recent_deployments',
  description: `Get the most recent token deployments with their performance data.
    
    Returns list of recent deployments with:
    - Token info (name, symbol, mint)
    - Strategy used
    - Performance (market cap, holders, profit)
    - Outcome (active, profitable, loss)
    
    Use this to review recent activity and performance.`,
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of deployments to return (default: 5)',
        default: 5,
        minimum: 1,
        maximum: 20
      }
    },
    required: []
  }
};

export async function handleGetRecentDeployments(args: { limit?: number }): Promise<DeploymentRecord[]> {
  console.log('🔧 MCP Tool: get_recent_deployments');
  return await summaryManager.getRecentDeployments(args.limit || 5);
}

/**
 * MCP Tool: can_deploy_now
 * Check if deployment is currently allowed
 */
export const canDeployNowTool: Tool = {
  name: 'can_deploy_now',
  description: `Check if deployment is currently allowed based on all safety checks.
    
    Checks:
    - Time since last deployment (must be > 4 minutes)
    - Wallet balance (must be sufficient)
    - API keys configured (OpenAI, PumpPortal)
    
    Returns boolean and reason if blocked.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export interface CanDeployResult {
  can_deploy: boolean;
  reasons: string[];
  time_until_allowed_seconds?: number;
  wallet_balance_sol?: number;
}

export async function handleCanDeployNow(): Promise<CanDeployResult> {
  console.log('🔧 MCP Tool: can_deploy_now');
  
  const reasons: string[] = [];
  let canDeploy = true;

  // Check time since last deployment
  const timeSinceLast = Date.now() - lastDeploymentTime;
  if (lastDeploymentTime > 0 && timeSinceLast < MIN_DEPLOYMENT_INTERVAL) {
    canDeploy = false;
    const waitSeconds = Math.ceil((MIN_DEPLOYMENT_INTERVAL - timeSinceLast) / 1000);
    reasons.push(`Must wait ${waitSeconds} more seconds since last deployment`);
  }

  // Check wallet balance
  try {
    const balance = await handleGetWalletBalance();
    if (!balance.can_deploy) {
      canDeploy = false;
      reasons.push(`Insufficient balance: ${balance.balance_sol.toFixed(4)} SOL`);
    }
  } catch (error) {
    canDeploy = false;
    reasons.push('Failed to check wallet balance');
  }

  // Check API keys
  const privateKey = process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    canDeploy = false;
    reasons.push('AGENT_PRIVATE_KEY not configured');
  }

  if (!isOpenAIConfigured()) {
    // Not a blocker, but note it
    reasons.push('OpenAI not configured - will use placeholder images');
  }

  if (canDeploy && reasons.length === 0) {
    reasons.push('All checks passed');
  }

  return {
    can_deploy: canDeploy,
    reasons,
    time_until_allowed_seconds: lastDeploymentTime > 0 
      ? Math.max(0, Math.ceil((MIN_DEPLOYMENT_INTERVAL - timeSinceLast) / 1000))
      : 0,
  };
}

/**
 * Export all deployment tools
 */
export const DEPLOYMENT_TOOLS: Tool[] = [
  getRollingSummaryTool,
  getWalletBalanceTool,
  deployTokenTool,
  getRecentDeploymentsTool,
  canDeployNowTool,
];

/**
 * Route deployment tool calls to handlers
 */
export async function executeDeploymentToolCall(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'get_rolling_summary':
      return await handleGetRollingSummary();
    case 'get_wallet_balance':
      return await handleGetWalletBalance();
    case 'deploy_token':
      return await handleDeployToken(args);
    case 'get_recent_deployments':
      return await handleGetRecentDeployments(args);
    case 'can_deploy_now':
      return await handleCanDeployNow();
    default:
      throw new Error(`Unknown deployment tool: ${toolName}`);
  }
}
