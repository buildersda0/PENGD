/**
 * OpenAI Client - Image Generation with GPT-4 Vision
 * 
 * Supports 3 image formats with reference-based style matching:
 * - COIN: Simple hand-drawn style (TEK.png, TIME.png references)
 * - INDEX: Professional glossy 3D medallion (SPDM.png, GP.png references)
 * - ASCII: Terminal/hacker aesthetic
 * 
 * Uses GPT-4 Vision to analyze references and generate matching styles
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ExtractedConcept, ImageFormat } from '../research/concept-extractor.js';
import { generateTokenImageWithGemini, saveGeminiImage } from './gemini-image.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Search for a token's image on DEX Screener by name or symbol
 * Returns the image URL if found, null otherwise
 */
export async function searchAlphaTokenImage(tokenName: string, symbol?: string, tokenAddress?: string): Promise<string | null> {
  try {
    // If we have a token address, try Solana Tracker first
    if (tokenAddress) {
      console.log(`🔍 Fetching token image from Solana Tracker for address: ${tokenAddress.substring(0, 8)}...`);
      const { getTokenImageUrl } = await import('./solana-tracker.js');
      const solanaTrackerImage = await getTokenImageUrl(tokenAddress);
      
      if (solanaTrackerImage) {
        console.log(`   ✅ Found image from Solana Tracker`);
        return solanaTrackerImage;
      }
      console.log(`   ⚠️ No image found on Solana Tracker, trying DEX Screener...`);
    }
    
    // Clean up token name for search
    const searchTerm = tokenName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    console.log(`🔍 Searching DEX Screener for "${tokenName}" image...`);
    
    // Search DEX Screener API
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchTerm)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) {
      console.log(`   ⚠️ DEX Screener API returned ${response.status}`);
      return null;
    }
    
    const data = await response.json() as { pairs?: Array<{ baseToken?: { name?: string; symbol?: string; address?: string; }; info?: { imageUrl?: string; } }> };
    
    if (!data.pairs || data.pairs.length === 0) {
      console.log(`   ⚠️ No tokens found matching "${tokenName}"`);
      return null;
    }
    
    // Find the best matching pair with an image
    for (const pair of data.pairs.slice(0, 10)) {
      if (pair.info?.imageUrl) {
        const pairName = pair.baseToken?.name?.toLowerCase() || '';
        const pairSymbol = pair.baseToken?.symbol?.toLowerCase() || '';
        
        // Check if it matches our search
        if (pairName.includes(searchTerm) || 
            (symbol && pairSymbol === symbol.toLowerCase()) ||
            searchTerm.includes(pairName.split(' ')[0])) {
          console.log(`   ✅ Found image for "${pair.baseToken?.name}" ($${pair.baseToken?.symbol})`);
          
          // If we have the token address, also try to get higher quality image from Solana Tracker
          if (pair.baseToken?.address) {
            const { getTokenImageUrl } = await import('./solana-tracker.js');
            const betterImage = await getTokenImageUrl(pair.baseToken.address);
            if (betterImage) {
              console.log(`   🔄 Using higher quality image from Solana Tracker`);
              return betterImage;
            }
          }
          
          return pair.info.imageUrl;
        }
      }
    }
    
    // Try the first pair with an image if no exact match
    const firstWithImage = data.pairs.find(p => p.info?.imageUrl);
    if (firstWithImage?.info?.imageUrl) {
      console.log(`   📸 Using image from "${firstWithImage.baseToken?.name}" (closest match)`);
      
      // Try to get better quality from Solana Tracker
      if (firstWithImage.baseToken?.address) {
        const { getTokenImageUrl } = await import('./solana-tracker.js');
        const betterImage = await getTokenImageUrl(firstWithImage.baseToken.address);
        if (betterImage) {
          console.log(`   🔄 Using higher quality image from Solana Tracker`);
          return betterImage;
        }
      }
      
      return firstWithImage.info.imageUrl;
    }
    
    console.log(`   ⚠️ No images found for "${tokenName}"`);
    return null;
  } catch (error) {
    console.log(`   ❌ Error searching for token image: ${error}`);
    return null;
  }
}

/**
 * Fetch alpha token market cap and info from DEX Screener
 */
export interface AlphaTokenInfo {
  name: string;
  symbol: string;
  imageUrl?: string;
  marketCap?: string;       // Formatted e.g. "5.2M"
  priceChange24h?: string;  // e.g. "+45%"
  address?: string;
}

