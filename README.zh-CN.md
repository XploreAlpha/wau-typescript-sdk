# wau-sdk

> **[WAU-core-kernel](https://github.com/xplorealpha/WAU-core-kernel) 官方 TypeScript / JavaScript SDK** —— AI agent 调度、gRPC + HTTP、8 个 Bot 平台、UCP 电商协议、MCP 工具协议。

[English](README.md) | [中文](README.zh-CN.md)

[![npm version](https://badge.fury.io/js/wau-sdk.svg)](https://www.npmjs.com/package/wau-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/wau/wau-typescript-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/wau/wau-typescript-sdk/actions)
[![npm downloads](https://img.shields.io/npm/dm/wau-sdk)](https://www.npmjs.com/package/wau-sdk)

---

## 核心特性

一个强类型的客户端,把 WAU 全部能力面打包在一起:

- **核心 `Client`** 串联 6 个子客户端,统一经过 retry + 熔断器 + JWT 签名三层装饰链:
  - `client.kernel` —— `/healthz`、`/readyz`、内核信息
  - `client.agents` —— agent 注册、列表、评分、心跳
  - `client.tasks` —— 任务提交(同步 + 异步)、列表、查询
  - `client.intent` —— 意图解析(grpc stub,v1.4+ 启用)
  - `client.handshake` —— 多 agent 握手协议(v0.8.0+)
  - `client.chat` —— OpenAI 兼容 `/v1/chat/completions`,支持 SSE 流式
- **`UCPClient`** (v1.3.3+) —— 通用电商协议,JSON-RPC 2.0 over HTTP,11 个 commerce 工具(`listProducts`、`addToCart`、`createCheckoutSession`、Stripe checkout 等)+ 8 个 commerce DTO,5 个 SDK 字节级一致
- **`MCPClient`** (v1.3.2+) —— 模型上下文协议,JSON-RPC 2.0 over HTTP,8 个同步工具(`sendMessage`、`getTask`、`listTasks` 等)+ 2 个 SSE 流式工具(`streamMessage`、`subscribeToTask`)
- **`WauClient`** (v1.3.1+,通过 `wau-sdk/wau` 子路径导入) —— workflow 提交,19 字段 `WauWorkflow` 类型 + JWT 4-claim 鉴权 + 心跳循环
- **8 个 Bot 平台原生集成**(`wau-sdk/bot/` 子路径):
  Telegram、Discord、Webhook、Slack(Socket Mode)、飞书(Lark)、QQ(WSS)、钉钉(Stream)、邮件(IMAP + SMTP)
- **内置韧性** —— 指数退避 + 抖动(零外部依赖),默认 3 次重试(200ms → 5s),熔断器从 `wau-circuit` Go 参考实现逐字节移植
- **类型化错误** —— `APIError` + 5 个 HTTP 4xx 子类 + `CircuitOpenError` + `MaxRetriesError` + MCP / UCP / Wau 错误族
- **严格 TypeScript** —— 公开接口无 `any`;输出严格 ESM(Node 18+)
- **78 个源文件 / 约 7.7K LOC**,**24 个测试文件 / 约 5.2K LOC**,覆盖率 ~95%

---

## 安装

```bash
npm install wau-sdk@^1.3.4
# 或
pnpm add wau-sdk@^1.3.4
# 或
yarn add wau-sdk@^1.3.4
```

**环境要求**:Node.js ≥ 18,如果使用 TypeScript 则 ≥ 5.0。

---

## 5 分钟快速开始

```typescript
import { Client, SubmitRequest } from "wau-sdk";

async function main(): Promise<void> {
  const c = new Client("http://localhost:18400");

  try {
    // 提交任务 —— 内核挑选最优 agent 并通过 A2A 派发
    const resp = await c.tasks.submit(
      new SubmitRequest("What is the capital of France?", 30_000)
    );
    console.log(`agent: ${resp.selectedAgent} (score=${resp.score.toFixed(2)})`);
    console.log(`decision: ${resp.decision.decision_time_ms}ms`);
    console.log(`a2a: ${resp.a2a_call_ms}ms`);
    console.log(`response: ${resp.response}`);
  } finally {
    await c.close();
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
```

ESM-only —— 使用 `import { ... } from "wau-sdk"`。包内已经预编译为 ESM,放在 `dist/` 目录。

---

## 公开 API

### 顶层导出

| 符号 | 类别 | 说明 |
|---|---|---|
| `Client` | class | 主 HTTP 客户端(串联 transport + retry + circuit + signer) |
| `UCPClient` | class | 通用电商协议客户端(JSON-RPC 2.0 over HTTP) |
| `MCPClient` | class | 模型上下文协议客户端(JSON-RPC 2.0 over HTTP,SSE 流式) |
| `WauClient` | class | WAU workflow 客户端(从 `wau-sdk/wau` 子路径再导出) |
| `APIError`、`BadRequestError`、`UnauthorizedError`、`ForbiddenError`、`NotFoundError`、`ConflictError`、`CircuitOpenError`、`MaxRetriesError`、`NotImplementedError`、`WauError` | class | 类型化错误层级 |
| `Breaker`、`CircuitState`、`Retrier`、`Signer`、`Transport` | class | 高级构件 |
| `DEFAULT_CIRCUIT_CONFIG`、`DEFAULT_RETRY_CONFIG`、`Role` | const/enum | 默认配置 + agent 角色枚举 |

### 子客户端(通过 `client.<service>`)

| 子客户端 | 方法(同步 / 异步) | 说明 |
|---|---|---|
| `client.kernel` | `healthz()`、`readyz()`、`info()` | 健康检查 + 内核元数据 |
| `client.agents` | `register()`、`list()`、`score()`、`heartbeat()` | Agent 注册中心 + 评分 |
| `client.tasks` | `submit()`、`submitAsync()`、`list()`、`fetch()` | L4 任务派发(同步 + 异步) |
| `client.intent` | `resolve()` *(stub)* | v1.4 之前返回 `NotImplementedError` |
| `client.handshake` | `start()`、`accept()`、`reject()`、`list()` | 多 agent 握手(v0.8.0+) |
| `client.chat` | `complete()`、`stream()` | OpenAI 兼容 chat(含 SSE) |

---

## 子模块

本包提供两个子路径导入入口:

```jsonc
// package.json (节选)
"exports": {
  ".":        { "import": "./dist/index.js",        "types": "./dist/index.d.ts" },
  "./wau":    { "import": "./dist/wau/index.js",    "types": "./dist/wau/index.d.ts" }
}
```

- **`wau-sdk`** (默认入口) —— `Client` + 全部 6 个子客户端 + UCP + MCP + 错误 + 类型。
- **`wau-sdk/wau`** —— 仅导出 `WauClient`(workflow 提交)。如果你只需要 workflow 派发能力,可以用它减少 import 图:

```typescript
import { WauClient, WauWorkflow } from "wau-sdk/wau";

const wau = new WauClient({
  baseURL: "https://kernel.example.com",
  tenantId: "acme",
});

const wf: WauWorkflow = {
  workflow_type: "research",
  requester_agent_id: "orchestrator-01",
  // ...共 19 个字段
};

const { workflow_id } = await wau.submit(wf);
```

---

## 示例

仓库自带 5 个可直接运行的示例,在 `examples/` 目录下。每个示例有独立的 `main.ts`,用 `npx tsx` 运行:

| 示例 | 路径 | 演示内容 |
|---|---|---|
| **`chat_stream`** | [`examples/chat_stream/main.ts`](examples/chat_stream/main.ts) | OpenAI 兼容 SSE chat completion + chunk delta 累加 |
| **`five_scenarios`** | [`examples/five_scenarios/main.ts`](examples/five_scenarios/main.ts) | 5 个黄金契约场景(与 `wau-go-sdk` JSON 字节级对齐) |
| **`heartbeat_loop`** | [`examples/heartbeat_loop/main.ts`](examples/heartbeat_loop/main.ts) | Agent 心跳保活循环 |
| **`list_agents`** | [`examples/list_agents/main.ts`](examples/list_agents/main.ts) | `client.agents.list()` + 分页 |
| **`submit_task`** | [`examples/submit_task/main.ts`](examples/submit_task/main.ts) | `client.tasks.submit()` 端到端调用范例 |

运行任意示例:

```bash
cd examples/submit_task
npx tsx main.ts "What is the capital of France?"
```

---

## 文档

- **[API.md](API.md)** —— 全部导出符号的完整 API 文档(33 KB)
- **[ARCHITECTURE.md](ARCHITECTURE.md)** —— 模块布局、数据流、gRPC-web vs Node.js 直连、关键设计决策
- **[QUICKSTART.md](QUICKSTART.md)** —— 新用户 15 分钟上手指南
- **[DEPLOY.md](DEPLOY.md)** —— npm 发布流程 + CI/CD
- **[RELEASING.md](RELEASING.md)** —— 发版清单(7 节)
- **[FAQ.md](FAQ.md)** —— 常见问题(16 KB)
- **[CHANGELOG.md](CHANGELOG.md)** —— 完整版本历史
- **[wau-protocol-spec](https://github.com/youhaoxi/WAU-protocol-spec)** —— wire format 权威参考
- **[wau-go-sdk](https://github.com/xplorealpha/wau-go-sdk)** —— 兄弟 Go SDK(契约黄金源)

---

## 版本策略

本 SDK 与 WAU 19 仓联合版本化。当前包版本(`1.3.4`)与对应内核版本严格一致 —— 如果你的内核跑的是 `v1.3.x`,请固定使用 `wau-sdk@^1.3.4`。

我们遵循 [Semantic Versioning](https://semver.org/):

- **Patch**(`1.3.4` → `1.3.5`)—— bug 修复、ESM/postbuild 微调、错误字段的 additive 扩展。可以无脑升级。
- **Minor**(`1.3.x` → `1.4.0`)—— 新增子客户端或方法、新 Bot 平台、非破坏性的类型新增。弃用会提前 1 个 minor 版本预告。
- **Major**(`1.x.y` → `2.0.0`)—— 公开 API 的破坏性变更。仅在 wire format 本身变化时才会出现,极少发生。

> **弃用策略**:方法在删除前会先在一个 minor 版本标 `@deprecated`。自 `v1.0.0` 起,尚无任何公开方法被移除。

---

## 贡献

欢迎贡献。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md),了解开发环境、测试 / lint 工作流、commit message 规范,以及与 `wau-core-kernel` 的版本同步策略。

---

## 许可证

[MIT](LICENSE) © 2026 youhaoxi

[WAU-core-kernel](https://github.com/xplorealpha/WAU-core-kernel) AI agent 调度内核的官方 SDK。与内核 `v1.3.4` 严格同步。