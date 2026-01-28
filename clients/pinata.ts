import dotenv from 'dotenv';
import FormData from 'form-data';
import fetch from 'node-fetch';

dotenv.config();

const PINATA_API_KEY = process.env.PINATA_API_KEY || '';
const PINATA_API_SECRET = process.env.PINATA_API_SECRET || '';
const PINATA_JWT = process.env.PINATA_JWT || '';

const PINATA_API = 'https://api.pinata.cloud';

export interface PinataUploadResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

export async function uploadToPinata(
  fileBuffer: Buffer,
  fileName: string,
  metadata?: { name?: string; description?: string }
): Promise<string> {
  try {
    if (!PINATA_JWT && (!PINATA_API_KEY || !PINATA_API_SECRET)) {
      throw new Error('Pinata credentials not configured. Set PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET in .env');
    }

    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'image/*'
    });

    if (metadata) {
      formData.append('pinataMetadata', JSON.stringify(metadata));
    }

    // Use JWT if available, otherwise use API key/secret
    const headers: Record<string, string> = {
      ...formData.getHeaders()
    };

    if (PINATA_JWT) {
      headers['Authorization'] = `Bearer ${PINATA_JWT}`;
    } else {
      headers['pinata_api_key'] = PINATA_API_KEY;
      headers['pinata_secret_api_key'] = PINATA_API_SECRET;
    }

    // Use node-fetch which properly handles form-data
    const response = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata upload failed: ${errorText}`);
    }

    const data = await response.json() as PinataUploadResponse;
    
    // Return IPFS URL
    return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
  } catch (error) {
    console.error('Pinata upload error:', error);
    throw error;
  }
}
