import { KernelManager } from "./kernel-manager.js";
import type { SessionInfo, ExecutionResult, SessionSnapshot } from "./types.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSessionInfo(info: SessionInfo): string {
  const lines = [
    `**Session:** ${info.name} (\`${info.id}\`)`,
    `- Status: ${info.status}`,
    `- Created: ${info.createdAt}`,
    `- Execution count: ${info.executionCount}`,
  ];
  if (info.variables.length > 0) {
    lines.push(`- Variables: \`${info.variables.join("`, `")}\``);
  }
  return lines.join("\n");
}

function formatExecutionResult(result: ExecutionResult): string {
  const lines = [
    `**Session:** \`${result.sessionId}\``,
    `**Timing:** ${result.timing} ms`,
    `**Success:** ${result.success}`,
    "",
    `**Input:**`,
    "```wolfram",
    result.input,
    "```",
    "",
    "**Outputs:**",
  ];
  if (result.outputs.length === 0) {
    lines.push("_(no output)_");
  } else {
    for (const output of result.outputs) {
      switch (output.type) {
        case "text":
          lines.push(`- Text:`);
          lines.push("  ```text");
          lines.push(`  ${output.content}`);
          lines.push("  ```");
          break;
        case "graphics":
          lines.push(
            `- Graphics (${output.format}): \`${output.filePath}\``,
          );
          break;
        case "error":
          lines.push(`- **Error:** ${output.message}`);
          if (output.stack) {
            lines.push("  ```");
            lines.push(`  ${output.stack}`);
            lines.push("  ```");
          }
          break;
        case "null":
          lines.push("- _(no output)_");
          break;
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ---- wolfram_session_create ----
  {
    name: "wolfram_session_create",
    description:
      "Create a new Wolfram kernel session. Each session has its own isolated " +
      "kernel process with persistent state — variables and definitions persist " +
      "between execute calls. Use this when you need to work with Wolfram Language " +
      "on a task and want to maintain state across multiple code executions.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "A human-readable name for this session, e.g. 'linear-algebra' or 'data-analysis'.",
        },
        kernelPath: {
          type: "string",
          description:
            "Optional path to a MathKernel binary. Defaults to 'wolframscript' on PATH.",
        },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const mgr = KernelManager.getInstance();
      const session = await mgr.createSession(
        args.name as string,
        args.kernelPath as string | undefined,
      );
      const text =
        `Session created successfully.\n\n${formatSessionInfo(session)}`;
      return { content: [{ type: "text", text }] };
    },
  },

  // ---- wolfram_execute ----
  {
    name: "wolfram_execute",
    description:
      "Execute Wolfram Language code in a session. The code runs in the session's " +
      "persistent kernel, so it can use previously defined variables and functions. " +
      "Returns structured results with text, graphics, or error output. Use this for " +
      "any Wolfram computation — defining variables, evaluating expressions, plotting, " +
      "solving equations, etc.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "The ID of the session to execute code in (returned from wolfram_session_create).",
        },
        code: {
          type: "string",
          description:
            "Wolfram Language code to execute. Can be a single expression or multiple lines.",
        },
      },
      required: ["sessionId", "code"],
    },
    handler: async (args) => {
      const mgr = KernelManager.getInstance();
      const result = await mgr.execute(
        args.sessionId as string,
        args.code as string,
      );
      const text = formatExecutionResult(result);
      return { content: [{ type: "text", text }] };
    },
  },

  // ---- wolfram_session_list ----
  {
    name: "wolfram_session_list",
    description:
      "List all active Wolfram kernel sessions with their status. Use this to see " +
      "available sessions, check which are alive, and find session IDs for other commands.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const mgr = KernelManager.getInstance();
      const sessions = mgr.list();
      if (sessions.length === 0) {
        return {
          content: [{ type: "text", text: "No active sessions." }],
        };
      }
      const lines = sessions.map(
        (s: SessionInfo, i: number) => `${i + 1}. ${formatSessionInfo(s)}`,
      );
      const text =
        `**Active sessions (${sessions.length}):**\n\n${lines.join("\n\n")}`;
      return { content: [{ type: "text", text }] };
    },
  },

  // ---- wolfram_session_delete ----
  {
    name: "wolfram_session_delete",
    description:
      "Delete a Wolfram kernel session and free its resources. The kernel process " +
      "is terminated and all session state is lost. Use this to clean up sessions " +
      "that are no longer needed.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The ID of the session to delete.",
        },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const mgr = KernelManager.getInstance();
      await mgr.delete(args.sessionId as string);
      return {
        content: [
          {
            type: "text",
            text: `Session \`${args.sessionId}\` deleted successfully.`,
          },
        ],
      };
    },
  },

  // ---- wolfram_session_variables ----
  {
    name: "wolfram_session_variables",
    description:
      "Get a list of all user-defined variables in a session. Useful for inspecting " +
      "what state has been built up in a kernel before deciding what to do next.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The ID of the session to query.",
        },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const mgr = KernelManager.getInstance();
      const variables = await mgr.getVariables(args.sessionId as string);
      if (variables.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No user-defined variables in this session.",
            },
          ],
        };
      }
      const text =
        `**Variables in \`${args.sessionId}\`:**\n\n` +
        variables.map((v: string) => `- \`${v}\``).join("\n");
      return { content: [{ type: "text", text }] };
    },
  },

  // ---- wolfram_session_snapshot ----
  {
    name: "wolfram_session_snapshot",
    description:
      "Create a snapshot of the current session state that can be saved and later " +
      "restored. Captures all user-defined variables and function definitions as a " +
      "serializable dump. Use this to checkpoint work before risky operations, or to " +
      "save state for later resumption.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The ID of the session to snapshot.",
        },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const mgr = KernelManager.getInstance();
      const snapshot: SessionSnapshot = await mgr.snapshot(
        args.sessionId as string,
      );
      const defCount = snapshot.definitions.length;
      const lines = [
        `**Snapshot of \`${args.sessionId}\`**`,
        `- Timestamp: ${snapshot.timestamp}`,
        `- Definitions captured: ${defCount}`,
      ];
      if (defCount > 0) {
        lines.push("", "**Definitions:**");
        snapshot.definitions.forEach((d) => lines.push(`- \`${d}\``));
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  },
];
