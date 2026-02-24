#!/usr/bin/env node

/**
 * CAP CDS MCP Server
 *
 * A Composition MCP server that provides SAP CAP CDS-specific tools,
 * designed to run alongside the hana-cli MCP server.
 *
 * Architecture mirrors hana-cli's MCP server (4-file pattern):
 *   index.ts          — MCP server class with stdio transport
 *   cap-tools.ts      — Tool definitions with schemas and handlers
 *   cds-executor.ts   — Hybrid execution engine (in-process + shell)
 *   output-formatter.ts — Structured data → markdown conversion
 *
 * Key differences from hana-cli MCP:
 *   - Static tool registry (not dynamic yargs discovery)
 *   - Hybrid execution: in-process CDS compile + shell for builds
 *   - Structured JSON parsing (not ASCII table parsing)
 *   - `cap_` prefix (complements hana-cli's `hana_` prefix)
 *
 * Usage in Claude Code settings.json:
 *   "mcpServers": {
 *     "cap-tools": {
 *       "command": "node",
 *       "args": ["/Users/aks91/Development/cap-mcp-server/build/index.js"],
 *       "env": {
 *         "CAP_PROJECT_ROOT": "/path/to/your/cap/project"
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ALL_TOOLS, type ToolDefinition } from './cap-tools.js';

class CapMcpServer {
  private server: Server;
  private tools: Map<string, ToolDefinition> = new Map();
  private projectRoot: string;

  constructor() {
    // Resolve the CAP project root:
    // 1. CAP_PROJECT_ROOT env var (explicit)
    // 2. Current working directory (implicit — Claude Code sets this)
    this.projectRoot = process.env.CAP_PROJECT_ROOT || process.cwd();

    this.server = new Server(
      {
        name: 'cap-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerTools();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[CAP MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private registerTools(): void {
    for (const tool of ALL_TOOLS) {
      this.tools.set(tool.name, tool);
    }
    console.error(`[CAP MCP] Registered ${this.tools.size} tools`);
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [];

      for (const [_name, tool] of this.tools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }

      return { tools };
    });

    // Execute tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.tools.get(name);
      if (!tool) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unknown tool: ${name}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
            },
          ],
        };
      }

      try {
        // Resolve project root — allow per-call override via `projectRoot` arg
        const cwd = (args as Record<string, any>)?.projectRoot || this.projectRoot;

        const result = await tool.handler(args as Record<string, any> || {}, cwd);

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing ${name}: ${message}`,
            },
          ],
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error(`[CAP MCP] Server running on stdio`);
    console.error(`[CAP MCP] Project root: ${this.projectRoot}`);
    console.error(`[CAP MCP] Tools: ${Array.from(this.tools.keys()).join(', ')}`);
  }
}

// Start the server
const server = new CapMcpServer();
server.run().catch((error) => {
  console.error('[CAP MCP] Fatal error:', error);
  process.exit(1);
});
