import { Router, Request, Response } from 'express';
import { MCP_TOOLS, executeToolCall } from './tools.js';

/**
 * MCP Server - HTTP Transport
 * Exposes MCP protocol via HTTP endpoints in the same backend
 */

export const mcpRouter = Router();

/**
 * List available tools
 * GET /mcp/tools
 */
mcpRouter.get('/tools', async (req: Request, res: Response) => {
  try {
    res.json({
      tools: MCP_TOOLS
    });
  } catch (error) {
    console.error('Error listing MCP tools:', error);
    res.status(500).json({
      error: 'Failed to list tools',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Execute a tool
 * POST /mcp/tools/:toolName
 * Body: { arguments: {...} }
 */
mcpRouter.post('/tools/:toolName', async (req: Request, res: Response) => {
  try {
    const { toolName } = req.params;
    const { arguments: args } = req.body;

    console.log(`\n🔧 MCP Tool Call: ${toolName}`);
    console.log(`   Arguments:`, args);

    // Validate tool exists
    const tool = MCP_TOOLS.find(t => t.name === toolName);
    if (!tool) {
      return res.status(404).json({
        error: 'Tool not found',
        message: `Tool "${toolName}" does not exist`
      });
    }

    // Execute tool
    const result = await executeToolCall(toolName, args);

    console.log(`   ✅ Success:`, result);

    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error(`   ❌ Error:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Health check
 * GET /mcp/health
 */
mcpRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    mcp_version: '1.0.0',
    tools_count: MCP_TOOLS.length
  });
});

/**
 * Status endpoint (alias for health, used by plugins)
 * GET /mcp/status
 */
mcpRouter.get('/status', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    mcp_version: '1.0.0',
    tools_count: MCP_TOOLS.length,
    available_tools: MCP_TOOLS.map(t => t.name)
  });
});
