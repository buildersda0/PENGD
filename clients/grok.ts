/**
 * Grok API Client - Token Narrative Analysis
 * 
 * Uses xAI's Grok API to analyze tweets and understand token narratives.
 * Helps with beta play research by:
 * 1. Analyzing tweets about a token to understand its narrative
 * 2. Suggesting derivative token concepts
 * 3. Providing search query suggestions when direct searches fail
 */

import dotenv from 'dotenv';

dotenv.config();

// Grok API configuration
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-2-latest';

export interface GrokAnalysis {
  narrative: string;           // What the token is about
  why_viral: string;           // WHY it's viral - the psychological/cultural appeal
  community_vibe: string;      // Community sentiment/culture
  key_themes: string[];        // Main themes (e.g., ["philosophy", "memes", "penguins"])
  meme_elements: string[];     // Specific meme/cultural references
  derivative_suggestions: string[];  // Suggested derivative token names with symbols
  search_queries: string[];    // Claude will generate these based on why_viral
}

export interface TweetSummary {
  text: string;
  author?: string;
  engagement?: number;
}

export interface GrokSearchResult {
  success: boolean;
  tweets_found: number;
  analysis?: GrokAnalysis;
  error?: string;
  images_analyzed?: number;  // Count of images Grok analyzed with view_image tool
  videos_analyzed?: number;  // Count of videos Grok analyzed
}

/**
 * Check if Grok API is configured
 */
export function isGrokConfigured(): boolean {
  return !!process.env.GROK_API_KEY;
}

/**
 * Get Grok model from env or use default
 */
function getGrokModel(): string {
  return process.env.GROK_MODEL || DEFAULT_MODEL;
}

/**
 * Search X/Twitter and analyze a token using Grok's built-in search
 * This is the PRIMARY method - uses Grok's native access to X
 */