export async function getAlphaTokenInfo(tokenName: string, symbol?: string): Promise<AlphaTokenInfo | null> {
  try {
    const searchTerm = tokenName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    console.log(`📊 Fetching market data for "${tokenName}"...`);
    
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchTerm)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json() as { 
      pairs?: Array<{ 
        baseToken?: { name?: string; symbol?: string; address?: string; }; 
        info?: { imageUrl?: string; }; 
        fdv?: number;
        priceChange?: { h24?: number };
      }> 
    };
    
    if (!data.pairs || data.pairs.length === 0) return null;
    
    // Find best match
    for (const pair of data.pairs.slice(0, 10)) {
      const pairName = pair.baseToken?.name?.toLowerCase() || '';
      const pairSymbol = pair.baseToken?.symbol?.toLowerCase() || '';
      
      if (pairName.includes(searchTerm) || (symbol && pairSymbol === symbol.toLowerCase())) {
        const fdv = pair.fdv || 0;
        let marketCap = '???';
        if (fdv >= 1_000_000_000) {
          marketCap = `${(fdv / 1_000_000_000).toFixed(1)}B`;
        } else if (fdv >= 1_000_000) {
          marketCap = `${(fdv / 1_000_000).toFixed(1)}M`;
        } else if (fdv >= 1_000) {
          marketCap = `${(fdv / 1_000).toFixed(0)}K`;
        } else {
          marketCap = `${fdv.toFixed(0)}`;
        }
        
        const priceChange = pair.priceChange?.h24;
        const priceChangeStr = priceChange !== undefined 
          ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(0)}%`
          : undefined;
        
        console.log(`   ✅ ${pair.baseToken?.name}: $${marketCap} market cap${priceChangeStr ? `, ${priceChangeStr} 24h` : ''}`);
        
        return {
          name: pair.baseToken?.name || tokenName,
          symbol: pair.baseToken?.symbol || symbol || '???',
          imageUrl: pair.info?.imageUrl,
          marketCap,
          priceChange24h: priceChangeStr,
          address: pair.baseToken?.address,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.log(`   ❌ Error fetching alpha token info: ${error}`);
    return null;
  }
}

/**
 * Visual analysis result for a tweet image
 */
export interface ImageVisualAnalysis {
  description: string;
  themes: string[];
  visual_elements: string[];
  meme_potential: 'low' | 'medium' | 'high';
  art_style?: string;
  color_palette?: string[];
}

/**
 * Analyze an image using GPT-4o Vision
 * Used for analyzing tweet images to understand their visual content
 */
export async function analyzeImageWithVision(
  imageUrl: string,
  context?: string
): Promise<ImageVisualAnalysis> {
  console.log(`🔍 Analyzing image with GPT-4o Vision...`);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          },
          {
            type: 'text',
            text: context 
              ? `Analyze this image in the context of: ${context}.

Provide a JSON response with:
{
  "description": "Detailed description of what's in the image",
  "themes": ["theme1", "theme2"],
  "visual_elements": ["element1", "element2"],
  "meme_potential": "low" | "medium" | "high",
  "art_style": "description of the art style",
  "color_palette": ["color1", "color2"]
}`
              : `Analyze this image for crypto/meme coin potential.

Provide a JSON response with:
{
  "description": "Detailed description of what's in the image",
  "themes": ["theme1", "theme2"],
  "visual_elements": ["element1", "element2"],
  "meme_potential": "low" | "medium" | "high",
  "art_style": "description of the art style",
  "color_palette": ["color1", "color2"]
}`
          }
        ]
      }]
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<ImageVisualAnalysis>;
      return {
        description: parsed.description || 'Unable to describe image',
        themes: parsed.themes || [],
        visual_elements: parsed.visual_elements || [],
        meme_potential: parsed.meme_potential || 'medium',
        art_style: parsed.art_style,
        color_palette: parsed.color_palette,
      };
    }
    
    // Fallback if JSON parsing fails
    return {
      description: content.substring(0, 500),
      themes: [],
      visual_elements: [],
      meme_potential: 'medium',
    };
  } catch (error) {
    console.error(`❌ Vision analysis failed: ${error}`);
    return {
      description: 'Failed to analyze image',
      themes: [],
      visual_elements: [],
      meme_potential: 'low',
    };
  }
}

/**
 * Visual DNA of an alpha token - used for finding similar derivatives
 */
export interface AlphaVisualDNA {
  visual_style: string;          // e.g., "hand-drawn cartoon", "3D render", "pixel art"
  color_palette: string[];       // dominant colors
  character_type: string;        // e.g., "cute animal", "abstract shape", "humanoid"
  mood: string;                  // e.g., "playful", "serious", "absurd"
  art_technique: string;         // e.g., "flat design", "gradient mesh", "watercolor"
  distinctive_features: string[]; // unique visual elements to look for in derivatives
}

/**
 * Analyze an alpha token's image to extract its visual DNA
 * This helps find visually similar content for beta play derivatives
 */
export async function analyzeAlphaTokenVisuals(
  tokenName: string,
  imageUrl: string
): Promise<AlphaVisualDNA> {
  console.log(`🧬 Analyzing visual DNA for "${tokenName}"...`);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          },
          {
            type: 'text',
            text: `This is the token image for "${tokenName}". Analyze its visual DNA in detail.

We will use this analysis to:
1. Search for visually similar content on Twitter
2. Generate derivative token images in the same style

Provide a JSON response with:
{
  "visual_style": "The overall art style (e.g., 'hand-drawn cartoon', '3D render', 'pixel art', 'minimalist vector')",
  "color_palette": ["dominant color 1", "dominant color 2", "accent color"],
  "character_type": "What type of character/subject (e.g., 'cute penguin', 'abstract shape', 'humanoid figure')",
  "mood": "The emotional tone (e.g., 'playful', 'philosophical', 'absurdist', 'serious')",
  "art_technique": "Technical approach (e.g., 'flat design', 'gradients', 'hand-drawn lines', 'digital painting')",
  "distinctive_features": ["feature1", "feature2", "feature3"]
}

Be specific and detailed - this will guide visual matching and image generation.`
          }
        ]
      }]
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<AlphaVisualDNA>;
      const result: AlphaVisualDNA = {
        visual_style: parsed.visual_style || 'unknown',
        color_palette: parsed.color_palette || [],
        character_type: parsed.character_type || 'unknown',
        mood: parsed.mood || 'neutral',
        art_technique: parsed.art_technique || 'unknown',
        distinctive_features: parsed.distinctive_features || [],
      };
      
      console.log(`   📊 Visual DNA extracted:`);
      console.log(`      Style: ${result.visual_style}`);
      console.log(`      Colors: ${result.color_palette.join(', ')}`);
      console.log(`      Character: ${result.character_type}`);
      console.log(`      Mood: ${result.mood}`);
      
      return result;
    }
    
    // Fallback
    return {
      visual_style: 'unknown',
      color_palette: [],
      character_type: 'unknown',
      mood: 'neutral',
      art_technique: 'unknown',
      distinctive_features: [],
    };
  } catch (error) {
    console.error(`❌ Alpha visual DNA analysis failed: ${error}`);
    return {
      visual_style: 'unknown',
      color_palette: [],
      character_type: 'unknown',
      mood: 'neutral',
      art_technique: 'unknown',
      distinctive_features: [],
    };
  }
}

// Reference image paths
// Reference images - paths relative to backend directory (claudeball/backend/)
// These are used for style reference in image generation
const REFERENCE_IMAGES = {
  coin: [
    'reff/coin/TEK.png',
    'reff/coin/TIME.png',
    'reff/coin/USDUC.png',
  ],
  index: [
    'reff/index/SPDM.png',
    'reff/index/GP.png',
    'reff/index/CGI.png',
  ],
  one: [
    'reff/one/1.png',
    'reff/one/2.png',
    'reff/one/3.png',
  ],
  ascii: [
    'reff/ascii/CAT.png',
    'reff/ascii/ETF.png',
    'reff/ascii/RUST.png',
    'reff/ascii/shrimp.png',
  ],
};

// Style guides for each format
const STYLE_GUIDES = {
  coin: {
    description: 'Simple hand-drawn meme coin style',
    characteristics: [
      'Minimalist, hand-drawn aesthetic',
      'Black outline circle with symbol inside',
      'Meme-like, fun, approachable',
      'Single character or symbol focus',
      'Clean, simple colors',
    ],
  },
  one: {
    description: 'Multiple elements surrounding central concept',
    characteristics: [
      'Central glowing element in the middle',
      'Multiple characters/elements around the center',
      'Radiating light/rays from center',
      'Anime/cartoon style',
      'Dynamic composition with characters reaching toward center',
    ],
  },
  index: {
    description: 'Professional market index 3D medallion style',
    characteristics: [
      'Glossy 3D coin/medallion',
      'Bold ticker text prominently displayed',
      'Stock market/financial aesthetic',
      'Metallic finish with gradient',
      'Green/blue/gold color scheme',
      'Number suffix common (e.g., 6900)',
    ],
  },
  ascii: {
    description: 'Terminal/hacker ASCII art aesthetic',
    characteristics: [
      'Monospace font appearance',
      'Green-on-black terminal colors',
      'Retro computer/hacker vibes',
      'Glitchy, cyberpunk effects',
      'Matrix-like aesthetic',
    ],
  },
};

export interface ImageGenerationOptions {
  theme: string;
  style?: 'cartoon' | 'realistic' | 'pixel' | 'neon' | 'minimalist';
  size?: '1024x1024' | '1792x1024' | '1024x1792';
}

export interface ImageGenerationOptionsV2 {
  concept: ExtractedConcept;
  format: ImageFormat;
  tweetImageUrl?: string;      // Image from the tweet to adapt
  referenceImages?: string[];  // Custom reference images
  // Beta play fields
  isBetaPlay?: boolean;        // True if this is a derivative of another token
  alphaToken?: string;         // The leader token name (e.g., "Copper Inu")
  alphaImageUrl?: string;      // URL of the alpha token's image to remix
}

export interface GeneratedImage {
  url: string;
  revisedPrompt?: string;
  format: ImageFormat;
}

/**
 * Load an image file as base64
 */
function loadImageAsBase64(imagePath: string): string | null {
  try {
    // Try multiple base paths
    const possiblePaths = [
      imagePath,
      path.join(process.cwd(), imagePath),
      path.join(process.cwd(), '..', imagePath),
      path.join('/Users/gdmes/Desktop/03_Projects_Code/PENGD', imagePath),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        return buffer.toString('base64');
      }
    }
    
    console.warn(`⚠️ Reference image not found: ${imagePath}`);
    return null;
  } catch (error) {
    console.warn(`⚠️ Error loading reference image: ${error}`);
    return null;
  }
}

/**
 * Download an image URL to base64
 */
async function downloadImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`⚠️ Failed to download image: ${response.status}`);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (error) {
    console.warn(`⚠️ Error downloading image: ${error}`);
    return null;
  }
}

/**
 * Use GPT-4 Vision to analyze reference images and describe the style
 */
async function analyzeReferenceStyle(format: ImageFormat): Promise<string> {
  const refs = REFERENCE_IMAGES[format as keyof typeof REFERENCE_IMAGES];
  if (!refs || refs.length === 0) {
    return STYLE_GUIDES[format].characteristics.join('. ');
  }

  // Load reference images
  const images: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  for (const refPath of refs.slice(0, 2)) {
    const base64 = loadImageAsBase64(refPath);
    if (base64) {
      images.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64}` },
      });
    }
  }

  if (images.length === 0) {
    return STYLE_GUIDES[format].characteristics.join('. ');
  }

  try {
    console.log(`🔍 Analyzing ${format} style from ${images.length} reference images...`);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze these token/coin images and describe their visual style in detail. Focus on:
- Overall aesthetic and mood
- Color palette and gradients
- Typography style
- Shape and composition
- Texture and effects
- What makes them look professional/memeable

Describe in a way that could be used to replicate this style.`,
            },
            ...images,
          ],
        },
      ],
    });

    const description = response.choices[0]?.message?.content || '';
    console.log(`✅ Style analyzed: "${description.substring(0, 100)}..."`);
    return description;

  } catch (error) {
    console.warn('⚠️ Error analyzing reference style:', error);
    return STYLE_GUIDES[format].characteristics.join('. ');
  }
}

/**
 * Build DALL-E prompt based on format and concept
 */
function buildDallePrompt(
  concept: ExtractedConcept,
  format: ImageFormat,
  styleDescription: string,
  hasTweetImage: boolean
): string {
  const { name, symbol } = concept;

  switch (format) {
    case 'coin':
      return `Create a simple, hand-drawn style cryptocurrency coin/token logo.

STYLE: ${styleDescription}

TOKEN: "${symbol}"

Requirements:
- Minimalist meme coin aesthetic
- Black outline circle or simple shape
- Symbol "${symbol}" should be visible but not overwhelming
- Fun, approachable, memeable
- Clean background (white or simple gradient)
- NO realistic 3D effects - keep it flat and hand-drawn
${hasTweetImage ? '- Incorporate the character/subject from the reference image' : ''}

Do NOT include any text other than the symbol if naturally incorporated.`;

    case 'index':
      return `Create a professional market index style cryptocurrency medallion.

STYLE: ${styleDescription}

TOKEN: "${symbol}"

Requirements:
- Glossy 3D coin/medallion appearance
- Bold ticker "${symbol}" prominently displayed
- Stock market / financial aesthetic
- Metallic finish with gold, silver, or bronze tones
- Green/blue gradient accents
- Professional, institutional feel
- Number suffix style (like index funds)
${hasTweetImage ? '- Incorporate themes from the reference image' : ''}

Make it look like a legitimate financial index token.`;

    case 'ascii':
      return `Create a visual that looks like ASCII art or terminal output.

TOKEN: "${symbol}"

Requirements:
- Monospace font aesthetic
- Green-on-black terminal colors (Matrix style)
- Retro computer/hacker vibes
- Glitchy, cyberpunk effects
- Could include pseudo-code or command line elements
- "${symbol}" displayed as if typed in a terminal
- Scanlines or CRT monitor effects optional

Make it look like art generated by a computer, technical and mysterious.`;

    default:
      return concept.imagePrompt || `Create a memecoin mascot for "${name}" (${symbol}). Cute, colorful, no text.`;
  }
}

/**
 * Generate token image using Gemini 3 Pro Image (Nano Banana Pro)
 * 
 * Process:
 * 1. Load reference images for style matching
 * 2. If tweet has image, include it
 * 3. Generate with Gemini 3 Pro Image
 * 4. Fallback to DALL-E 3 if Gemini fails
 */
export async function generateTokenImageV2(options: ImageGenerationOptionsV2): Promise<GeneratedImage> {
  const { concept, format, tweetImageUrl, isBetaPlay, alphaToken, alphaImageUrl } = options;
  
  // For beta plays, simple style transfer from alpha
  if (isBetaPlay && alphaImageUrl) {
    console.log(`🧬 BETA PLAY: Style transfer from "${alphaToken}" → "${concept.name}"`);
    console.log(`   📸 Alpha style source: ${alphaImageUrl.substring(0, 50)}...`);
    
    // Check if beta play tweet has its own image
    const hasBetaImage = !!tweetImageUrl;
    
    let prompt: string;
    let refs: string[];
    
    if (hasBetaImage) {
      // Beta has image: Regenerate beta's image in alpha's style
      console.log(`   📸 Beta has image - regenerating in alpha's style`);
      refs = [alphaImageUrl, tweetImageUrl];
      prompt = `Regenerate the second image in the exact art style of the first image.

First image = style reference (${alphaToken})
Second image = content to recreate

Keep the art style STRICTLY the same as the first image. Same line weight, colors, shading, composition style.
Only recreate the content/subject from the second image.`;
    } else {
      // No beta image: Use alpha's image, change the character/subject
      console.log(`   📸 No beta image - creating "${concept.name}" in alpha's style`);
      refs = [alphaImageUrl];
      prompt = `Use this reference image as your EXACT style guide.

Create "${concept.name}" in the IDENTICAL art style.
${concept.description ? `Description: ${concept.description}` : ''}

Replace the character/subject with "${concept.name}" but keep everything else the same:
- Same art style
- Same color palette  
- Same line weight
- Same composition
- Same aesthetic

Just change WHAT is depicted, not HOW it's depicted.`;
    }
    
    const betaConcept = {
      ...concept,
      imagePrompt: prompt,
    };
    
    try {
      console.log('🍌 Generating BETA PLAY image...');
      
      const geminiResult = await generateTokenImageWithGemini({
        concept: betaConcept,
        format: 'coin', // Ignored - using pure style transfer
        referenceImages: refs,
        tweetImageUrl: undefined, // Already in refs if exists
        resolution: '1K',
      });
      
      const timestamp = Date.now();
      const tempPath = path.join(process.cwd(), 'generated_images', `${concept.symbol}_beta_${timestamp}.png`);
      
      const dir = path.dirname(tempPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      await saveGeminiImage(geminiResult, tempPath);
      
      console.log(`   ✅ Beta remix saved: ${tempPath}`);
      
      return {
        url: tempPath,
        revisedPrompt: `Beta remix of ${alphaToken} → ${concept.name}`,
        format,
      };
    } catch (betaError: any) {
      console.warn(`⚠️ Beta remix failed: ${betaError?.message || betaError}`);
      console.log('🎨 Falling back to regular generation...');
      // Fall through to normal generation
    }
  }
  
  console.log(`🎨 Generating ${format.toUpperCase()} image for: ${concept.name} (${concept.symbol})`);

  // Step 1: Get reference images for the format
  const refs = REFERENCE_IMAGES[format as keyof typeof REFERENCE_IMAGES] || [];
  
  console.log(`📚 Using ${refs.length} reference images for ${format} style...`);
  
  // Try Gemini first
  try {
    console.log('🍌 Attempting generation with Gemini (Nano Banana Pro)...');
    
    const geminiResult = await generateTokenImageWithGemini({
      concept,
      format,
      referenceImages: refs,
      tweetImageUrl,
      resolution: '1K',
    });
    
    // Save to temporary file and get URL (in production, upload to CDN/storage)
    const timestamp = Date.now();
    const tempPath = path.join(process.cwd(), 'generated_images', `${concept.symbol}_${timestamp}.png`);
    
    // Ensure directory exists
    const dir = path.dirname(tempPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    await saveGeminiImage(geminiResult, tempPath);
    
    // For now, return file path as URL (in production, upload to storage and return real URL)
    return {
      url: tempPath,
      revisedPrompt: `Generated with Gemini for ${concept.name} (${concept.symbol})`,
      format,
    };
    
  } catch (geminiError: any) {
    console.warn(`⚠️ Gemini generation failed: ${geminiError?.message || geminiError}`);
    console.log('🎨 Falling back to DALL-E 3...');
  }
  
  // Fallback to DALL-E 3
  const referenceImages: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  
  console.log(`📚 Loading ${refs.length} reference images for DALL-E fallback...`);
  for (const refPath of refs) {
    const base64 = loadImageAsBase64(refPath);
    if (base64) {
      referenceImages.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64}` },
      });
      console.log(`  ✓ Loaded ${refPath}`);
    }
  }

  // Step 2: Load tweet image if available
  let tweetImageContent: { type: 'image_url'; image_url: { url: string } } | null = null;
  if (tweetImageUrl) {
    console.log('📷 Loading tweet image...');
    const tweetImageBase64 = await downloadImageAsBase64(tweetImageUrl);
    if (tweetImageBase64) {
      tweetImageContent = {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${tweetImageBase64}` },
      };
    }
  }

  // Step 3: Ask GPT-4o to craft the image prompt using references
  console.log('🧠 GPT-4o crafting prompt with reference analysis...');
  
  // Build simplified prompt based on format
  let promptTemplate = '';
  if (format === 'coin') {
    promptTemplate = `Create an image prompt for coin ticker "${concept.symbol}" matching the exact style of the reference images shown. The design should feature:
- Hand-drawn, minimalist aesthetic exactly like the references
- Simple circle with symbol/character inside
- Clean, meme-friendly style
- Theme: ${concept.coreTheme}
${tweetImageUrl ? '- Incorporate visual elements from the tweet image' : ''}

Output only the image generation prompt, no other text.`;
  } else if (format === 'index') {
    promptTemplate = `Create an image prompt for index ticker "${concept.symbol}" matching the exact style of the reference images shown. The design should feature:
- 3D glossy medallion/coin exactly like the references  
- Bold "${concept.symbol}" ticker text prominently displayed
- Professional market index appearance
- Theme: ${concept.coreTheme}
- Vibrant colors and clean design
${tweetImageUrl ? '- Incorporate visual elements from the tweet image' : ''}

Output only the image generation prompt, no other text.`;
  } else {
    // ascii or other formats
    promptTemplate = `Create an image prompt for "${concept.symbol}" matching the exact style of the reference images shown. The design should feature:
- Terminal/hacker aesthetic with ${format} style
- Theme: ${concept.coreTheme}
- Monospace, green-on-black, matrix-like
${tweetImageUrl ? '- Incorporate visual elements from the tweet image' : ''}

Output only the image generation prompt, no other text.`;
  }
  
  const gptContent: Array<any> = [
    {
      type: 'text',
      text: promptTemplate,
    },
  ];

  // Add reference images
  gptContent.push(...referenceImages);
  
  // Add tweet image if available
  if (tweetImageContent) {
    gptContent.push(tweetImageContent);
  }

  let dallePrompt = '';
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: gptContent,
        },
      ],
    });

    dallePrompt = response.choices[0]?.message?.content || buildDallePrompt(concept, format, STYLE_GUIDES[format].characteristics.join('. '), false);
    console.log(`✅ GPT-4o crafted prompt: "${dallePrompt.substring(0, 100)}..."`);
  } catch (error) {
    console.warn('⚠️ GPT-4o prompt crafting failed, using fallback:', error);
    dallePrompt = buildDallePrompt(concept, format, STYLE_GUIDES[format].characteristics.join('. '), false);
  }

  // Step 4: Generate with DALL-E 3 (fallback)
  console.log('🎨 Generating image with DALL-E 3 (fallback)...');
  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: dallePrompt,
      n: 1,
      size: '1024x1024',
      quality: 'hd',
      style: format === 'ascii' ? 'natural' : 'vivid',
    });

    if (!response.data || response.data.length === 0 || !response.data[0].url) {
      throw new Error('No image URL in OpenAI response');
    }

    const imageUrl = response.data[0].url;
    console.log(`✅ Image generated successfully with DALL-E 3 (fallback)`);

    return {
      url: imageUrl,
      revisedPrompt: response.data[0].revised_prompt,
      format,
    };
  } catch (fallbackError) {
    console.error('❌ DALL-E 3 fallback also failed:', fallbackError);
    throw fallbackError;
  }
}

