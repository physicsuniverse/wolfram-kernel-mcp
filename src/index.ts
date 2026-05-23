import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TOOL_DEFINITIONS } from "./mcp-tools.js";
import { KernelManager } from "./kernel-manager.js";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "wolfram-kernel-service",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---- tools/list handler ----
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
});

// ---- tools/call handler ----
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOL_DEFINITIONS.find((t) => t.name === name);

  if (!tool) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Unknown tool: ${name}. Available tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  try {
    return await tool.handler((args ?? {}) as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[wolfram-kernel] Error in tool ${name}:`, message);
    return {
      content: [{ type: "text" as const, text: `Error executing ${name}: ${message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.error(`\n[wolfram-kernel] Received ${signal}, shutting down sessions...`);
  try {
    const mgr = KernelManager.getInstance();
    const sessions = mgr.list();
    for (const session of sessions) {
      try {
        await mgr.delete(session.id);
        console.error(`[wolfram-kernel] Deleted session: ${session.id}`);
      } catch {
        // Best-effort cleanup per session — carry on
      }
    }
  } catch {
    // KernelManager may not be initialised yet
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Heat up the KernelManager singleton early
  KernelManager.getInstance();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Wolfram Kernel Service MCP Server started");
}

main().catch((error) => {
  console.error("[wolfram-kernel] Fatal startup error:", error);
  process.exit(1);
});
