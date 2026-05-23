# Wolfram Kernel Service 使用指南

让 Claude Code 拥有一个**持久化的 Wolfram 语言内核**，像操作 Notebook 一样逐 cell 追加代码，状态持续累积。

---

## 1. 快速开始

### 前置条件

- macOS + Mathematica / Wolfram Engine 已安装（`wolframscript` 在 PATH 中）
- Claude Code v2.1+
- Bun 运行时

验证环境：

```bash
wolframscript -version   # 应输出版本号
bun --version            # 应输出版本号
```

### 安装依赖

```bash
cd wolfram-kernel-service
bun install
```

### 配置 MCP Server

将 `claude/mcp.json` 合并到 Claude Code 的 MCP 设置中。

**方式一：项目级配置（推荐）**

将 `claude/mcp.json` 中的 `/PATH/TO/` 替换为你本机的实际路径，然后：

```bash
cat claude/mcp.json >> ../../.claude/mcp.json
```

**方式二：全局配置**

编辑 `~/.claude/mcp.json`（用户级全局设置），添加：

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

> **注意：** 路径必须使用绝对路径。将 `/ABSOLUTE/PATH/TO/` 替换为你本机的实际路径。

重启 Claude Code 后生效。

---

## 2. 核心概念

```
┌──────────────────────────────────┐
│  Session "physics"               │
│  ┌────────────────────────────┐  │
│  │ In[1]:= g = 9.8            │  │  ← 一个独立 wolframscript 进程
│  │ In[2]:= v = g * t           │  │  ← 变量在内存中持续累积
│  │ In[3]:= D[v, t]             │  │
│  │ Out[3]= 9.8                 │  │
│  └────────────────────────────┘  │
├──────────────────────────────────┤
│  Session "finance"               │
│  ┌────────────────────────────┐  │
│  │ In[1]:= data = Import[...]  │  │  ← 另一个独立进程，完全隔离
│  │ In[2]:= Fit[data, ...]      │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

| 概念 | 说明 |
|------|------|
| **Session** | 一个持久化 Wolfram 内核进程，有独立的内存空间 |
| **变量持久** | `a=1` 定义后，后续调用可以直接用 `a` |
| **图形输出** | `Plot` / `Graphics3D` 等自动导出为 PNG 文件 |
| **会话快照** | 随时保存当前所有变量定义为文本，可恢复 |

---

## 3. 使用方式

### 3.1 自然语言驱动（由 AI 自动调用）

最自然的使用方式 —— 直接告诉 Claude Code 你要做什么，它会自动选择工具：

```
用户: 帮我建一个叫 physics 的 wolfram session，然后求解 x^2 + 2x - 8 = 0

AI 自动执行:
  → wolfram_session_create(name="physics")
  → wolfram_execute(session="...", code="Solve[x^2 + 2x - 8 == 0, x]")
  → 返回: {{x -> -4}, {x -> 2}}
```

```
用户: 在刚才那个 session 里，把结果画出来

AI 自动执行:
  → wolfram_execute(session="...", code="Plot[x^2 + 2x - 8, {x, -6, 4}]")
  → 返回: [PNG 图片路径]
```

```
用户: 检查一下 physics session 里有哪些变量

AI 自动执行:
  → wolfram_session_variables(session="...")
  → 返回: {x, g, v, ...}
```

### 3.2 显式指令调用

你也可以直接指定 tool：

```
@wolfram_session_create name="number-theory"

@wolfram_execute session="xxx-xxx" code="Prime[100]"

@wolfram_execute session="xxx-xxx" code="FactorInteger[%]"

@wolfram_session_snapshot session="xxx-xxx"
```

### 3.3 典型工作流

**逐步推导：**

```
1. "建一个 physics session"
2. "定义重力加速度 g=9.8，初始速度 v0=20"
3. "写出运动方程 h = v0*t - 0.5*g*t^2"
4. "求最高点时间：对 h 关于 t 求导并解方程"
5. "把 h(t) 画出来"
6. "保存会话快照"
```

每一步都在前一步的上下文里执行，变量持续可用。

**数据分析：**

```
1. "建一个 data-analysis session"
2. "生成 100 个正态分布随机数存到 data"
3. "计算均值、方差、画直方图"
4. "用 NonlinearModelFit 拟合分布"
5. "查看拟合参数和残差"
```

### 3.4 多会话并行

```
用户: 同时开两个 session，一个做符号推导，一个做数值计算

AI:
  → wolfram_session_create(name="symbolic")
  → wolfram_session_create(name="numeric")

  → wolfram_execute(symbolic, "Integrate[Sin[x^2], x]")
  → wolfram_execute(numeric, "NIntegrate[Sin[x^2], {x, 0, Pi}]")
