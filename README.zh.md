# Wolfram Kernel MCP Service

> 让 Claude Code 拥有持久化 Wolfram 语言内核 — 像操作 Notebook 一样逐 cell 追加代码，状态持续累积。通过标准 MCP (Model Context Protocol) 协议集成。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-ff69b4)](https://bun.sh)
[![Wolfram](https://img.shields.io/badge/Wolfram-Engine-dd1100)](https://www.wolfram.com/engine/)

[English](README.md)

---

## 目录

- [能用吗？](#能用吗)
- [项目概览](#项目概览)
- [前置条件](#前置条件)
- [快速开始](#快速开始)
- [配置详解](#配置详解)
- [API 参考](#api-参考)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [示例用法](#示例用法)
- [故障排查](#故障排查)
- [已知限制](#已知限制)
- [开源协议](#开源协议)

---

## 能用吗？

**能用，但配置必须正确。** 这是一个单机工具：在本地启动 `wolframscript` 进程，通过 MCP stdio 协议暴露给 Claude Code 调用。出问题通常是以下三个原因之一：

1. **路径不匹配** — MCP 配置中的路径必须是**本机的绝对路径**，`/PATH/TO/` 只是占位符
2. **`bun` 命令找不到** — MCP server 在非交互式 shell 中启动，不会加载 `.zshrc`/`.bashrc`
3. **Wolfram Engine 没装**或 `wolframscript` 路径不对

如果前置条件都满足、路径配置正确，就能用。还是不行的话，看[故障排查](#故障排查)。

---

## 项目概览

传统的 `wolframscript` 每次调用都启动独立进程，上一个命令定义的变量在下一次调用中全部丢失。本项目通过在后台保持内核进程存活，实现真正的交互式计算体验：

```
传统方式:    每次调用 = 新进程 → 变量丢失 → 无法逐步推导
本项目:      持久化内核 → 变量持续累积 → Notebook 式工作流
```

### 核心特性

- **持久会话** — 内核进程保持存活，变量跨调用可用
- **MCP 协议** — 标准 AI 工具接口，Claude Code 直接调用
- **多会话并行** — 同时运行多个独立内核，互不干扰
- **图形自动导出** — Plot / Graphics3D 自动导出为 PNG
- **会话快照** — 随时保存/恢复完整的内核状态
- **故障隔离** — 单个会话崩溃不影响其他会话

---

## 前置条件

### 必需

| 依赖 | 版本 | 安装方式 |
|:-----|:-----|:---------|
| **Wolfram Engine / Mathematica** | 13.0+ | [wolfram.com/engine](https://www.wolfram.com/engine/) |
| **Bun** | 1.1+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** | 2.1+ | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |

### 验证环境

```bash
# Wolfram 环境
wolframscript -version
# 预期: WolframScript x.y.z

# Bun 运行时
bun --version
# 预期: 1.x.x

# Claude Code (如果已安装)
claude --version
```

### Wolfram 许可说明

- **Mathematica** (Commercial/Educational) — 完整功能，包括图形
- **Wolfram Engine** (Free) — 命令行计算，图形功能可能需要额外许可

检查许可类型：

```bash
wolframscript -code '$LicenseType'
```

---

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/YOUR_USERNAME/wolfram-kernel-mcp.git
cd wolfram-kernel-mcp
```

### 2. 安装依赖

```bash
cd wolfram-kernel-service
bun install
```

> 唯一的运行时依赖是 `@modelcontextprotocol/sdk`，由 MCP 协议要求。

### 3. 编译

```bash
bun run build
```

编译后的入口文件位于 `dist/index.js`。

### 4. 配置 Claude Code MCP

将 MCP 配置添加到 Claude Code 的设置中。你有两个选择：

**选项 A — 项目级配置（推荐用于单项目使用）**

编辑项目根目录下的 `.claude/mcp.json`：

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

**重要：** 将 `/ABSOLUTE/PATH/TO/` 替换为你本机的实际路径。

**选项 B — 全局配置（所有项目可用）**

编辑 `~/.claude/mcp.json`（用户级全局设置）：

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

### 5. 重启 Claude Code

配置修改后，重启 Claude Code 即可。启动日志中应出现：

```
Wolfram Kernel Service MCP Server started
```

### 6. 验证

在 Claude Code 中运行：

```
请帮我创建一个 Wolfram session 并计算 1+1
```

AI 会自动调用 `wolfram_session_create` 和 `wolfram_execute` 工具。如果返回正确结果，说明配置成功。

---

## 配置详解

### MCP 配置参数

```json
{
  "mcpServers": {
    "wolfram-kernel": {
      "command": "bun",                          // 运行时
      "args": [
        "run",                                   // bun 子命令
        "/path/to/dist/index.js"                 // 编译后的入口文件（必须为绝对路径）
      ],
      "description": "Wolfram kernel service"    // 描述（用于 AI 识别）
    }
  }
}
```

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `command` | `string` | 运行时，固定为 `"bun"` |
| `args` | `string[]` | `["run", "<入口文件绝对路径>"]` |
| `description` | `string` | 可选描述，帮助 AI 识别此 MCP server |

### 自定义 wolframscript 路径

如果你的 `wolframscript` 不在 `/usr/local/bin/wolframscript`，编辑 `src/protocol.ts`：

```typescript
const WOLFRAMSCRIPT_PATH = "/your/custom/path/wolframscript";
```

然后重新编译：

```bash
bun run build
```

或者通过 MCP tool 调用时指定 `kernelPath` 参数（目前版本仅修改源码有效——未来计划通过环境变量配置）。

### 环境变量（计划中）

> `v1.1` 计划支持通过环境变量 `WOLFRAMSCRIPT_PATH` 配置内核路径。

---

## API 参考

本服务通过 MCP 协议暴露 6 个 Tool，AI 自动调用，无需用户手动操作。

### `wolfram_session_create`

创建新的 Wolfram 内核会话。每个会话是独立的进程，拥有隔离的内存空间。

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:----|:-----|
| `name` | `string` | 是 | 会话名称，如 `"linear-algebra"` |
| `kernelPath` | `string` | 否 | MathKernel 路径，默认 `wolframscript` |

**返回：** `SessionInfo { id, name, createdAt, status, executionCount }`

---

### `wolfram_execute`

在指定会话中执行 Wolfram Language 代码。

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:----|:-----|
| `sessionId` | `string` | 是 | 会话 ID（由 `session_create` 返回） |
| `code` | `string` | 是 | 要执行的 Wolfram 代码 |

**返回：** `ExecutionResult { sessionId, input, outputs[], timing, success }`

其中 `outputs` 数组元素类型：
- `text` — 文本输出
- `graphics` — 图形输出（含 PNG 文件路径）
- `error` — 错误信息
- `null` — 无输出

---

### `wolfram_session_list`

列出所有活跃会话。

**返回：** `SessionInfo[]` — 所有会话的信息数组

---

### `wolfram_session_delete`

销毁会话，终止内核进程。

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:----|:-----|
| `sessionId` | `string` | 是 | 要销毁的会话 ID |

---

### `wolfram_session_variables`

查询会话中所有用户定义的全局变量。

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:----|:-----|
| `sessionId` | `string` | 是 | 会话 ID |

**返回：** `string[]` — 变量名数组

---

### `wolfram_session_snapshot`

创建会话状态的快照，可用于后续恢复。

| 参数 | 类型 | 必填 | 说明 |
|:-----|:-----|:----|:-----|
| `sessionId` | `string` | 是 | 会话 ID |

**返回：** `SessionSnapshot { sessionId, timestamp, definitions[], rawDump }`

---

## 项目结构

```
wolfram-kernel-mcp/
│
├── README.md                          # 英文文档
├── README.zh.md                       # 本文件 — 中文项目总览和配置指南
├── LICENSE                            # MIT
├── .gitignore
│
├── wolfram-kernel-service/            # MCP Server 核心（TypeScript / Bun）
│   ├── package.json
│   ├── tsconfig.json
│   ├── bun.lock
│   ├── README.md                      # Service 详细使用指南
│   ├── claude/mcp.json                # MCP 配置模板
│   ├── dist/index.js                  # 编译产物
│   └── src/
│       ├── index.ts                   # 入口 — StdioServerTransport
│       ├── mcp-tools.ts               # 6 个 Tool 定义 + 输出格式化
│       ├── kernel-manager.ts          # Singleton 门面模式
│       ├── session.ts                 # 会话生命周期管理
│       ├── protocol.ts                # wolframscript -linewise 通信
│       ├── types.ts                   # TypeScript 类型定义
│       └── utils/
│           ├── result-parser.ts       # 输出解析（Text/Graphics/Error）
│           └── graphics.ts            # 图形导出（PNG）
│
└── wolfram.sh                         # Shell 便捷脚本 — 快速运行 Wolfram 代码
```

---

## 架构设计

```
┌─────────────────────────────────────────────────┐
│                    Claude Code                    │
│  ┌─────────────────────────────────────────────┐│
│  │              AI Agent                        ││
│  │  "帮我用 Wolfram 算个积分"                    ││
│  └──────────────────┬──────────────────────────┘│
│                     │ MCP (Stdio)                │
│  ┌──────────────────▼──────────────────────────┐│
│  │          MCP Tool Handler                    ││
│  │  wolfram_session_create / execute / ...      ││
│  └──────────────────┬──────────────────────────┘│
└─────────────────────┼───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│              KernelManager (Singleton)            │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │ Session A │  │ Session B │  │ Session C │   │
│  │ "physics" │  │ "finance" │  │ "algebra" │   │
│  │  ┌─────┐  │  │  ┌─────┐  │  │  ┌─────┐  │   │
│  │  │ PID │  │  │  │ PID │  │  │  │ PID │  │   │
│  │  │ 123 │  │  │  │ 456 │  │  │  │ 789 │  │   │
│  │  └─────┘  │  │  └─────┘  │  │  └─────┘  │   │
│  └───────────┘  └───────────┘  └───────────┘   │
│                                                  │
│  WolframProtocol ←→ wolframscript -linewise      │
└──────────────────────────────────────────────────┘
```

### 通信流程

```
1. Claude Code 启动 → 加载 MCP Server (bun run dist/index.js)
2. 用户: "建一个 physics session，求解方程"
3. AI → wolfram_session_create(name="physics")
4. KernelManager 创建会话:
   ├─ 生成 UUID
   ├─ 启动 wolframscript -linewise 进程
   ├─ 消费启动 banner 直到 In[1]:=
   └─ 返回 SessionInfo
5. AI → wolfram_execute(sessionId, "Solve[x^2+2x-8==0, x]")
6. KernelManager:
   ├─ 查找 SessionState
   ├─ 写入代码到进程 stdin
   ├─ 读取 stdout 直到 sentinel
   ├─ 解析输出 (文本/图形/错误)
   ├─ 如有图形，执行 Export[%]
   └─ 返回 ExecutionResult
7. 后续调用复用同一内核进程，变量持续可用
```

### 超时与清理

- 每次执行的超时时间为 **30 秒**（在 `session.ts` 中配置）
- 服务收到 SIGTERM/SIGINT 时，自动清理所有会话
- 图形输出存储在 `/tmp/wolfram-kernel/{sessionId}/`

---

## 示例用法

### 示例 1：符号演算

```
用户: 建一个叫 calc 的 wolfram session，帮我求 f(x)=x^3-6x^2+11x-6 的导数和不定积分

AI 自动执行:
  → wolfram_session_create(name="calc")
  → wolfram_execute("calc", "D[x^3-6x^2+11x-6, x]")
     → 3x^2 - 12x + 11
  → wolfram_execute("calc", "Integrate[%, x]")
     → x^3 - 6x^2 + 11x + C
```

### 示例 2：逐步推导

```
用户: 在刚才的 calc session 里，解 f(x)=0

AI 自动执行:
  → wolfram_execute("calc", "Solve[x^3-6x^2+11x-6==0, x]")
     → {{x -> 1}, {x -> 2}, {x -> 3}}
```

变量 `calc` 中之前定义的函数仍然可用。

### 示例 3：多会话并行

```
用户: 同时开两个 session，一个数值积分，一个画图

AI 自动执行:
  → wolfram_session_create(name="numeric")
  → wolfram_session_create(name="plot")
  
  → wolfram_execute("numeric", "NIntegrate[Sin[x^2], {x, 0, Pi}]")
     → 0.759...
  → wolfram_execute("plot", "Plot[Sin[x^2], {x, 0, Pi}]")
     → [PNG: /tmp/wolfram-kernel/xxx/output_xxx.png]
```

### 示例 4：快照保存

```
用户: 保存 numeric session 的状态

AI 自动执行:
  → wolfram_session_snapshot(sessionId="xxx")
     → 返回所有变量的 Definition[]
     → 可写入 .wl 文件永久保存
```

---

## 故障排查

### MCP Server 启动失败

```bash
# 手工测试 server 是否能启动
cd wolfram-kernel-service
bun run src/index.ts
# 预期输出: Wolfram Kernel Service MCP Server started
```

常见原因：
- `bun install` 未执行 → 运行 `bun install`
- `@modelcontextprotocol/sdk` 版本问题 → 删除 `node_modules` 和 `bun.lock`，重装

### "bun: command not found"（非交互式 shell 找不到 bun）

MCP server 在干净环境中启动（不加载 `.zshrc` / `.bashrc`）。如果 `bun` 只在 shell rc 文件中配置了 PATH，需要用绝对路径：

```json
{
  "mcpServers": {
    "wolfram-kernel": {
      "command": "/Users/你的用户名/.bun/bin/bun",
      "args": ["run", "/你的绝对路径/wolfram-kernel-service/dist/index.js"]
    }
  }
}
```

查找 bun 的路径：`which bun`

### wolframscript 找不到

```bash
which wolframscript
# 应该在 /usr/local/bin/wolframscript
```

如果不是该路径，修改 `src/protocol.ts` 中的 `DEFAULT_WOLFRAMSCRIPT_PATH`，然后重新编译：

```bash
bun run build
```

### 会话变成 dead 状态

内核进程可能崩溃。删掉重建即可：

```
"删掉 session X，建个新的"
```

### 图形没有生成

确认 Mathematica 有图形许可：

```bash
wolframscript -code '$LicenseType'
```

- `"Professional"` / `"Enterprise"` — 完整图形功能
- `"Free"` — Wolfram Engine 免费版，可能不支持 `Export` 图形

### 僵尸 wolframscript 进程

```bash
pkill -f wolframscript
rm -rf /tmp/wolfram-kernel/
```

### 还不行？

1. 确认 `dist/index.js` 存在：`ls -la wolfram-kernel-service/dist/index.js`
2. 如果不存在，运行：`cd wolfram-kernel-service && bun run build`
3. 检查 MCP 配置 JSON 是否合法：`cat .claude/mcp.json | python3 -m json.tool`
4. 确认路径是**绝对路径**（以 `/` 开头）
5. **完全退出** Claude Code 后重新启动

---

## 已知限制

- **`kernelPath` 参数尚未生效** — 目前 `wolframscript` 路径在 `protocol.ts` 中硬编码。需要在源码中修改并重新编译。
- **单次执行中的多个图形输出** — v1.0.1 已修复并发问题，但边缘情况仍可能存在。
- **无认证 / 网络隔离** — 完全在本地 stdio 上运行，适合单机使用，不支持多用户或远程访问。
- **30 秒超时** — 超过 30 秒的计算会被终止。如需调整，修改 `session.ts` 中的 `EXECUTION_TIMEOUT_MS`。

---

## 技术细节

### 为什么用 Bun 而不是 Node？

- **零配置 TypeScript** — 无需 ts-node 或提前编译（开发模式）
- **内置 Subprocess API** — 与 wolframscript 的 stdin/stdout 管道交互更自然
- **更快冷启动** — MCP Server 每次启动的延迟更低

### wolframscript -linewise 模式

`wolframscript -linewise` 保持一个交互式 REPL 进程，通过 stdin/stdout 通信：

- **Sentinel 机制** — 每次执行后输出一个唯一标记 `__WL_SENTINEL_xxx__`，用于判断输出结束
- **续行处理** — `"> ..."` 开头的续行自动拼接到上一行
- **图形检测** — 检测输出中的 `-Graphics-` 标记，触发 Export

### 安全考虑

- 代码在本地 wolframscript 进程中执行，不会上传到云端
- 每个会话是独立的操作系统进程，进程级别隔离
- 图形输出存储在 `/tmp/`，重启后自动清除

---

## 相关文档

- [wolfram-kernel-service/README.md](wolfram-kernel-service/README.md) — Service 详细使用指南
- [MCP 协议规范](https://modelcontextprotocol.io)

---

## 开源协议

MIT License — 详见 [LICENSE](LICENSE) 文件。
