/**
 * Research MCP Tools
 * 
 * Exposes research module functionality as MCP tools for Clawdbot
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { metaAnalyzer, MarketMeta } from '../research/meta-analyzer.js';
import { twitterClient } from '../research/twitter-client.js';
import { patternAnalyzer, TokenPatterns } from '../research/pattern-analyzer.js';
import { opportunityFinder, Opportunity } from '../research/opportunity-finder.js';

/**
 * MCP Tool: scan_market_meta
 * Analyze the current memecoin market meta
 */
export const scanMarketMetaTool: Tool = {
  name: 'scan_market_meta',
  description: `Analyze the current memecoin market meta by detecting:
    - Saturated themes (>8 tokens, avoid these)
    - Emerging themes (2-5 tokens, opportunities)
    - Successful naming patterns
    - Successful symbol patterns
    
    Call this tool first in every scan cycle to understand the market state.
    Returns structured market intelligence for decision-making.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export async function handleScanMarketMeta(): Promise<MarketMeta> {
  console.log('🔧 MCP Tool: scan_market_meta');
  return await metaAnalyzer.analyzeMarketMeta();
}

/**
 * MCP Tool: find_twitter_opportunities
 * Search Twitter for viral tokenizable moments based on market meta
 */
export const findTwitterOpportunitiesTool: Tool = {
  name: 'find_twitter_opportunities',
  description: `Adaptively search Twitter.io for viral, tokenizable moments.
    
    Strategy depends on market meta:
    - If theme is SATURATED: Find specific viral moments (e.g., Clawd quotes)
    - If theme is EMERGING: Validate trend with Twitter virality
    
    Returns tokenizable concepts with virality scores.
    Use this when market meta shows saturation (need specific angles).`,
  inputSchema: {
    type: 'object',
    properties: {
      saturated_themes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Themes that are saturated from scan_market_meta'
      },
      emerging_themes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Themes that are emerging from scan_market_meta'
      },
      min_engagement: {
        type: 'number',
        description: 'Minimum engagement (likes + retweets) for viral tweets',
        default: 1000
      }
    },
    required: []
  }
};

export interface TwitterOpportunitiesArgs {
  saturated_themes?: string[];
  emerging_themes?: string[];
  min_engagement?: number;
}

export interface TwitterOpportunity {
  type: 'specific_moment' | 'emerging_trend';
  source: string;
  tweet?: string;
  tweetUrl?: string;
  tokenizableConcept?: string;
  viralityScore: number;
  theme?: string;
  reasoning: string;
}

export async function handleFindTwitterOpportunities(
  args: TwitterOpportunitiesArgs
): Promise<TwitterOpportunity[]> {
  console.log('🔧 MCP Tool: find_twitter_opportunities');
  
  const opportunities: TwitterOpportunity[] = [];
  const minEngagement = args.min_engagement || 1000;

  // Strategy 1: If Clawd/AI saturated, find specific moments
  const saturatedThemes = args.saturated_themes || [];
  if (saturatedThemes.includes('Clawd') || saturatedThemes.includes('AI Agent')) {
    console.log('🔍 Looking for Clawd viral moments...');
    const clawdMoments = await twitterClient.findClawdMoments(minEngagement);
    
    for (const moment of clawdMoments.slice(0, 5)) {
      opportunities.push({
        type: 'specific_moment',
        source: 'clawd_viral_quote',
        tweet: moment.tweet.text,
        tweetUrl: moment.tweet.url,
        tokenizableConcept: moment.tokenizableConcept,
        viralityScore: moment.viralityScore,
        reasoning: moment.reasoning,
      });
    }
  }

  // Strategy 2: Validate emerging themes
  const emergingThemes = args.emerging_themes || [];
  for (const theme of emergingThemes.slice(0, 3)) {
    console.log(`🌱 Validating emerging theme: ${theme}...`);
    const moments = await twitterClient.validateEmergingTheme(theme, minEngagement / 2);
    
    for (const moment of moments.slice(0, 3)) {
      opportunities.push({
        type: 'emerging_trend',
        source: `emerging_${theme.toLowerCase().replace(/\s+/g, '_')}`,
        tweet: moment.tweet.text,
        tweetUrl: moment.tweet.url,
        viralityScore: moment.viralityScore,
        theme,
        reasoning: moment.reasoning,
      });
    }
  }

  // Strategy 3: If no specific themes, look for general crypto viral moments
  if (opportunities.length === 0) {
    console.log('🔍 Looking for general crypto viral moments...');
    const cryptoMoments = await twitterClient.findCryptoViralMoments(minEngagement);
    
    for (const moment of cryptoMoments.slice(0, 5)) {
      opportunities.push({
        type: 'specific_moment',
        source: 'crypto_viral',
        tweet: moment.tweet.text,
        tweetUrl: moment.tweet.url,
        tokenizableConcept: moment.tokenizableConcept,
        viralityScore: moment.viralityScore,
        reasoning: moment.reasoning,
      });
    }
  }

  // Sort by virality score
  return opportunities.sort((a, b) => b.viralityScore - a.viralityScore);
}

/**
 * MCP Tool: analyze_token_patterns
 * Analyze patterns in recently successful tokens
 */
export const analyzeTokenPatternsTool: Tool = {
  name: 'analyze_token_patterns',
  description: `Analyze patterns in recently successful tokens (>$50k mcap).
    
    Returns common patterns in:
    - Token names (e.g., "Agent", "Max", "AI")
    - Symbols (e.g., AI suffix, animal prefixes)
    - Image aesthetics (e.g., futuristic, neon, cartoon)
    
    Use this when no viral Twitter moments found.
    Provides data-driven patterns for pattern-based deployments.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export async function handleAnalyzeTokenPatterns(): Promise<TokenPatterns> {
  console.log('🔧 MCP Tool: analyze_token_patterns');
  return await patternAnalyzer.analyzePatterns();
}

/**
 * MCP Tool: find_all_opportunities
 * Combined analysis - runs full opportunity finder
 */
export const findAllOpportunitiesTool: Tool = {
  name: 'find_all_opportunities',
  description: `Run complete opportunity analysis combining:
    - Market meta analysis (saturation, emerging themes)
    - Twitter viral moments (specific moments, emerging validation)
    - Pattern analysis (fallback when no viral moments)
    
    Returns ranked list of all opportunities with confidence scores.
    This is a comprehensive scan - use for full analysis.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export interface AllOpportunitiesResult {
  marketMeta: {
    saturatedThemes: string[];
    emergingThemes: string[];
    recommendation: string;
  };
  opportunities: Opportunity[];
  bestOpportunity: Opportunity | null;
  shouldDeploy: boolean;
  reasoning: string;
}

export async function handleFindAllOpportunities(): Promise<AllOpportunitiesResult> {
  console.log('🔧 MCP Tool: find_all_opportunities');
  
  const analysis = await opportunityFinder.findOpportunities();
  
  // Determine if we should deploy
  const shouldDeploy = analysis.bestOpportunity !== null && 
                       analysis.bestOpportunity.confidence >= 70;
  
  let reasoning: string;
  if (shouldDeploy && analysis.bestOpportunity) {
    reasoning = `High confidence opportunity found: ${analysis.bestOpportunity.type} with ${analysis.bestOpportunity.confidence}% confidence. ${analysis.bestOpportunity.reasoning}`;
  } else if (analysis.bestOpportunity) {
    reasoning = `Best opportunity (${analysis.bestOpportunity.type}) has only ${analysis.bestOpportunity.confidence}% confidence. Consider waiting for better moment.`;
  } else {
    reasoning = 'No clear opportunities found. Market may be unclear or all themes saturated without viral moments.';
  }

  return {
    marketMeta: {
      saturatedThemes: analysis.marketMeta.saturatedThemes,
      emergingThemes: analysis.marketMeta.emergingThemes,
      recommendation: analysis.marketMeta.recommendation,
    },
    opportunities: analysis.opportunities,
    bestOpportunity: analysis.bestOpportunity,
    shouldDeploy,
    reasoning,
  };
}

/**
 * Export all research tools
 */
export const RESEARCH_TOOLS: Tool[] = [
  scanMarketMetaTool,
  findTwitterOpportunitiesTool,
  analyzeTokenPatternsTool,
  findAllOpportunitiesTool,
];

/**
 * Route research tool calls to handlers
 */
export async function executeResearchToolCall(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'scan_market_meta':
      return await handleScanMarketMeta();
    case 'find_twitter_opportunities':
      return await handleFindTwitterOpportunities(args);
    case 'analyze_token_patterns':
      return await handleAnalyzeTokenPatterns();
    case 'find_all_opportunities':
      return await handleFindAllOpportunities();
    default:
      throw new Error(`Unknown research tool: ${toolName}`);
  }
}
