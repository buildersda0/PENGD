/**
 * Gemini Image Generation Client (Nano Banana Pro)
 * 
 * Uses Gemini API for image generation with reference images.
 * Supports gemini-3-pro-image-preview and gemini-2.5-flash-image.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { ExtractedConcept, ImageFormat } from '../research/concept-extractor.js';

dotenv.config();

export interface GeminiImageOptions {
  concept: ExtractedConcept;
  format: ImageFormat;
  referenceImages?: string[];  // Paths to reference images
  tweetImageUrl?: string;
  resolution?: '1K' | '2K' | '4K';
}

export interface GeminiGeneratedImage {
  data: Buffer;
  mimeType: string;
  format: ImageFormat;
  path: string;
}

/**
 * Build prompt - simple and direct, let the reference images do the work
 * CRITICAL: References are for STYLE only, not content to copy
 */
function buildPrompt(concept: ExtractedConcept, format: ImageFormat): string {
  // Simple prompts - reference images handle the style
  const name = concept.name;
  const theme = concept.coreTheme;
  const symbol = concept.symbol;
  
  if (format === 'coin') {
    // COIN: ALWAYS use simple reference-based approach, IGNORE custom imagePrompt
    // Claude's detailed prompts create cluttered multi-element images
    // References show the exact simple style we need
    return `Use the attached images ONLY as STYLE REFERENCE (art style, hand-drawn look, circular coin shape).

STRICT RULES:
- NO TEXT at all (no symbol, no name, no words, no letters)
- Draw ONLY ONE simple element that represents: ${name}
- DO NOT add multiple symbols, icons, or objects
- ONE character/object ONLY - keep it minimal like the references
- Background: solid color matching the main element
- Simple, clean, minimalist design
- Circular coin format

Theme inspiration (for mood/color only): ${theme}

Example: If it's "Demon Times", draw ONLY a simple demon face. If it's "Time", draw ONLY a clock. ONE element.`;
    
  } else if (format === 'index') {
    // INDEX: ALWAYS use simple reference-based approach, IGNORE custom imagePrompt
    // The references show the exact format we need
    return `Use the attached images ONLY as STYLE REFERENCE.

STRICT RULES:
- Put "${symbol}" in the CENTER (like the references show ABC6900, SPDM50, etc)
- Use the reference images' style and aesthetic EXACTLY
- Background style should match the references
- DO NOT create charts, graphs, or specific content
- Just the symbol prominently displayed in center with reference style

Theme inspiration (for color/mood only): ${theme}`;
    
  } else if (format === 'one') {
    // ONE: ALWAYS use simple reference-based approach, IGNORE custom imagePrompt
    // References show the exact composition style we need
    return `Use the attached images ONLY as STYLE REFERENCE for composition.

STRICT RULES:
- Match the reference style EXACTLY (central element + surrounding characters)
- DO NOT copy their specific characters - create NEW ones for "${name}"
- Central glowing element with characters around it
- Use the reference layout and aesthetic

Theme inspiration (for mood/color only): ${theme}`;
    
  } else {
    // ASCII: ALWAYS use simple reference-based approach, IGNORE custom imagePrompt
    // References show the exact ASCII style we need
    return `Use the attached images ONLY as STYLE REFERENCE.

CRITICAL STRUCTURE:
1. TOP: "${name}" in stylized ASCII text (like "shrimpcoin" or "RUST" references - thick outlined letters)
2. MIDDLE: SIMPLE ASCII art of ${name} (like the CAT reference - made from basic characters: / \\ | - _ ( ) etc)
3. Background: dark with color matching ${name}

STYLE RULES:
- Text: Thick, stylized ASCII font with outlines (reference: shrimp.png, RUST.png style)
- ASCII art: SIMPLE character art using basic symbols (reference: CAT.png style - keep it minimal!)
- Color: matches the ${name} concept
- Dark background (black or very dark)

Theme: ${theme}

Generate SIMPLE ASCII art, not complex diagrams.`;
  }
}

/**
 * Download image from URL to temporary file
 */