export async function searchAndAnalyzeTokenWithGrok(
  tokenName: string,
  symbol: string
): Promise<GrokSearchResult> {
  if (!isGrokConfigured()) {
    console.warn('⚠️ Grok API not configured (GROK_API_KEY missing)');
    return { success: false, tweets_found: 0, error: 'Grok API not configured' };
  }

  const apiKey = process.env.GROK_API_KEY!;
  const model = getGrokModel();

  const prompt = `Search X/Twitter for information about the cryptocurrency token "${tokenName}" (symbol: $${symbol}).

Use your real-time search capabilities to find recent tweets about this token. Look for:
- Tweets mentioning $${symbol}
- Tweets mentioning "${tokenName}"
- Community discussions about the token
- What people are saying about it

Based on what you find, provide a comprehensive analysis:

1. What is this token about? (its narrative/concept)
2. WHY IS IT VIRAL? Explain the specific appeal - what makes people share/buy it
3. What's the community vibe and culture?
4. What are the key themes that make this token unique?
5. Suggest 3-5 derivative token concepts (similar theme but different twist)

DO NOT suggest search queries - just explain the token deeply so Claude can craft its own search strategy.

IMPORTANT FOR DERIVATIVES:
- Derivatives should be RELATED but DISTINCT (not copies)
- Think of similar aesthetic/theme but different execution
- Example: If analyzing "Nietzschean Penguin" → derivatives might be "Kafkaesque Lobster", "Sartrean Shrimp"

Respond with JSON ONLY (no markdown):
{
  "tweets_found": <number of tweets you found>,
  "narrative": "One paragraph explaining what this token is about",
  "why_viral": "Detailed explanation of WHY this token went viral - the psychological appeal, cultural moment, meme resonance, etc.",
  "community_vibe": "Brief description of the community culture",
  "key_themes": ["theme1", "theme2", "theme3"],
  "meme_elements": ["specific meme or cultural reference 1", "reference 2", "reference 3"],
  "derivative_suggestions": ["Derivative Name 1 ($SYMBOL)", "Derivative Name 2 ($SYMBOL)", "Derivative Name 3 ($SYMBOL)"]
}`;

  try {
    console.log(`\n🔍 Using Grok's X search to research "${tokenName}" ($${symbol})...`);

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1500,
        // Enable Grok's image and video understanding for X search
        // This allows Grok to use the view_image tool on images it finds during search
        enable_image_understanding: true,
        enable_video_understanding: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Grok API error: ${response.status} - ${errorText}`);
      return { success: false, tweets_found: 0, error: `API error: ${response.status}` };
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('❌ Grok returned empty response');
      return { success: false, tweets_found: 0, error: 'Empty response' };
    }

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Could not extract JSON from Grok response');
      console.log('   Response:', content.substring(0, 200));
      return { success: false, tweets_found: 0, error: 'Invalid JSON response' };
    }

    const result = JSON.parse(jsonMatch[0]);
    const analysis: GrokAnalysis = {
      narrative: result.narrative || '',
      why_viral: result.why_viral || '',
      community_vibe: result.community_vibe || '',
      key_themes: result.key_themes || [],
      meme_elements: result.meme_elements || [],
      derivative_suggestions: result.derivative_suggestions || [],
      search_queries: [], // Will be generated by Claude based on why_viral
    };

    console.log(`✅ Grok X search complete for "${tokenName}"`);
    console.log(`   Tweets found: ${result.tweets_found || 'unknown'}`);
    console.log(`   Narrative: ${analysis.narrative.substring(0, 100)}...`);
    console.log(`   WHY VIRAL: ${analysis.why_viral.substring(0, 100)}...`);
    console.log(`   Key themes: ${analysis.key_themes.join(', ')}`);
    console.log(`   Meme elements: ${analysis.meme_elements.join(', ')}`);
    console.log(`   Derivatives: ${analysis.derivative_suggestions.join(', ')}`);

    return {
      success: true,
      tweets_found: result.tweets_found || 0,
      analysis,
    };

  } catch (error) {
    console.error('❌ Grok search and analysis failed:', error);
    return { success: false, tweets_found: 0, error: String(error) };
  }
}

/**
 * Search X/Twitter for visual content matching a specific theme
 * Uses Grok's image understanding to find tweets with matching visuals
 */
export async function searchVisualContentWithGrok(
  query: string,
  visualTheme: string,  // e.g., "philosophical animal looking contemplative with cartoon style"
  options?: {
    minEngagement?: number;
    daysAgo?: number;
  }
): Promise<{
  success: boolean;
  tweets: Array<{
    text: string;
    author?: string;
    url?: string;
    has_image: boolean;
    image_description?: string;
    visual_match_score?: number;
  }>;
  error?: string;
}> {
  if (!isGrokConfigured()) {
    console.warn('⚠️ Grok API not configured');
    return { success: false, tweets: [], error: 'Grok API not configured' };
  }

  const apiKey = process.env.GROK_API_KEY!;
  const model = getGrokModel();
  
  const prompt = `Search X/Twitter for tweets matching this query: "${query}"

IMPORTANT: Focus on tweets WITH IMAGES that match this visual theme:
"${visualTheme}"

Use your image understanding capabilities to analyze any images you find.
Look for tweets from the last ${options?.daysAgo || 7} days with at least ${options?.minEngagement || 100} engagement.

For each relevant tweet found, provide:
1. The tweet text
2. The author username
3. Whether it has an image
4. If it has an image, describe what's in the image
5. How well the image matches the visual theme (0-100 score)

Respond with JSON ONLY:
{
  "tweets_found": <number>,
  "tweets": [
    {
      "text": "tweet content",
      "author": "username",
      "url": "https://x.com/...",
      "has_image": true,
      "image_description": "Description of what's in the image",
      "visual_match_score": 75
    }
  ]
}`;

  try {
    console.log(`🔍 Grok visual search: "${query}" (theme: ${visualTheme.substring(0, 50)}...)`);

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
        enable_image_understanding: true,
        enable_video_understanding: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Grok visual search error: ${response.status}`);
      return { success: false, tweets: [], error: `API error: ${response.status}` };
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { success: false, tweets: [], error: 'Empty response' };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, tweets: [], error: 'Invalid JSON response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      tweets_found?: number;
      tweets?: Array<{
        text?: string;
        author?: string;
        url?: string;
        has_image?: boolean;
        image_description?: string;
        visual_match_score?: number;
      }>;
    };

    const tweets = (parsed.tweets || []).map(t => ({
      text: t.text || '',
      author: t.author,
      url: t.url,
      has_image: t.has_image || false,
      image_description: t.image_description,
      visual_match_score: t.visual_match_score,
    }));

    console.log(`   ✅ Found ${tweets.length} tweets with visual content`);
    return { success: true, tweets };

  } catch (error) {
    console.error('❌ Grok visual search failed:', error);
    return { success: false, tweets: [], error: String(error) };
  }
}

/**
 * Analyze tweets about a token to understand its narrative
 * FALLBACK method when we already have tweets from Twitter.io
 */
