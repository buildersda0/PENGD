import dotenv from 'dotenv';
import { keypairFromPrivateKey } from '../utils/wallet.js';
import { Connection, VersionedTransaction, Keypair, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js';
import fetch from 'node-fetch';
import FormData from 'form-data';

dotenv.config();

const PUMPPORTAL_API = "https://pumpportal.fun/api";
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com/";

export interface CreatorFeeInfo {
  claimable: number;
  totalEarned: number;
  totalClaimed: number;
}

export interface TradeRequest {
  action: "buy" | "sell";
  mint: string;
  amount: number;
  denominatedInSol: boolean;
  slippage: number;
  priorityFee?: number;
  publicKey: string;
}

export interface TradeResponse {
  signature?: string;
  error?: string;
}

export interface LaunchTokenRequest {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  initialBuyAmount?: number;
}

export interface LaunchTokenResponse {
  mint?: string;
  signature?: string;
  error?: string;
}

export async function checkCreatorFees(mint: string): Promise<CreatorFeeInfo | null> {
  try {
    const url = new URL(`${PUMPPORTAL_API}/creator-fees`);
    url.searchParams.set("mint", mint);

    console.log(`🔍 Checking creator fees for mint: ${mint.substring(0, 8)}...`);
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`   No creator fees endpoint found (404) - returning zero`);
        return { claimable: 0, totalEarned: 0, totalClaimed: 0 };
      }
      const errorText = await response.text();
      console.error(`   HTTP ${response.status}: ${errorText}`);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { claimable?: number; totalEarned?: number; totalClaimed?: number };
    const result = {
      claimable: data.claimable || 0,
      totalEarned: data.totalEarned || 0,
      totalClaimed: data.totalClaimed || 0,
    };
    console.log(`   Creator fees: ${result.claimable.toFixed(4)} SOL claimable, ${result.totalEarned.toFixed(4)} SOL total earned`);
    return result;
  } catch (error) {
    console.error('Failed to check creator fees:', error);
    return null;
  }
}

export async function claimCreatorFees(privateKey: string, mint: string): Promise<string | null> {
  try {
    const keypair = keypairFromPrivateKey(privateKey);
    const publicKey = keypair.publicKey.toBase58();
    
    console.log(`💰 Requesting claim transaction from PumpPortal...`);
    console.log(`   Mint: ${mint.substring(0, 8)}...`);
    console.log(`   Public Key: ${publicKey.substring(0, 8)}...`);
    
    // Use trade-local endpoint with "collectCreatorFee" action
    // This is the correct way according to PumpPortal docs
    const response = await fetch(`${PUMPPORTAL_API}/trade-local`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        publicKey: publicKey,
        action: "collectCreatorFee",
        mint: mint,
        priorityFee: 0.0001,
      })
    });

    console.log(`   Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      
      // 400 errors typically mean no fees to claim - DON'T WASTE GAS, return early
      if (response.status === 400) {
        console.log(`   ℹ️  No fees available to claim (this is normal if there's been no trading)`);
        console.log(`   ✅ Saved transaction costs by not creating unnecessary accounts`);
        return null;
      }
      
      // Other errors are actual problems
      console.error(`❌ PumpPortal claim API error (${response.status}):`, errorText);
      throw new Error(`Failed to get claim transaction (${response.status}): ${errorText}`);
    }

    // PumpPortal returns binary transaction data
    console.log(`📦 Deserializing transaction from binary response...`);
    const data = await response.arrayBuffer();
    if (!data || data.byteLength === 0) {
      throw new Error('Empty response from PumpPortal API');
    }
    
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));

    // Sign and send transaction
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    console.log(`✍️ Signing transaction...`);
    tx.sign([keypair]);

    console.log(`✈️ Sending transaction...`);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3
    });
    
    console.log(`📝 Claim transaction sent: ${signature}`);
    console.log(`   View: https://solscan.io/tx/${signature}`);
    
    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({
      signature,
      ...latestBlockhash
    }, 'confirmed');
    
    console.log(`✅ Claim transaction confirmed!`);
    return signature;
  } catch (error) {
    console.error('Failed to claim creator fees:', error);
    return null;
  }
}

export async function executeTrade(privateKey: string, request: TradeRequest): Promise<TradeResponse> {
  try {
    const keypair = keypairFromPrivateKey(privateKey);
    
    // Get unsigned transaction from PumpPortal
    const url = new URL(`${PUMPPORTAL_API}/trade-local`);

    const body = {
      publicKey: request.publicKey,
      action: request.action,
      mint: request.mint,
      amount: request.amount,
      denominatedInSol: request.denominatedInSol ? "true" : "false",
      slippage: request.slippage,
      priorityFee: request.priorityFee || 0.0001,
      pool: "auto", // Auto-detect pool (pump.fun or raydium after migration)
    };

    console.log(`📤 Sending trade request to PumpPortal:`, {
      action: body.action,
      mint: body.mint.substring(0, 8) + '...',
      amount: body.amount,
      publicKey: body.publicKey.substring(0, 8) + '...'
    });

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Try to get error message as text
      const errorText = await response.text();
      console.error(`❌ PumpPortal API error (${response.status}):`, errorText);
      throw new Error(`Failed to get trade transaction (${response.status}): ${errorText}`);
    }

    // PumpPortal returns the transaction as binary data (not JSON)
    // Similar to how launchToken handles it - see line 262
    console.log(`📦 Deserializing transaction from binary response...`);
    const data = await response.arrayBuffer();
    
    if (!data || data.byteLength === 0) {
      throw new Error('Empty response from PumpPortal API');
    }

    // Sign and send transaction immediately (blockhash from PumpPortal should be fresh)
    // Use 'confirmed' commitment level as per PumpPortal docs
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    
    // Sign immediately
    tx.sign([keypair]);

    // Send transaction immediately to avoid blockhash expiration
    // PumpPortal provides fresh transactions, so send right away
    console.log(`✍️ Signing and sending transaction...`);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3
    });
    
    console.log(`✈️ Transaction sent: ${signature}`);
    console.log(`📝 View on Solscan: https://solscan.io/tx/${signature}`);
    
    // Wait for confirmation with latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({
      signature,
      ...latestBlockhash
    }, 'confirmed');

    return { signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Trade failed:', error);
    return { error: message };
  }
}

