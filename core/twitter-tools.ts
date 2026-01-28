/**
 * Twitter MCP Tools - Direct Twitter Search Control for Clawd
 * 
 * These tools allow the AI agent to directly control Twitter searches,
 * enabling iterative exploration and refinement of queries based on results.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { twitterClient, TWITTER_CONFIG, Tweet, ViralMoment } from '../research/twitter-client.js';

/**
 * Twitter Tool Definitions
 */
export const TWITTER_TOOLS: Tool[] = [
  {
    name: 'search_twitter_custom',
    description: `Search Twitter with custom query parameters for direct exploration.

Use this tool when:
- You want to explore specific angles not covered by standard scans
- You need to refine a search based on initial results
- You want to search with specific time windows or engagement thresholds

Parameters:
- query: Twitter search query (supports Twitter operators like "phrase" OR keyword -exclude)
- queryType: 'Latest' for fresh content, 'Top' for most engaging
- hoursAgo: Time window (24, 48, 72, 168 for 1 week, 336 for 2 weeks)
- maxPages: 1-10 pages (each ~20-50 tweets)
- minEngagement: Minimum likes + retweets

Example queries:
- "viral moment" -crypto -pump (find original viral content)
- "just said" meme funny (find quotable moments)
- #trending topic (find trending discussions)`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Twitter search query. Use Twitter operators: "exact phrase", OR, -exclude, #hashtag, @mention'
        },
        queryType: {
          type: 'string',
          enum: ['Top', 'Latest'],
          description: 'Search mode: "Latest" for fresh content (newest first), "Top" for most engaging'
        },
        hoursAgo: {
          type: 'number',
          description: 'Time window in hours. 24=1day, 48=2days, 168=1week, 336=2weeks. Default: 48',
          minimum: 1,
          maximum: 336
        },
        maxPages: {
          type: 'number',
          description: 'Number of pages to fetch (1-10). Each page ~20-50 tweets. Default: 5',
          minimum: 1,
          maximum: 10
        },
        minEngagement: {
          type: 'number',
          description: 'Minimum total engagement (likes + retweets). Default: 100',
          minimum: 0
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_twitter_fresh',
    description: `Search Twitter for the FRESHEST viral content (last 24-48 hours).
    
Optimized for catching viral moments as they emerge, before they're tokenized.
Uses 'Latest' search mode and prioritizes recency over engagement.

Best for:
- Finding breaking viral content
- Catching trends before saturation
- Discovering quotable moments from last 24-48h`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Twitter search query'
        },
        hoursAgo: {
          type: 'number',
          description: 'Time window in hours (default: 48)',
          minimum: 1,
          maximum: 168
        },
        minEngagement: {
          type: 'number',
          description: 'Minimum engagement - lower for fresh content (default: 100)',
          minimum: 0
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_tweet_details',
    description: `Get detailed analysis of a specific tweet URL for tokenization potential.
    
Returns:
- Full tweet content
- Author info and credibility
- Engagement metrics
- Tokenization potential score
- Suggested token concept`,
    inputSchema: {
      type: 'object',
      properties: {
        tweet_url: {
          type: 'string',
          description: 'Full Twitter/X URL (e.g., https://x.com/user/status/123456789)'
        }
      },
      required: ['tweet_url']
    }
  }
];

/**
 * Execute Twitter tool calls
 */
export async function executeTwitterToolCall(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'search_twitter_custom':
      return await handleSearchTwitterCustom(args);
    case 'search_twitter_fresh':
      return await handleSearchTwitterFresh(args);
    case 'get_tweet_details':
      return await handleGetTweetDetails(args);
    default:
      throw new Error(`Unknown Twitter tool: ${toolName}`);
  }
}

/**
 * Handler: search_twitter_custom
 */
