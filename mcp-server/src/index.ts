#!/usr/bin/env node

/**
 * CAP CDS MCP Server — Code Mode
 *
 * 2-tool MCP server: cap_search (model exploration) + cap_execute (data queries).
 * Agent-generated JavaScript runs in VM-sandboxed subprocesses.
 *
 * Design: docs/plans/2026-03-02-code-mode-design.md
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ALL_TOOLS, type ToolDefinition } from './code-mode-tools.js';

class CapMcpServer {
  private server: Server;
  private tools: Map<string, ToolDefinition> = new Map();
  private projectRoot: string;

  constructor() {
    this.projectRoot = process.env.CAP_PROJECT_ROOT || process.cwd();

    this.server = new Server(
      {
        name: 'cap-mcp-server',
        version: '2.0.0',
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
      return {
        tools: Array.from(this.tools.values()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
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
              text: `Unknown tool: ${name}. Available: ${Array.from(this.tools.keys()).join(', ')}`,
            },
          ],
        };
      }

      try {
        const cwd = (args as Record<string, any>)?.projectRoot || this.projectRoot;
        const result = await tool.handler((args as Record<string, any>) || {}, cwd);

        return {
          content: [{ type: 'text' as const, text: result }],
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

    console.error(`[CAP MCP] Server running on stdio (Code Mode)`);
    console.error(`[CAP MCP] Project root: ${this.projectRoot}`);
    console.error(`[CAP MCP] Tools: ${Array.from(this.tools.keys()).join(', ')}`);
  }
}

const server = new CapMcpServer();
server.run().catch((error) => {
  console.error('[CAP MCP] Fatal error:', error);
  process.exit(1);
});