export async function launchToken(
  privateKey: string,
  request: LaunchTokenRequest
): Promise<LaunchTokenResponse> {
  try {
    const signerKeypair = keypairFromPrivateKey(privateKey);
    const mintKeypair = Keypair.generate();
    
    console.log(`🚀 Preparing launch for ${request.name} (${request.symbol})`);
    console.log(`🔑 Mint address: ${mintKeypair.publicKey.toBase58()}`);

    // 1. Fetch the image from the provided URL (Pinata)
    console.log(`📥 Fetching image from ${request.imageUrl}...`);
    const imageResponse = await fetch(request.imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.buffer();

    // 2. Upload metadata to Pump.fun IPFS
    console.log(`📤 Uploading metadata to Pump.fun IPFS...`);
    const formData = new FormData();
    formData.append('name', request.name);
    formData.append('symbol', request.symbol);
    formData.append('description', request.description);
    formData.append('showName', 'true');
    if (request.twitter) formData.append('twitter', request.twitter);
    if (request.telegram) formData.append('telegram', request.telegram);
    if (request.website) formData.append('website', request.website);
    
    // Append image file
    formData.append('file', imageBuffer, {
      filename: 'token_image.png',
      contentType: 'image/png'
    });

    const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
      method: 'POST',
      body: formData
    });

    if (!metadataResponse.ok) {
      const errorText = await metadataResponse.text();
      throw new Error(`Failed to upload metadata to Pump.fun: ${errorText}`);
    }

    const metadataJson = await metadataResponse.json() as { 
      metadataUri: string;
      metadata?: {
        name?: string;
        symbol?: string;
      };
    };
    console.log(`✅ Metadata uploaded: ${metadataJson.metadataUri}`);

    // 3. Create token transaction via PumpPortal Local API
    const buyAmount = request.initialBuyAmount || 0.01;
    console.log(`🔄 Requesting creation transaction...`);
    console.log(`   Initial buy amount: ${buyAmount} SOL`);
    console.log(`   Priority fee: 0.0005 SOL`);
    console.log(`   Slippage: 10%`);
    
    const response = await fetch(`${PUMPPORTAL_API}/trade-local`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        publicKey: signerKeypair.publicKey.toBase58(),
        action: "create",
        tokenMetadata: {
          name: metadataJson.metadata?.name || request.name,
          symbol: metadataJson.metadata?.symbol || request.symbol,
          uri: metadataJson.metadataUri
        },
        mint: mintKeypair.publicKey.toBase58(),
        denominatedInSol: "true",
        amount: buyAmount,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
        isMayhemMode: "false"
      })
    });

    if (response.status !== 200) {
      const errorText = await response.text();
      console.error(`❌ PumpPortal API error (${response.status}):`, errorText);
      throw new Error(`Failed to get create transaction: ${errorText}`);
    }

    // 4. Deserialize transaction from binary response (as per PumpPortal docs)
    console.log(`📦 Deserializing transaction from binary response...`);
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    
    // 5. Sign transaction with both keypairs (mint + signer)
    console.log(`✍️ Signing transaction with mint and signer keypairs...`);
    tx.sign([mintKeypair, signerKeypair]);

    // 6. Send transaction
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    
    // Check balance one more time before sending
    const balance = await connection.getBalance(signerKeypair.publicKey);
    const balanceSOL = balance / 1_000_000_000; // LAMPORTS_PER_SOL
    console.log(`💰 Current wallet balance: ${balanceSOL.toFixed(4)} SOL`);
    
    console.log(`✈️ Sending transaction...`);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3
    });
    
    console.log(`📝 Transaction signature: ${signature}`);
    console.log(`✅ Transaction sent! View on Solscan: https://solscan.io/tx/${signature}`);

    return {
      mint: mintKeypair.publicKey.toBase58(),
      signature
    };

  } catch (error) {
    console.error('Token launch failed:', error);
    
    // Extract detailed error information
    let message = error instanceof Error ? error.message : String(error);
    
    // Check if it's a SendTransactionError with logs
    if (error && typeof error === 'object' && 'logs' in error) {
      const logs = (error as any).logs || [];
      console.error('Transaction logs:', logs);
      
      // Add helpful context for common errors
      if (message.includes('0x1')) {
        message = `Insufficient balance to complete transaction. The wallet needs more SOL to cover: token creation fees (~0.01 SOL) + initial buy amount + account rent (~0.01 SOL) + priority fees (~0.0005 SOL) + buffer for network fees. Please add at least 0.05 SOL to your wallet. Original error: ${message}`;
      }
    }
    
    return { error: message };
  }
}