```

两个 session 完全隔离，互不干扰。

---

## 4. Tool 参考

### `wolfram_session_create`

```
参数: name (必填), kernelPath (可选)
返回: SessionInfo { id, name, createdAt, status, executionCount, variables }
```

创建新的 Wolfram 内核会话。内核进程立即启动并保持存活。

### `wolfram_execute`

```
参数: sessionId (必填), code (必填)
返回: ExecutionResult {
  sessionId, input, timing (ms), success,
  outputs: [{ type: "text"|"graphics"|"error"|"null", ... }]
}
```

在指定会话中执行 Wolfram Language 代码。代码可以使用之前定义的所有变量和函数。图形输出自动导出为 PNG 文件。

### `wolfram_session_list`

```
参数: 无
返回: SessionInfo[]
```

列出所有活跃会话及其状态（running / dead）。

### `wolfram_session_delete`

```
参数: sessionId (必填)
返回: 确认消息
```

销毁会话，终止内核进程，释放资源。

### `wolfram_session_variables`

```
参数: sessionId (必填)
返回: string[]
```

列出会话中所有用户定义的全局变量名。

### `wolfram_session_snapshot`

```
参数: sessionId (必填)
返回: SessionSnapshot {
  sessionId, timestamp,
  definitions: string[],  // 每个变量的 Definition[]
  rawDump: string         // 可保存到 .wl 文件
}
```

创建会话状态的完整快照，可用于后续恢复。

---

## 5. 图形输出

所有 `Plot`、`Plot3D`、`Graphics`、`Graphics3D` 等图形输出自动处理：

```
用户: 画一个 sin(x) 的图像

AI 执行 wolfram_execute → 返回:
  Graphics (png): /tmp/wolfram-kernel/{sessionId}/output_1700000000.png
```

AI 可以通过文件路径读取图片内容展示给用户。图形文件存储在 `/tmp/wolfram-kernel/` 下，按 session 分目录。

---

## 6. 会话管理

### 查看状态

```
用户: 现在有哪些 wolfram session？

AI 调用 wolfram_session_list → 返回:
  Active sessions (2):
  1. physics (abc123) - running - 12 executions - {g, v0, h, t}
  2. data (def456) - running - 5 executions - {data, fit}
```

### 清理

```
用户: 关掉 data session

AI 调用 wolfram_session_delete(sessionId="def456") → 内核进程终止
```

### 快照与恢复

```
# 保存
用户: 保存 physics session 的状态

AI 调用 wolfram_session_snapshot → 返回完整定义文本，可写入 .wl 文件

# 恢复（在新 session 中）
用户: 新建 session 并恢复之前保存的定义

AI 调用:
  → wolfram_session_create(name="physics-restored")
  → wolfram_execute(code=之前保存的rawDump内容)
```

---

## 7. 对比传统 wolframscript

| 特性 | 传统 wolframscript | Wolfram Kernel Service |
|------|:---:|:---:|
| 每次调用独立进程 | ✅ | ❌（持久化） |
| 变量跨调用保持 | ❌ | ✅ |
| Notebook 式累积 | ❌ | ✅ |
| AI 直接调用 | ❌ | ✅ (MCP) |
| 图形自动导出 | ❌ | ✅ |
| 多会话并行 | ❌ | ✅ |
| 快照/恢复 | ❌ | ✅ |

传统方式每次 `wolframscript -code "..."` 都是独立进程，上一个命令定义的变量全部丢失。本服务保持内核进程存活，实现真正的交互式计算。

---

## 8. 故障排查

### MCP Server 启动失败

```bash
# 手工测试 server 是否能启动
bun run src/index.ts
# 预期输出: Wolfram Kernel Service MCP Server started
```

### wolframscript 找不到

```bash
# 确认路径
which wolframscript
# 应该在 /usr/local/bin/wolframscript

# 如果不是，通过 kernelPath 参数指定
@wolfram_session_create name="test" kernelPath="/path/to/wolframscript"
```

### 会话变成 dead 状态

内核进程可能崩溃。删掉重建即可：

```
wolfram_session_delete(sessionId="xxx")
wolfram_session_create(name="new")
```

### 图形没有生成

确认 Mathematica 有图形许可。某些 Wolfram Engine 免费版本可能不支持图形。检查：

```wolfram
wolfram_execute(code="$LicenseType")  # 应返回 "Professional" 或 "Enterprise"
```

---

## 9. 项目结构

```
wolfram-kernel-service/
├── claude/mcp.json           # Claude Code MCP 配置
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # MCP Server 入口 (StdioServerTransport)
    ├── mcp-tools.ts          # 6 个 Tool 定义 + 格式化
    ├── kernel-manager.ts     # Singleton 门面
    ├── session.ts            # 会话生命周期 (创建/执行/删除/快照)
    ├── protocol.ts           # wolframscript -linewise 通信协议
    ├── types.ts              # 共享 TypeScript 类型
    └── utils/
        ├── result-parser.ts  # 输出解析 (Text/Graphics/Error)
        └── graphics.ts       # 图形导出 (Export PNG/SVG)
```
