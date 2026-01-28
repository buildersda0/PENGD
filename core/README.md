# MCP Integration - Model Context Protocol

A lightweight MCP (Model Context Protocol) implementation for AI agents to execute blockchain actions.

## Overview

This MCP integration provides a standardized way for AI agents to interact with Solana blockchain operations for token management. Instead of running a separate MCP server, this implementation is embedded directly into the backend Express application.

## Architecture

```
┌─────────────────────────────────────────┐
│           Express Backend                │
│                                          │
│  ┌────────────────┐  ┌───────────────┐ │
│  │  Agent Routes  │  │  MCP Routes   │ │
│  │  /api/coins    │  │  /mcp/tools   │ │
│  └────────┬───────┘  └───────┬───────┘ │
│           │                   │          │
│           └───────┬───────────┘          │
│                   │                      │
│           ┌───────▼───────┐             │
│           │   Executors   │             │
│           │  (Blockchain)  │             │
│           └────────────────┘             │
└─────────────────────────────────────────┘
```

## Implementation Details

### Why Embedded MCP?

Traditional MCP implementations require:
- Separate server process
- Additional deployment complexity
- Extra configuration

Our embedded approach:
- Single backend process
- Shared database and wallet access
- Same deployment process
- Lower operational overhead

### File Structure

```
src/mcp/
├── README.md         # This file
├── server.ts         # Express router with MCP endpoints
└── tools.ts          # Tool definitions and handlers
```

## Available Tools

### 1. get_coin_state
Get current state and statistics for a token.

**Parameters:**
- `coin_mint` (string): Token mint address

**Returns:**
```json
{
  "name": "Token Name",
  "symbol": "SYM",
  "mint": "...",
  "status": "active",
  "market_cap": 1000000,
  "holders": 150,
  "stats": { ... },
  "enabled_actions": { ... }
}
```

### 2. buyback
Buy tokens from the market using SOL.

**Parameters:**
- `coin_mint` (string): Token mint address
- `amount_sol` (number): Amount of SOL to spend (min: 0.03)

**Returns:**
```json
{
  "success": true,
  "signatures": ["..."]
}
```

### 3. burn_tokens
Burn tokens the agent currently holds to reduce supply permanently.

**Parameters:**
- `coin_mint` (string): Token mint address
- `percentage` (number): Percentage of held tokens to burn (1-100)

**Returns:**
```json
{
  "success": true,
  "signatures": ["..."]
}
```

### 4. airdrop_sol
Distribute SOL rewards to token holders proportionally.

**Parameters:**
- `coin_mint` (string): Token mint address
- `amount_sol` (number): Total SOL to distribute (min: 0.03)

**Returns:**
```json
{
  "success": true,
  "signatures": ["...", "..."]
}
```

### 5. airdrop_tokens
Distribute held tokens to token holders proportionally.

**Parameters:**
- `coin_mint` (string): Token mint address
- `percentage` (number): Percentage of held tokens to airdrop (1-100)

**Returns:**
```json
{
  "success": true,
  "signatures": ["...", "..."]
}
```

### 6. send_sol_to_treasury
Send SOL to the project treasury wallet for strategic activities like DexScreener boosts, marketing campaigns, or development.

**Use Case:**
The treasury wallet owner can use these funds to manually purchase visibility boosts on DexScreener to grow the token's exposure.

**DexScreener Boost Pricing:**
- **10x Boost**: $99 USD (12 hours) ≈ 0.5-1 SOL
- **30x Boost**: $249 USD (12 hours) ≈ 1.5-2.5 SOL
- **50x Boost**: $399 USD (12 hours) ≈ 2-4 SOL
- **100x Boost**: $899 USD (24 hours) ≈ 4.5-9 SOL
- **500x Boost**: $3,999 USD (24 hours) ≈ 20-40 SOL
- **Golden Ticker**: Unlocks at 500 total boosts

**Example Scenario:**
1. Agent analyzes market conditions and determines token needs visibility
2. Agent sends 2.5 SOL to treasury wallet
3. Treasury owner logs into DexScreener and purchases a 30x boost ($249)
4. Token gains increased visibility and trading volume

**Parameters:**
- `coin_mint` (string): Token mint address
- `amount_sol` (number): Amount of SOL to send to treasury (min: 0.03)

**Returns:**
```json
{
  "success": true,
  "signatures": ["..."]
}
```

**Important Notes:**
- The agent does NOT purchase boosts automatically
- Boost purchases are manual actions by the treasury wallet owner
- Consider SOL/USD exchange rate when planning boost funding
- Agent's reasoning will include boost cost context in decision-making

### 7. send_tokens_to_treasury
Send held tokens to the project treasury wallet.

**Parameters:**
- `coin_mint` (string): Token mint address
- `percentage` (number): Percentage of held tokens to send (1-100)

