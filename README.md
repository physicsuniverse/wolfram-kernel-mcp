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

**Yes — but you need to get the configuration right.** This is a single-machine tool: it runs a local `wolframscript` process, exposes it via MCP stdio transport, and Claude Code calls it. The most common failure modes are:

1. **Path mismatch** — the MCP config must use an **absolute path** to `dist/index.js` on YOUR machine
2. **`bun` not in PATH** for non-interactive shells — MCP servers are launched without your shell rc files
3. **Wolfram Engine not installed** or `wolframscript` not at `/usr/local/bin/wolframscript`

If you've installed the prerequisites and configured the paths correctly, it works. If it still doesn't start, check **Section 7 (Troubleshooting)** below.

## Prerequisites

| Dependency | Min Version | How to Install |
|:-----------|:------------|:---------------|
| **Wolfram Engine** (free) or **Mathematica** | 13.0+ | [wolfram.com/engine](https://www.wolfram.com/engine/) |
| **Bun** | 1.1+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** | 2.1+ | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |

### Verify

```bash
wolframscript -version     # e.g. WolframScript 1.11.0
bun --version              # e.g. 1.3.3
```

> **Graphics output** requires a Professional or Educational Mathematica license. The free Wolfram Engine may not support `Export` for graphics. Check: `wolframscript -code '$LicenseType'`

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/wolfram-kernel-mcp.git
cd wolfram-kernel-mcp/wolfram-kernel-service
bun install
bun run build
```

### 2. Configure Claude Code MCP

Edit `.claude/mcp.json` in your project root (or `~/.claude/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "wolfram-kernel": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/TO/wolfram-kernel-service/dist/index.js"],
      "description": "Persistent Wolfram Language kernel service"
    }
  }
}
```

**Critical:** replace `/ABSOLUTE/PATH/TO/` with the real absolute path on your machine. Relative paths do NOT work in MCP configs.

To find your path:
```bash
cd wolfram-kernel-service && pwd
# → /Users/you/projects/wolfram-kernel-mcp/wolfram-kernel-service
```

Then the `args` field becomes:
```
["run", "/Users/you/projects/wolfram-kernel-mcp/wolfram-kernel-service/dist/index.js"]
```

### 3. Restart Claude Code

Quit and relaunch Claude Code. On startup you should see:

```
Wolfram Kernel Service MCP Server started
```

If you don't see this line, check **Section 7**.

### 4. Test

In Claude Code, ask:

> "Create a Wolfram session and compute 1+1"

If the AI returns `2`, you're set up correctly. If it says "unknown tool" or errors out, the MCP server isn't connecting — double-check your `.claude/mcp.json` path and restart.

---

## How to Use

You talk to Claude Code naturally. The AI picks the right tool automatically:

| You say | AI does |
|---------|---------|
| "Create a physics session" | `wolfram_session_create(name="physics")` |
| "Solve x² + 2x - 8 = 0" | `wolfram_execute(code="Solve[...]")` |
| "Plot the result" | `wolfram_execute(code="Plot[...]")` → [PNG] |
| "What sessions are active?" | `wolfram_session_list` |
| "Save a snapshot" | `wolfram_session_snapshot` |
| "Clean up the physics session" | `wolfram_session_delete` |

Sessions are **isolated processes** — variables in one session never leak into another. Graphics are auto-exported as PNG files.

---

## Tools Reference

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `wolfram_session_create` | `name` (required), `kernelPath` (optional) | Start a new persistent kernel |
| `wolfram_execute` | `sessionId`, `code` | Run Wolfram Language code, returns text + graphics paths |
| `wolfram_session_list` | — | List all active sessions and their status |
| `wolfram_session_delete` | `sessionId` | Kill kernel process, free resources |
| `wolfram_session_variables` | `sessionId` | List user-defined global variables |
| `wolfram_session_snapshot` | `sessionId` | Dump all definitions for later restore |

All session state lives in `/tmp/wolfram-kernel/<sessionId>/` and is lost on reboot.

---

## Project Structure

```
wolfram-kernel-mcp/
├── README.md                         # This file (English)
├── README.zh.md                      # Chinese documentation
├── LICENSE                           # MIT
│
├── wolfram-kernel-service/           # MCP Server (TypeScript / Bun)
│   ├── src/
│   │   ├── index.ts                  # Entry — StdioServerTransport
│   │   ├── mcp-tools.ts              # 6 tool definitions + formatting
│   │   ├── kernel-manager.ts         # Singleton facade
│   │   ├── session.ts                # Session lifecycle + graphics
│   │   ├── protocol.ts               # wolframscript -linewise IPC
│   │   ├── types.ts                  # Shared TypeScript types
│   │   └── utils/
│   │       ├── result-parser.ts      # Output parser (text/graphics/error)
│   │       └── graphics.ts           # PNG export via Export[Out[n]]
│   ├── dist/index.js                 # Compiled entry (run `bun run build`)
│   ├── package.json
│   └── tsconfig.json
│
├── wolfram.sh                        # Bash helper: quick Wolfram code execution
├── wolfram_repl.py                   # Standalone Python REPL (no MCP needed)
├── wolfram_daemon.py                 # Unix-socket Wolfram daemon
│
├── calculus_intro.md                 # Demo: calculus tutorial (Wolfram-generated plots)
├── common_integrals.md               # Demo: integral table
└── schwarzschild_tensors.md          # Demo: GR tensor analysis (Schwarzschild metric)
```

---

## Architecture

```
Claude Code (AI Agent)
    │
    │ MCP (stdin/stdout JSON-RPC)
    ▼
