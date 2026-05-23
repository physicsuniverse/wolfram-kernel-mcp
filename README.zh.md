# Wolfram Kernel MCP Service

> 让 Claude Code 拥有持久化 Wolfram 语言内核 — 像 Notebook 一样逐 cell 追加代码，状态持续累积。通过 MCP 协议集成。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-ff69b4)](https://bun.sh)
[![Wolfram](https://img.shields.io/badge/Wolfram-Engine-dd1100)](https://www.wolfram.com/engine/)

[English](README.md)

---

## 能用吗？

**能用，但配置必须正确。** 这是一个单机工具：本地启动 `wolframscript` 进程，通过 MCP stdio 协议暴露给 Claude Code。出问题通常三个原因：

1. **路径不匹配** — MCP 配置中的路径必须是**本机的绝对路径**
2. **`bun` 在非交互式 shell 中找不到** — MCP server 启动时不加载 `.zshrc`
3. **Wolfram Engine 没装**或 `wolframscript` 路径不对

前置条件满足、路径正确，就能用。还不行看[故障排查](#故障排查)。

## 项目概览

传统 `wolframscript` 每次调用都启动新进程，变量全部丢失。本项目保持内核进程存活，实现真正的交互式计算：

```
传统方式:    每次调用 = 新进程 → 变量丢失
本项目:      持久化内核 → 变量持续累积 → Notebook 式工作流
```

### 核心特性

- **持久会话** — 内核进程存活，变量跨调用可用
- **MCP 协议** — Claude Code 直接调用
- **多会话并行** — 多个独立内核，互不干扰
- **图形自动导出** — Plot / Graphics3D 自动导出 PNG
- **会话快照** — 随时保存/恢复内核状态
- **故障隔离** — 单会话崩溃不影响其他

## 前置条件

| 依赖 | 版本 | 安装 |
|:-----|:-----|:-----|
| **Wolfram Engine / Mathematica** | 13.0+ | [wolfram.com/engine](https://www.wolfram.com/engine/) |
| **Bun** | 1.1+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** | 2.1+ | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |

验证：
```bash
wolframscript -version
bun --version
```

图形功能需要 Professional/Educational 许可，检查：`wolframscript -code '$LicenseType'`

## 快速开始

```bash
git clone https://github.com/physicsuniverse/wolfram-kernel-mcp.git
cd wolfram-kernel-mcp
bun install
bun run build
```

### 配置 Claude Code MCP

编辑 `.claude/mcp.json`（项目级）或 `~/.claude/mcp.json`（全局）：

```json
{
  "mcpServers": {
    "wolfram-kernel": {
      "command": "bun",
      "args": ["run", "/你的绝对路径/wolfram-kernel-mcp/dist/index.js"],
      "description": "Persistent Wolfram Language kernel service"
    }
  }
}
```

路径必须用**绝对路径**。在项目根目录运行 `pwd` 获取。

### 重启验证

重启 Claude Code，然后说：

> "创建一个 Wolfram session，计算 1+1"

返回 `2` 即配置成功。

## 使用方式

直接用自然语言对话，AI 自动调用对应工具：

| 你说 | AI 做 |
|------|------|
| "建一个 physics session" | `wolfram_session_create(name="physics")` |
| "求解 x²+2x-8=0" | `wolfram_execute(code="Solve[...]")` |
| "把结果画出来" | `wolfram_execute(code="Plot[...]")` → [PNG] |
| "看看有哪些 session" | `wolfram_session_list` |
| "保存快照" | `wolfram_session_snapshot` |
| "关掉 X session" | `wolfram_session_delete` |

会话完全隔离，变量互不泄漏。图形自动导出到 `/tmp/wolfram-kernel/`。

## 工具参考

| 工具 | 参数 | 说明 |
|------|------|------|
| `wolfram_session_create` | `name`（必填） | 创建持久化内核会话 |
| `wolfram_execute` | `sessionId`, `code` | 执行代码，返回文本+图形路径 |
| `wolfram_session_list` | — | 列出所有活跃会话 |
| `wolfram_session_delete` | `sessionId` | 销毁会话，释放资源 |
| `wolfram_session_variables` | `sessionId` | 列出用户定义的全局变量 |
| `wolfram_session_snapshot` | `sessionId` | 导出所有定义文本，可恢复 |

超时 30 秒，SIGTERM/SIGINT 时自动清理所有会话。

## 项目结构

```
.
├── README.md            # 英文文档
├── README.zh.md         # 中文文档（本文件）
├── LICENSE              # MIT
├── package.json
├── tsconfig.json
├── wolfram.sh           # Shell 便捷脚本
├── claude/mcp.json      # MCP 配置模板
└── src/
    ├── index.ts              # 入口 — StdioServerTransport
    ├── mcp-tools.ts          # 6 个 Tool 定义 + 输出格式化
    ├── kernel-manager.ts     # Singleton 门面
    ├── session.ts            # 会话生命周期 + 图形处理
    ├── protocol.ts           # wolframscript -linewise 通信协议
    ├── types.ts              # TypeScript 类型定义
    └── utils/
        ├── result-parser.ts  # 输出解析（文本/图形/错误）
        └── graphics.ts       # PNG 导出（Export[Out[n]]）
```

## 架构

```
Claude Code (AI Agent)
    │  MCP (stdin/stdout JSON-RPC)
    ▼
MCP Tool Handler  →  KernelManager (Singleton)
                         │
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
 Session A           Session B           Session C
 wolframscript       wolframscript       wolframscript
 -linewise           -linewise           -linewise
```

每个会话是独立的 `wolframscript -linewise` 进程。通信使用哨兵协议：代码写入 stdin，读取 stdout 直到唯一哨兵出现。

## 故障排查

### MCP Server 启动失败

```bash
bun run src/index.ts
# 预期输出: Wolfram Kernel Service MCP Server started
```

失败则：`rm -rf node_modules && bun install && bun run build`

### 非交互式 shell 找不到 bun

MCP server 在干净环境中启动。用绝对路径：

```json
"command": "/Users/你的用户名/.bun/bin/bun"
```

查找 bun 路径：`which bun`

### wolframscript 找不到

```bash
which wolframscript
# 预期: /usr/local/bin/wolframscript
```

否则修改 `src/protocol.ts` 的 `DEFAULT_WOLFRAMSCRIPT_PATH`，重新 `bun run build`。

### 会话 dead

内核崩溃，删掉重建。

### 图形不生成

```bash
wolframscript -code '$LicenseType'
```
- `"Professional"` / `"Enterprise"` — 支持
- `"Free"` — 可能不支持 Export

### 僵尸进程

```bash
pkill -f wolframscript
rm -rf /tmp/wolfram-kernel/
```

### 还不行？

1. `ls dist/index.js` — 不存在则 `bun run build`
2. `cat .claude/mcp.json | python3 -m json.tool` — 检查 JSON 合法性
3. 路径必须是绝对路径（以 `/` 开头）
4. 完全退出 Claude Code 后重启

## 已知限制

- **`kernelPath` 参数未生效** — 需在 `protocol.ts` 中修改路径并重新编译
- **30 秒超时** — 调整 `session.ts` 中的 `EXECUTION_TIMEOUT_MS`
- **仅本地** — stdio 通信，无认证，不支持多用户

## 开源协议

MIT — 详见 [LICENSE](LICENSE)。
