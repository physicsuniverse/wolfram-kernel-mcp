# Wolfram Kernel MCP Service

> Persistent Wolfram Language kernels for Claude Code — notebook-style interactive sessions via the Model Context Protocol.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-ff69b4)](https://bun.sh)
[![Wolfram](https://img.shields.io/badge/Wolfram-Engine-dd1100)](https://www.wolfram.com/engine/)

[中文文档](README.zh.md)

---

## What It Does

Normally, `wolframscript` starts a fresh process for every command — variables die between calls. This project keeps a kernel process **alive in the background**, so state accumulates across executions, just like a Wolfram Notebook.

```
Before:   each call = new process → state lost → can't iterate
After:    persistent kernel → variables survive → notebook workflow
```

Claude Code's AI agent invokes Wolfram Language tools directly through the **MCP protocol** — no manual scripting needed.

## Does It Actually Work?

**Yes — but you need to get the configuration right.** The most common failure modes are:

1. **Path mismatch** — MCP config must use an **absolute path** to `dist/index.js` on YOUR machine
2. **`bun` not in PATH** for non-interactive shells — MCP servers launch without shell rc files
3. **Wolfram Engine not installed** or `wolframscript` not at `/usr/local/bin/wolframscript`

If prerequisites are met and paths are correct, it works. If not, check **Troubleshooting** below.

## Prerequisites

| Dependency | Min Version | Install |
|:-----------|:------------|:--------|
| **Wolfram Engine** or **Mathematica** | 13.0+ | [wolfram.com/engine](https://www.wolfram.com/engine/) |
| **Bun** | 1.1+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** | 2.1+ | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |

Verify:
```bash
wolframscript -version
bun --version
```

> Graphics output requires a Professional/Educational Mathematica license. Check: `wolframscript -code '$LicenseType'`

## Quick Start

```bash
git clone https://github.com/physicsuniverse/wolfram-kernel-mcp.git
cd wolfram-kernel-mcp
bun install
bun run build
```

### Configure Claude Code MCP

Edit `.claude/mcp.json` (project-level) or `~/.claude/mcp.json` (global):

```json
{
  "mcpServers": {
    "wolfram-kernel": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/TO/wolfram-kernel-mcp/dist/index.js"],
      "description": "Persistent Wolfram Language kernel service"
    }
  }
}
```

**Replace `/ABSOLUTE/PATH/TO/`** with your actual path. Run `pwd` in the project root to find it.

### Restart & Test

Restart Claude Code. Then ask:

> "Create a Wolfram session and compute 1+1"

If it returns `2`, you're set.

## How to Use

Talk to Claude Code naturally. The AI picks the right tool:

| You say | AI does |
|---------|---------|
| "Create a physics session" | `wolfram_session_create(name="physics")` |
| "Solve x² + 2x - 8 = 0" | `wolfram_execute(code="Solve[...]")` |
| "Plot the result" | `wolfram_execute(code="Plot[...]")` → [PNG] |
| "What sessions are active?" | `wolfram_session_list` |
| "Save a snapshot" | `wolfram_session_snapshot` |
| "Clean up session X" | `wolfram_session_delete` |

Sessions are isolated processes. Variables never leak between sessions. Graphics auto-export as PNG to `/tmp/wolfram-kernel/`.

## Tools Reference

| Tool | Parameters | Description |
|------|-----------|-------------|
| `wolfram_session_create` | `name` (required) | Start a new persistent kernel process |
| `wolfram_execute` | `sessionId`, `code` | Run Wolfram code; returns text + graphics paths |
| `wolfram_session_list` | — | List all active sessions |
| `wolfram_session_delete` | `sessionId` | Kill kernel, free resources |
| `wolfram_session_variables` | `sessionId` | List user-defined global variables |
| `wolfram_session_snapshot` | `sessionId` | Dump all definitions for later restore |

Timeout: 30 seconds per execution. Sessions auto-clean on SIGTERM/SIGINT.

## Project Structure

```
.
├── README.md          # English docs
├── README.zh.md       # Chinese docs
├── LICENSE            # MIT
├── package.json
├── tsconfig.json
├── wolfram.sh         # Shell helper
├── claude/mcp.json    # MCP config template
└── src/
    ├── index.ts              # Entry — StdioServerTransport
    ├── mcp-tools.ts          # 6 tool definitions + formatting
    ├── kernel-manager.ts     # Singleton facade
    ├── session.ts            # Session lifecycle + graphics
    ├── protocol.ts           # wolframscript -linewise IPC
    ├── types.ts              # Shared TypeScript types
    └── utils/
        ├── result-parser.ts  # Output parser (text/graphics/error)
        └── graphics.ts       # PNG export via Export[Out[n]]
```

## Architecture

```
Claude Code (AI Agent)
    │  MCP (stdin/stdout JSON-RPC)
    ▼
MCP Tool Handler  →  KernelManager (Singleton)
                         │
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
 Session "physics"  Session "finance"  Session "algebra"
 wolframscript      wolframscript      wolframscript
 -linewise          -linewise          -linewise
```

Each session is an independent `wolframscript -linewise` process. Communication uses sentinel-based protocol: code → stdin, read stdout until unique sentinel appears.

## Troubleshooting

### MCP server won't start

```bash
bun run src/index.ts
# Expected: "Wolfram Kernel Service MCP Server started"
```

If it fails: `rm -rf node_modules && bun install && bun run build`

### "bun: command not found"

MCP servers launch in clean environments. Use the absolute path in `mcp.json`:

```json
"command": "/Users/YOU/.bun/bin/bun"
```

Find your bun path: `which bun`

### wolframscript not found

```bash
which wolframscript
# Expected: /usr/local/bin/wolframscript
```

If different, edit `src/protocol.ts` → `DEFAULT_WOLFRAMSCRIPT_PATH`, then `bun run build`.

### Session shows "dead"

Kernel crashed. Delete and recreate.

### Graphics not generated

```bash
wolframscript -code '$LicenseType'
```
- `"Professional"` / `"Enterprise"` — full support
- `"Free"` — may not support `Export`

### Zombie processes

```bash
pkill -f wolframscript
rm -rf /tmp/wolfram-kernel/
```

### Still not working?

1. `ls dist/index.js` — if missing, run `bun run build`
2. `cat .claude/mcp.json | python3 -m json.tool` — check valid JSON
3. Path in `mcp.json` must be absolute (starts with `/`)
4. Completely quit and restart Claude Code

## Known Limitations

- **`kernelPath` parameter not wired** — wolframscript path is hardcoded in `protocol.ts`. Edit and rebuild if needed.
- **30-second timeout** — adjust `EXECUTION_TIMEOUT_MS` in `session.ts`.
- **Local-only** — runs over stdio, no auth, no multi-tenant support.

## License

MIT — see [LICENSE](LICENSE).