export async function analyzeTokenWithGrok(
  tokenName: string,
  symbol: string,
  tweets: TweetSummary[]
): Promise<GrokAnalysis | null> {
  if (!isGrokConfigured()) {
    console.warn('⚠️ Grok API not configured (GROK_API_KEY missing)');
    return null;
  }

  const apiKey = process.env.GROK_API_KEY!;
  const model = getGrokModel();

  // Format tweets for analysis
  const tweetList = tweets
    .slice(0, 20) // Limit to 20 tweets to stay within context limits
    .map((t, i) => `${i + 1}. "${t.text.substring(0, 200)}"${t.author ? ` - @${t.author}` : ''}${t.engagement ? ` (${t.engagement} engagement)` : ''}`)
    .join('\n');

  const prompt = `You are analyzing tweets about a cryptocurrency token to understand its narrative and community.

TOKEN: "${tokenName}" (Symbol: $${symbol})

TWEETS ABOUT THIS TOKEN:
${tweetList || 'No tweets found - analyze based on the token name only.'}

YOUR TASK:
1. Analyze what this token is about based on the tweets and/or its name
2. Understand the community vibe and culture
3. Identify the key themes that make this token unique
4. Suggest 3-5 derivative token concepts (similar theme but different twist)
5. Suggest Twitter search queries to find more relevant viral content

IMPORTANT FOR DERIVATIVES:
- Derivatives should be RELATED but DISTINCT (not copies)
- Think of similar aesthetic/theme but different execution
- Example: If analyzing "Nietzschean Penguin" → derivatives might be "Kafkaesque Lobster", "Sartrean Shrimp"

Respond with JSON ONLY (no markdown):
{
  "narrative": "One paragraph explaining what this token is about",
  "community_vibe": "Brief description of the community culture",
  "key_themes": ["theme1", "theme2", "theme3"],
  "derivative_suggestions": ["Derivative Name 1", "Derivative Name 2", "Derivative Name 3"],
  "search_queries": ["search query 1", "search query 2", "search query 3"]
}`;

  try {
    console.log(`\n🧠 Asking Grok to analyze "${tokenName}"...`);

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Grok API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('❌ Grok returned empty response');
      return null;
    }

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Could not extract JSON from Grok response');
      console.log('   Response:', content.substring(0, 200));
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]) as GrokAnalysis;
    console.log(`✅ Grok analysis complete for "${tokenName}"`);
    console.log(`   Narrative: ${analysis.narrative.substring(0, 100)}...`);
    console.log(`   Key themes: ${analysis.key_themes.join(', ')}`);
    console.log(`   Derivatives: ${analysis.derivative_suggestions.join(', ')}`);

    return analysis;

  } catch (error) {
    console.error('❌ Grok analysis failed:', error);
    return null;
  }
}

/**
 * Ask Grok for search advice when we can't find info about a token
 */
export async function askGrokForSearchAdvice(
  tokenName: string,
  symbol: string
): Promise<string[] | null> {
  if (!isGrokConfigured()) {
    console.warn('⚠️ Grok API not configured');
    return null;
  }

  const apiKey = process.env.GROK_API_KEY!;
  const model = getGrokModel();

  const prompt = `I'm trying to research a cryptocurrency token called "${tokenName}" (symbol: $${symbol}) but I can't find much information about it on Twitter.

Based on the token name, suggest 5 search queries I should use on Twitter to:
1. Find tweets discussing this token or similar tokens
2. Find viral content in the same thematic space
3. Understand what cultural references or memes this token might be based on

Respond with JSON ONLY (no markdown):
{
  "search_queries": ["query 1", "query 2", "query 3", "query 4", "query 5"],
  "reasoning": "Brief explanation of what themes you identified from the name"
}`;

  try {
    console.log(`\n🔍 Asking Grok for search advice on "${tokenName}"...`);

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      console.error(`❌ Grok API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`✅ Grok search advice received`);
    console.log(`   Queries: ${result.search_queries.slice(0, 3).join(', ')}`);

    return result.search_queries;

  } catch (error) {
    console.error('❌ Grok search advice failed:', error);
    return null;
  }
}

/**
 * Get derivative suggestions for a token concept
 * Useful when we understand the token but need creative derivatives
 */
export async function getDerivativeSuggestions(
  tokenName: string,
  symbol: string,
  narrative: string
): Promise<string[] | null> {
  if (!isGrokConfigured()) {
    return null;
  }

  const apiKey = process.env.GROK_API_KEY!;
  const model = getGrokModel();

  const prompt = `A cryptocurrency token called "${tokenName}" ($${symbol}) is performing well.

Here's what it's about: ${narrative}

Generate 5 derivative token concepts that:
1. Are in the SAME thematic universe but with a fresh twist
2. Are NOT direct copies or "Baby X" / "X 2.0" style names
3. Have meme potential and are memorable
4. Could ride the momentum of the original's success

Examples of GOOD derivatives:
- Original: "Nietzschean Penguin" → Derivatives: "Kafkaesque Lobster", "Sartrean Shrimp", "Camus Crab"
- Original: "Quantum Dog" → Derivatives: "Schrödinger Cat", "Particle Pup", "Wave Function Shiba"

Respond with JSON ONLY:
{
  "derivatives": ["Name 1", "Name 2", "Name 3", "Name 4", "Name 5"],
  "reasoning": "Brief explanation of the derivative strategy"
}`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);
    return result.derivatives;

  } catch (error) {
    console.error('❌ Derivative suggestions failed:', error);
    return null;
  }
}

// Export singleton-style functions
export const grokClient = {
  isConfigured: isGrokConfigured,
  searchAndAnalyze: searchAndAnalyzeTokenWithGrok,  // PRIMARY: Use Grok's X search
  searchVisualContent: searchVisualContentWithGrok, // NEW: Visual content search with image understanding
  analyzeToken: analyzeTokenWithGrok,  // FALLBACK: Analyze pre-fetched tweets
  getSearchAdvice: askGrokForSearchAdvice,
  getDerivatives: getDerivativeSuggestions,
};