/**
 * Generate image and download to buffer (for uploading to Pinata/Pump.fun)
 */
export async function generateTokenImageBufferV2(options: ImageGenerationOptionsV2): Promise<Buffer> {
  const result = await generateTokenImageV2(options);

  console.log(`📥 Downloading image from OpenAI CDN...`);
  const response = await fetch(result.url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ===== LEGACY FUNCTIONS (kept for backward compatibility) =====

/**
 * Generate a token image using DALL-E 3 (legacy)
 */
export async function generateTokenImage(options: ImageGenerationOptions): Promise<string> {
  const { theme, style = 'cartoon', size = '1024x1024' } = options;

  const stylePrompts: Record<string, string> = {
    cartoon: 'cute cartoon style, vibrant colors, playful, fun character design',
    realistic: 'photorealistic, highly detailed, professional quality',
    pixel: '8-bit pixel art style, retro game aesthetic, nostalgic',
    neon: 'neon cyberpunk style, glowing effects, futuristic, dark background with bright highlights',
    minimalist: 'clean minimalist logo, simple shapes, modern design, flat colors',
  };

  const styleDescription = stylePrompts[style] || stylePrompts.cartoon;

  const prompt = `Create a token mascot/logo image for a cryptocurrency called "${theme}". 
    Style: ${styleDescription}. 
    The image should be:
    - Centered and well-composed for a square logo
    - Eye-catching and memorable
    - Professional enough for a crypto token
    - Fun and engaging for meme coin audiences
    - Clean background or simple gradient
    Do NOT include any text, words, letters, or numbers in the image.
    Focus on creating an iconic, instantly recognizable mascot or symbol.`;

  console.log(`🎨 Generating image for theme: ${theme} (style: ${style})`);

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality: 'standard',
      style: 'vivid',
    });

    if (!response.data || response.data.length === 0 || !response.data[0].url) {
      throw new Error('No image URL in OpenAI response');
    }

    const imageUrl = response.data[0].url;
    console.log(`✅ Image generated successfully`);
    return imageUrl;
  } catch (error) {
    console.error('Failed to generate image:', error);
    throw error;
  }
}

/**
 * Generate image and download to buffer (legacy)
 */
export async function generateTokenImageBuffer(options: ImageGenerationOptions): Promise<Buffer> {
  const imageUrl = await generateTokenImage(options);

  console.log(`📥 Downloading image from OpenAI CDN...`);
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