MCP Tool Handler
    │
    ▼
KernelManager (Singleton)
    │
    ├── Session "physics" ─── wolframscript -linewise (PID: 1234)
    ├── Session "finance"  ─── wolframscript -linewise (PID: 5678)
    └── Session "algebra"  ─── wolframscript -linewise (PID: 9012)
```

Each session is an independent `wolframscript -linewise` process. Communication uses a **sentinel-based protocol**: code is written to stdin, a unique sentinel is printed, and stdout is read until the sentinel appears. This avoids parsing `In[n]:= / Out[n]=` prompt boundaries.

Timeout is 30 seconds per execution. SIGTERM/SIGINT triggers clean shutdown of all sessions.

---

## Troubleshooting

### MCP server doesn't start

**Test the server manually:**
```bash
cd wolfram-kernel-service
bun run src/index.ts
# Expected output: "Wolfram Kernel Service MCP Server started"
```

If it fails:
- `bun install` not run → run it
- Missing `@modelcontextprotocol/sdk` → `rm -rf node_modules && bun install`

### "bun: command not found" in non-interactive shells

MCP servers are launched in a clean environment (no `.zshrc` / `.bashrc`). If `bun` is only in your shell rc file, use the absolute path in `mcp.json`:

```json
{
  "mcpServers": {
    "wolfram-kernel": {
      "command": "/Users/YOUR_USER/.bun/bin/bun",
      "args": ["run", "/ABSOLUTE/PATH/TO/wolfram-kernel-service/dist/index.js"]
    }
  }
}
```

Find your bun path: `which bun`

### wolframscript not found

```bash
which wolframscript
# Expected: /usr/local/bin/wolframscript
```

If different, edit `src/protocol.ts` and change `DEFAULT_WOLFRAMSCRIPT_PATH`, then rebuild:
```bash
bun run build
```

### Session shows "dead" status

The kernel process crashed. Delete and recreate:
```
"Delete session X and create a new one"
```

### Graphics not generated

Check your Wolfram license type:
```bash
wolframscript -code '$LicenseType'
```
- `"Professional"` / `"Enterprise"` — full graphics support
- `"Free"` — Wolfram Engine free tier, may not support `Export`

### Zombie wolframscript processes

```bash
pkill -f wolframscript
rm -rf /tmp/wolfram-kernel/
```

### Still not working?

1. Verify `dist/index.js` exists: `ls -la wolfram-kernel-service/dist/index.js`
2. If missing, run: `cd wolfram-kernel-service && bun run build`
3. Check MCP config JSON is valid: `cat .claude/mcp.json | python3 -m json.tool`
4. Make sure the path in `mcp.json` is absolute (starts with `/`)
5. Restart Claude Code completely (quit and relaunch)

---

## Known Limitations

- **`kernelPath` parameter is not yet wired** — Wolfram binary path is hardcoded in `protocol.ts`. Change it there and rebuild if your wolframscript is not at `/usr/local/bin/wolframscript`.
- **Single graphics per execution works reliably** — multiple plots in one `wolfram_execute` call should work after the v1.0.1 fixes, but edge cases remain.
- **No authentication / network isolation** — this runs entirely on localhost over stdio. It's safe for local use but not designed for multi-tenant or remote access.
- **30-second timeout** — computations exceeding 30 seconds are terminated. Adjust `EXECUTION_TIMEOUT_MS` in `session.ts` if needed.

---

## License

MIT — see [LICENSE](LICENSE).