async function handleSearchTwitterCustom(args: {
  query: string;
  queryType?: 'Top' | 'Latest';
  hoursAgo?: number;
  maxPages?: number;
  minEngagement?: number;
}): Promise<{
  success: boolean;
  query: string;
  settings: { queryType: string; hoursAgo: number; maxPages: number; minEngagement: number };
  results: {
    tweets: Array<{
      id: string;
      text: string;
      author: string;
      followers: number;
      engagement: number;
      ageHours: number;
      url: string;
    }>;
    moments: Array<{
      concept: string | undefined;
      viralityScore: number;
      freshnessScore: number;
      reasoning: string;
    }>;
    stats: {
      total: number;
      filtered: number;
      oldest_hours: number;
      newest_hours: number;
    };
  };
}> {
  const queryType = args.queryType || 'Top';
  const hoursAgo = args.hoursAgo || TWITTER_CONFIG.FRESH_CONTENT_HOURS;
  const maxPages = args.maxPages || TWITTER_CONFIG.MAX_PAGES_PER_QUERY;
  const minEngagement = args.minEngagement || 100;

  console.log(`\n🔧 MCP: search_twitter_custom`);
  console.log(`   Query: ${args.query.substring(0, 60)}...`);
  console.log(`   Settings: ${queryType}, ${hoursAgo}h, ${maxPages} pages, min ${minEngagement} engagement`);

  const result = await twitterClient.searchCustom({
    query: args.query,
    queryType,
    hoursAgo,
    maxPages,
    minEngagement,
  });

  // Format for MCP response
  const formattedTweets = result.tweets.slice(0, 20).map(t => {
    const ageHours = (Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
    return {
      id: t.id,
      text: t.text.substring(0, 200) + (t.text.length > 200 ? '...' : ''),
      author: `@${t.author.username}`,
      followers: t.author.followers,
      engagement: t.likes + t.retweets,
      ageHours: Math.round(ageHours),
      url: t.url,
    };
  });

  const formattedMoments = result.moments.slice(0, 10).map(m => {
    const ageHours = (Date.now() - new Date(m.tweet.createdAt).getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, Math.round(50 - (ageHours * 50 / 48)));
    return {
      concept: m.tokenizableConcept,
      viralityScore: m.viralityScore,
      freshnessScore,
      reasoning: m.reasoning,
    };
  });

  return {
    success: true,
    query: args.query,
    settings: { queryType, hoursAgo, maxPages, minEngagement },
    results: {
      tweets: formattedTweets,
      moments: formattedMoments,
      stats: result.stats,
    },
  };
}

/**
 * Handler: search_twitter_fresh
 */
async function handleSearchTwitterFresh(args: {
  query: string;
  hoursAgo?: number;
  minEngagement?: number;
}): Promise<{
  success: boolean;
  query: string;
  hoursAgo: number;
  freshMoments: Array<{
    tweet: {
      text: string;
      author: string;
      followers: number;
      engagement: number;
      ageHours: number;
      url: string;
    };
    concept: string | undefined;
    freshnessScore: number;
    viralityScore: number;
  }>;
  summary: string;
}> {
  const hoursAgo = args.hoursAgo || 48;
  const minEngagement = args.minEngagement || TWITTER_CONFIG.MIN_ENGAGEMENT_FRESH;

  console.log(`\n🆕 MCP: search_twitter_fresh`);
  console.log(`   Query: ${args.query.substring(0, 60)}...`);
  console.log(`   Window: ${hoursAgo}h, min engagement: ${minEngagement}`);

  const moments = await twitterClient.searchFreshContent({
    query: args.query,
    hoursAgo,
    sortBy: 'latest',
    minEngagement,
    maxResults: 20,
  });

  const formatted = moments.slice(0, 15).map(m => {
    const ageHours = (Date.now() - new Date(m.tweet.createdAt).getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, Math.round(50 - (ageHours * 50 / 48)));
    
    return {
      tweet: {
        text: m.tweet.text.substring(0, 200) + (m.tweet.text.length > 200 ? '...' : ''),
        author: `@${m.tweet.author.username}`,
        followers: m.tweet.author.followers,
        engagement: m.tweet.likes + m.tweet.retweets,
        ageHours: Math.round(ageHours),
        url: m.tweet.url,
      },
      concept: m.tokenizableConcept,
      freshnessScore,
      viralityScore: m.viralityScore,
    };
  });

  const newestAge = formatted.length > 0 ? formatted[0].tweet.ageHours : 0;
  const summary = formatted.length > 0
    ? `Found ${formatted.length} fresh moments. Newest is ${newestAge}h old. Top concept: "${formatted[0].concept || 'N/A'}"`
    : 'No fresh viral moments found for this query';

  return {
    success: true,
    query: args.query,
    hoursAgo,
    freshMoments: formatted,
    summary,
  };
}

/**
 * Handler: get_tweet_details
 * Note: This requires extracting tweet ID from URL and fetching - simplified for now
 */
async function handleGetTweetDetails(args: {
  tweet_url: string;
}): Promise<{
  success: boolean;
  error?: string;
  tweet?: {
    id: string;
    text: string;
    author: {
      username: string;
      followers: number;
    };
    engagement: {
      likes: number;
      retweets: number;
      total: number;
    };
    ageHours: number;
  };
  analysis?: {
    qualityScore: number;
    isSpam: boolean;
    tokenizableConcept: string | undefined;
    suggestedName: string;
    suggestedSymbol: string;
  };
}> {
  // Extract tweet ID from URL
  const urlMatch = args.tweet_url.match(/status\/(\d+)/);
  if (!urlMatch) {
    return {
      success: false,
      error: 'Invalid tweet URL. Expected format: https://x.com/user/status/123456789',
    };
  }

  const tweetId = urlMatch[1];
  
  // For now, return a note that direct tweet lookup requires different API
  // The Twitter.io API may not support direct tweet lookup
  return {
    success: false,
    error: `Tweet lookup by ID (${tweetId}) requires Twitter API v2 direct access. Use search_twitter_custom with the author's username or content keywords instead.`,
  };
}