**Returns:**
```json
{
  "success": true,
  "signatures": ["..."]
}
```

## API Endpoints

### GET /mcp/health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

### GET /mcp/tools
List all available tools.

**Response:**
```json
{
  "tools": [
    {
      "name": "buyback",
      "description": "Buy tokens using SOL...",
      "inputSchema": { ... }
    },
    ...
  ]
}
```

### POST /mcp/tools/:toolName
Execute a specific tool.

**Request:**
```json
{
  "arguments": {
    "coin_mint": "...",
    "amount_sol": 0.05
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "success": true,
    "signatures": ["..."]
  }
}
```

## Usage Examples

### Using cURL

```bash
# List available tools
curl http://localhost:8000/mcp/tools

# Execute buyback
curl -X POST http://localhost:8000/mcp/tools/buyback \
  -H "Content-Type: application/json" \
  -d '{
    "arguments": {
      "coin_mint": "9TmwbUj7uD9vLEZfrDPRXc5f7ZeuMejU8v9VfdieUqQW",
      "amount_sol": 0.05
    }
  }'

# Burn 50% of held tokens
curl -X POST http://localhost:8000/mcp/tools/burn_tokens \
  -H "Content-Type: application/json" \
  -d '{
    "arguments": {
      "coin_mint": "9TmwbUj7uD9vLEZfrDPRXc5f7ZeuMejU8v9VfdieUqQW",
      "percentage": 50
    }
  }'
```

### Using JavaScript/TypeScript

```typescript
const MCP_BASE_URL = 'http://localhost:8000/mcp';

// List tools
const tools = await fetch(`${MCP_BASE_URL}/tools`).then(r => r.json());

// Execute buyback
const result = await fetch(`${MCP_BASE_URL}/tools/buyback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    arguments: {
      coin_mint: '9TmwbUj7uD9vLEZfrDPRXc5f7ZeuMejU8v9VfdieUqQW',
      amount_sol: 0.05
    }
  })
}).then(r => r.json());
```

## Testing

### Unit Tests
Test tool definitions and schemas:
```bash
npx tsx tests/test-mcp.ts
```

### Integration Tests
Test MCP HTTP endpoints:
```bash
# Start backend first
npm run dev

# In another terminal
npx tsx tests/test-mcp-integration.ts
```

### Manual Action Tests
Test individual blockchain actions:
```bash
# Buyback tokens
npx tsx tests/manual-action.ts <MINT> buyback 0.05

# Burn tokens
npx tsx tests/manual-action.ts <MINT> burn 50

# Airdrop tokens
npx tsx tests/manual-action.ts <MINT> airdrop_tokens 25

# Send to treasury
npx tsx tests/manual-action.ts <MINT> treasury_sol 0.1 <TREASURY_WALLET>
```

## Token2022 Support

All token operations automatically support both:
- **Token Program** (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)
- **Token2022 Program** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)

The system:
1. Tries Token2022 first (pump.fun uses Token2022)
2. Falls back to standard Token if needed
3. Creates associated token accounts automatically when needed
4. Uses correct program ID for all operations

## Limits and Constraints

- **Minimum SOL amount**: 0.03 SOL for all SOL-based actions
- **Token percentage**: 1-100% for all token-based actions
- **Auto-claim threshold**: 0.001 SOL (fees claimed automatically)
- **One action per round**: Agent can only execute one tool per round
- **Rate limiting**: 100ms delay between airdrop recipients

## Error Handling

All tools return a consistent result structure:

**Success:**
```json
{
  "success": true,
  "signatures": ["tx1", "tx2"]
}
```

**Failure:**
```json
{
  "success": false,
  "signatures": [],
  "error": "Description of what went wrong"
}
```

Common errors:
- `No token account found` - Agent doesn't have tokens
- `Buyback not enabled` - Action disabled for this coin
- `Invalid amount (min 0.03 SOL)` - Amount below minimum
- `No holders to airdrop to` - No holders found

## Integration with Agent

The agent uses these MCP tools during each round:

1. **State Check**: Gets current coin state
2. **Decision Making**: Analyzes data and chooses action
3. **Execution**: Calls appropriate MCP tool
4. **Logging**: Records action and results

See `src/scheduler/round-scheduler.ts` for implementation details.

## Deployment

The MCP integration is automatically deployed with the backend:

1. No separate server process needed
2. No additional ports required
3. Same authentication/security model
4. Shared database and wallet access

Just deploy the backend as usual:
```bash
npm run build
npm start
```

## Future Enhancements

Potential additions:
- WebSocket support for real-time updates
- Batch operations for multiple coins
- Advanced analytics endpoints
- Custom action plugins
- Rate limiting per tool
- Authentication/API keys

## License

Same as main project.