async function downloadImageToTemp(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image from ${url}: ${response.statusText}`);
  }
  
  const buffer = await response.buffer();
  const tempDir = path.join(process.cwd(), 'temp_images');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const filename = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
  const tempPath = path.join(tempDir, filename);
  fs.writeFileSync(tempPath, buffer);
  
  return tempPath;
}

/**
 * Load image as base64 part for Gemini (handles both URLs and local paths)
 */
async function fileToPart(filePath: string) {
  let actualPath = filePath;
  
  // Check if it's a URL
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    console.log(`  📥 Downloading image from URL: ${filePath.substring(0, 60)}...`);
    actualPath = await downloadImageToTemp(filePath);
    console.log(`  ✓ Downloaded to: ${actualPath}`);
  } else {
    // Local file path
    actualPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(process.cwd(), filePath);
  }
    
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(actualPath)).toString("base64"),
      mimeType: "image/png"
    },
  };
}

/**
 * Generate token image using Gemini API directly
 */
export async function generateTokenImageWithGemini(options: GeminiImageOptions): Promise<GeminiGeneratedImage> {
  const { concept, format, referenceImages = [], resolution = '1K' } = options;
  
  console.log(`🍌 Generating ${format.toUpperCase()} image with Gemini for: ${concept.name} (${concept.symbol})`);
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in environment variables');
  }

  // Initialize Gemini client
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Prepare contents
  const promptText = buildPrompt(concept, format);
  console.log(`📝 Prompt: ${promptText}`);
  
  const contents: any[] = [{ text: promptText }];
  
  // Add reference images
  console.log(`📚 Loading ${referenceImages.length} reference images...`);
  for (const refPath of referenceImages) {
    try {
      const part = await fileToPart(refPath);
      contents.push(part);
      console.log(`  ✓ Loaded reference image`);
    } catch (e) {
      console.warn(`  ⚠️ Failed to load ${refPath}:`, e);
    }
  }

  // Models to try in order
  // SKIP gemini-3-pro-image-preview - it's often overloaded (503) and wastes time
  // Use gemini-2.5-flash-image as default for reliability and quality
  const models = [
    'gemini-2.5-flash-image',    // Default - reliable and fast
    'imagen-3.0-generate-002',   // Imagen fallback if available
  ];

  let lastError: any;

  for (const modelName of models) {
    try {
      console.log(`🎨 Attempting generation with ${modelName}...`);
      
      const model = genAI.getGenerativeModel({ model: modelName });
      
      // Different config for different models
      const generationConfig: any = {};
      
      // Pro model supports imageConfig
      if (modelName.includes('gemini-3-pro')) {
        generationConfig.responseModalities = ["TEXT", "IMAGE"];
        generationConfig.imageConfig = {
          imageSize: resolution
        };
      } 
      // Flash model typically just takes the prompt and images
      
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: contents }],
        generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined
      });

      const response = result.response;
      
      // Find the image part in the response
      if (response.candidates && response.candidates.length > 0) {
        for (const part of response.candidates[0].content.parts) {
           // Check for inlineData (image)
           if (part.inlineData) {
             console.log(`✅ Image generated successfully with ${modelName}`);
             
             const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
             
             // Save to file
             const timestamp = Date.now();
             const outputPath = path.join(process.cwd(), 'generated_images', `${concept.symbol}_${timestamp}.png`);
             const outputDir = path.dirname(outputPath);
             if (!fs.existsSync(outputDir)) {
               fs.mkdirSync(outputDir, { recursive: true });
             }
             fs.writeFileSync(outputPath, imageBuffer);
             
             return {
               data: imageBuffer,
               mimeType: part.inlineData.mimeType || 'image/png',
               format,
               path: outputPath
             };
           }
        }
      }
      
      throw new Error(`No image data found in ${modelName} response`);

    } catch (error: any) {
      console.warn(`⚠️ ${modelName} failed:`, error.message || error);
      lastError = error;
      
      // If it's a "not supported" error (400), we continue. 
      // If it's a 503 (overloaded), we continue.
      // We essentially just try the next model.
      continue;
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError?.message || lastError}`);
}

/**
 * Save Gemini generated image to file
 */
export async function saveGeminiImage(image: GeminiGeneratedImage, outputPath: string): Promise<void> {
  // Image is already saved in generateTokenImageWithGemini, but we can copy it if needed
  // or just log it.
  if (image.path !== outputPath) {
      fs.copyFileSync(image.path, outputPath);
      console.log(`✅ Image saved to: ${outputPath}`);
  }
}
