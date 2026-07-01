# wau-typescript-sdk API 参考

> **版本**:v1.1.0(v0.9.0 "Acorn" Stage 3.2 完整化,2026-07-03)
> **包名**:`wau-sdk`(npm)
> **API 数量**:11 HTTP 端点 × 6 服务(Agents / Tasks / Kernel / Intent / Handshake / Chat)+ Bot 子包(per D13)
> **异步优先**:`async / await` Promise 风格,字段 1:1 对齐 wau-go-sdk / wau-python-sdk(per Stage 0 5/5 字段对齐)
> **ESM + CJS 双构建**:默认 ESM(`import { Client } from "wau-sdk"`),CJS 兼容
> **配套教程**:`docs/quickstart.md` 5 分钟入门(本 SDK 新建,07-03),`docs/auth.md` HS256 鉴权(新建),`docs/retry_circuit.md` 重试/熔断(新建)

---

## 目录

1. [安装](#1-安装)
2. [Client 初始化](#2-client-初始化)
3. [核心 API](#3-核心-api)
   - [3.1 Auth — Signer / AuthConfig / Role](#31-auth--signer--authconfig--role)
   - [3.2 KernelService](#32-kernelservice)
   - [3.3 AgentsService](#33-agentsservice)
   - [3.4 TasksService](#34-tasksservice)
   - [3.5 HandshakeService](#35-handshakeservice)
   - [3.6 IntentService(M3.1 stub)](#36-intentservice-m31-stub)
   - [3.7 ChatService ⭐(Stage 3.1 2xx 验证)](#37-chatservice-stage-3-1-2xx-验证)
   - [3.8 Retry / Circuit 状态查询](#38-retry--circuit-状态查询)
4. [Bot 子包(per D13)](#4-bot-子包per-d13)
5. [配置项](#5-配置项)
6. [类型定义](#6-类型定义)
7. [错误码](#7-错误码)
8. [版本与变更](#8-版本与变更)

---

## 1. 安装

```bash
# 1.1 标准 npm install
npm install wau-sdk@1.1.0

# 1.2 package.json 锁版本
"dependencies": {
  "wau-sdk": "1.1.0"
}

# 1.3 依赖(自动拉取,per package.json)
#   - axios>=1.6              (HTTP 客户端)
#   - jsonwebtoken>=9.0       (HS256 鉴权,per ESM 修复 import jwt default)
#   - uuid>=9.0               (jti 防重放)
```

**前置依赖**:
- Node.js ≥ 18(用了 `node:crypto.randomUUID()` / `AbortSignal.timeout()`)
- TypeScript ≥ 5.0(`isolatedModules` / `export type` / `verbatimModuleSyntax`)
- 目标 WAU 服务:wau-core-kernel(默认 `:18400`)+ wau-edge(默认 `:18402` Chat)

⚠️ **ESM 注意**(per [[project-v0-9-0-sdk-typescript-e2e-2026-07-01]]):jsonwebtoken ESM 下要用 `import jwt from "jsonwebtoken"`(默认导出),不要 `import * as jwt` — 否则 `jwt.sign is not a function` bug。

---

## 2. Client 初始化

### 2.1 `new Client(baseURL, options?)`

**创建 SDK 客户端**(异步 Promise 风格)。

| 参数 | 类型 | 说明 |
|---|---|---|
| `baseURL` | `string` | wau-core-kernel HTTP 地址,例如 `"http://localhost:18400"`(空时默认走 env `WAU_KERNEL_BASE_URL`) |
| `options` | `ClientOptions`(可选)| 配置对象,默认 `{}` |

**返回**:`Client` 实例(并发安全,immutable)。

**示例 — 最简用法**:
```typescript
import { Client } from "wau-sdk";

const c = new Client("http://localhost:18400");
const info = await c.kernel.info();
console.log(`kernel ${info.version} uptime=${info.uptime}s`);
```

**示例 — 完整配置**(timeout + retry + circuit + auth):
```typescript
import { Client, Role, DEFAULT_RETRY_CONFIG, DEFAULT_CIRCUIT_CONFIG } from "wau-sdk";

const c = new Client("http://localhost:18400", {
  timeoutMs: 30_000,
  retry: { ...DEFAULT_RETRY_CONFIG, maxRetries: 5 },
  circuit: { ...DEFAULT_CIRCUIT_CONFIG, failureThreshold: 10 },
  auth: {
    role: Role.EXTERNAL_AGENT,
    agentName: "my-agent",
    tenantId: "tenant-A",  // ⭐ 必填(per Stage 3.1 #1 修复)
    sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,
  },
});

console.log(`baseURL=${c.baseURL} circuit=${c.circuitState()}`);
```

### 2.2 完整 `ClientOptions` 字段

| 字段 | 类型 | 默认 | 用途 |
|---|---|---|---|
| `timeoutMs` | `number` | `30000` | 单次请求超时(ms) |
| `retry` | `RetryConfig` | `DEFAULT_RETRY_CONFIG` | 重试策略(指数退避 + 抖动) |
| `circuit` | `CircuitConfig` | `DEFAULT_CIRCUIT_CONFIG` | 熔断策略 |
| `auth` | `AuthConfig \| undefined` | `undefined` | HS256 JWT 鉴权(per Stage 3.1 #1) |
| `userAgent` | `string` | `"wau-typescript-sdk/0.6.0-preview.1"` | HTTP UA 头 |
| `transport` | `unknown` | `undefined` | axios 实例注入点(测试 / 代理) |

### 2.3 默认配置常量

```typescript
import { DEFAULT_RETRY_CONFIG, DEFAULT_CIRCUIT_CONFIG } from "wau-sdk";

// DEFAULT_RETRY_CONFIG:
// {
//   maxRetries: 3,
//   initialBackoffMs: 200,
//   maxBackoffMs: 5000,
//   jitter: 0.2,
//   retryOn: [500, 502, 503, 504, 429],
// }

// DEFAULT_CIRCUIT_CONFIG:
// {
//   failureThreshold: 5,
//   openTimeoutMs: 30000,
//   halfOpenMax: 1,
//   enabled: true,
// }
```

### 2.4 `Client` 属性 + 方法

| 属性 / 方法 | 类型 | 说明 |
|---|---|---|
| `baseURL` | `string` | 当前 base URL(只读) |
| `options` | `ClientOptions` | 当前配置(只读) |
| `retrier` | `Retrier` | 重试器(advanced 用) |
| `circuit` | `Breaker \| null` | 熔断器(advanced 用) |
| `circuitState()` | `string` | 返熔断状态:`"closed"` / `"open"` / `"half-open"` |
| `close()` | `Promise<void>` | 释放资源(axios 当前 no-op) |

**6 个子服务**(per Client):
```typescript
c.kernel      // KernelService(health / info)
c.agents      // AgentsService(list / iter / get / score / register / ...)
c.tasks       // TasksService(submit / simulate / get)
c.intent      // IntentService(stub,返 NotImplementedError)
c.handshake   // HandshakeService(v0.8.0 M5-1 B.1)
c.chat        // ChatService(v0.9.0 M3 §3.7)
```

---

## 3. 核心 API

### 3.1 Auth — Signer / AuthConfig / Role

> **Stage 3.1 #1 修复(2026-07-01)**:wau-edge `Claims` 必填 `tenant_id`(per
> `wau-edge/internal/auth/jwt.go:96-98`)。SDK 必须签 `tenant_id`,否则 401。
> Subject 对齐 wau-edge Claims.Subject(`sub` claim),空时用 `agentName` 兜底。

#### 3.1.1 `Role` enum

| 值 | 字面量 | 用途 |
|---|---|---|
| `Role.KERNEL_CORE` | `"kernel_core"` | kernel 进程本身 |
| `Role.TRUSTED_AGENT` | `"trusted_agent"` | 注册过的可信 agent(可注册/注销) |
| `Role.EXTERNAL_AGENT` | `"external_agent"` | 外部 agent(可调 chat/查询) |

```typescript
import { Role } from "wau-sdk";
const role = Role.TRUSTED_AGENT;
console.log(role);  // "trusted_agent"(string enum)
```

#### 3.1.2 `AuthConfig` interface

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `role` | `Role` | 否(默认 `Role.EXTERNAL_AGENT`) | RBAC 角色 |
| `agentName` | `string` | **是** | Agent 名称(JWT `agent` claim) |
| `tenantId` | `string` | **是**(非空字符串) | 租户 ID(JWT `tenant_id` claim,wau-edge 必校验) |
| `subject?` | `string` | 否(空 = 用 `agentName` 兜底) | JWT `sub` claim(用户/Agent 标识) |
| `sharedSecret` | `string \| Buffer` | **是** | HS256 共享密钥(从 env 或安全存储读取) |

**校验**(`Signer` 构造时):非空检查(`sharedSecret` / `agentName` / `tenantId`),空时 throw `Error`。

```typescript
import { Role } from "wau-sdk";

const auth = {
  role: Role.TRUSTED_AGENT,
  agentName: "my-agent",
  tenantId: "tenant-A",  // ⭐ 必填
  subject: "user-123",   // 可选,空时用 agentName 兜底
  sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,  // ⭐ 必填
};
```

#### 3.1.3 `Signer.sign(ttlSeconds = 300) -> string`

**HS256 JWT 签发器**(`AuthConfig` 不可变 = 启动时构造一次,每次请求 `sign()` 一次)。

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `ttlSeconds` | `number` | `300` | JWT 过期秒数(5 min) |

**返回**:`string` — 编码后的 JWT 字符串。

**JWT Payload 7 字段**(per Stage 3.1 #1 修复):

```json
{
  "agent":     "my-agent",
  "role":      "trusted_agent",
  "sub":       "user-123",
  "tenant_id": "tenant-A",   // ⭐ 必填(wau-edge 校验)
  "iat":       1718342400,
  "exp":       1718342700,  // iat + 300s
  "jti":       "uuid-v4"    // 防重放
}
```

```typescript
import { Signer } from "wau-sdk";

// 构造 Signer(失败时 throw Error)
const signer = new Signer(auth);
console.log(signer.role$);  // "trusted_agent"

// 签 JWT(每次请求新签,5min 默认有效)
const token = signer.sign(300);
console.log(token.slice(0, 50));
// "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**校验链**(server 端):
- wau-edge `Claims` 校验 `tenant_id` 非空(per `wau-edge/internal/auth/jwt.go:96-98`)
- 缺 `tenant_id` → 401 `{"error":"tenant_id missing"}`(per [[project-v0-9-0-blocker-fix-1-plus-2-2026-07-01]])
- wau-edge 默认空 secret = 严格 reject,**必须 env `WAU_EDGE_JWT_SECRET=xxx` 启动 wau-edge**

#### 3.1.4 完整 Auth 示例

```typescript
import { Client, Role } from "wau-sdk";

const c = new Client("http://localhost:18402", {  // wau-edge 端口
  auth: {
    role: Role.TRUSTED_AGENT,
    agentName: "my-agent",
    tenantId: "tenant-A",                          // ⭐ 必填
    subject: "user-123",                           // 可选
    sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,
  },
});

const resp = await c.chat.completions(
  new ChatCompletionRequest({
    model: "wau-default",
    messages: [new ChatMessage({ role: "user", content: "hello" })],
  })
);
console.log(`chatcmpl:${resp.id} tokens=${resp.usage.totalTokens}`);
```

⚠️ **ESM 导入**:必须 `import { Client, ChatMessage, ChatCompletionRequest } from "wau-sdk"`,**避免** `import * as wau` — ESM 下 CJS 兼容 module 会有命名冲突。

---

### 3.2 KernelService

#### 3.2.1 `KernelService.info() -> Promise<KernelInfo>`

`GET /kernel/info` — 返 kernel 元信息(`version`, `startTime`, `uptime`, `agentsCount`, `tasksCount`)。

```typescript
const info = await c.kernel.info();
console.log(`kernel ${info.version} uptime=${info.uptime}s agents=${info.agentsCount}`);
```

#### 3.2.2 `KernelService.health() -> Promise<HealthResponse>`

`GET /health` — 检查 kernel 健康(redis 连通性、版本、uptime、错误码)。

```typescript
const h = await c.kernel.health();
if (h.status === "ok" && h.redis === "connected") {
  console.log("✅ kernel healthy");
} else {
  console.log(`❌ kernel error=${h.error}`);
}
```

---

### 3.3 AgentsService

#### 3.3.1 `AgentsService.list(opts?) -> Promise<AgentListResponse>`

`GET /registry/agents?page=...&pageSize=...&skill=...&status=...&search=...`

`PageOptions` 字段(类):

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page?` | `number` | `1` | 1-based 页码 |
| `pageSize?` | `number` | `10` | 页面大小(最大 100) |
| `skill?` | `string` | `undefined` | 可选技能过滤 |
| `status?` | `string` | `undefined` | 可选状态过滤 |
| `search?` | `string` | `undefined` | 可选模糊匹配 |

```typescript
const resp = await c.agents.list(new PageOptions({
  page: 1,
  pageSize: 20,
  skill: "clinical-decision-support",
}));
console.log(`total=${resp.total} page=${resp.page}/${resp.totalPages}`);
for (const a of resp.agents) {
  console.log(`  ${a.name}: trust=${a.trust} universes=${a.universes}`);
}
```

#### 3.3.2 `AgentsService.iter(opts?) -> AsyncIterable<Agent>`

异步迭代器,懒加载遍历所有页(ES2024 `for await...of`):

```typescript
for await (const agent of c.agents.iter({ pageSize: 50 } as PageOptions)) {
  console.log(agent.name, agent.trust, agent.status);
}
```

#### 3.3.3 `AgentsService.get(name) -> Promise<AgentStatus>`

`GET /registry/agents/{name}/status` — 综合状态(load + trust + circuit)。

#### 3.3.4 `AgentsService.score(name) -> Promise<AgentScore>`

`GET /registry/agents/{name}/score` — 5 维评分(`totalScore` + `trustScore` + `skillMatch` + `healthScore` + `loadScore`)。

#### 3.3.5 `AgentsService.register(req) -> Promise<void>`

`POST /registry/agents/register` — 注册新 agent(RBAC: `trusted_agent` / `kernel_core`)。

```typescript
await c.agents.register(new AgentRegisterRequest({
  name: "my-agent",
  url: "http://my-agent:18800",
  description: "Medical CDS agent",
  skills: ["clinical-decision-support"],
  universes: ["medical"],
  universeLabels: { region: "us-east", gpu: "a100" },  // v0.8.0 M3-2C K8s labels
}));
```

#### 3.3.6 `AgentsService.deregister(name) -> Promise<void>`

`DELETE /registry/agents/{name}` — 注销 agent。

#### 3.3.7 `AgentsService.heartbeat(agentId) -> Promise<void>`

`POST /registry/agents/heartbeat` — agent 主动心跳上报(60s 一次)。

#### 3.3.8 `AgentsService.reportLoad(agentId, load) -> Promise<void>`

`POST /heartbeat/load` — 上报运行时负载(`activeTasks` / `maxCapacity` / `cpuUsage` / `memoryUsage`)。

```typescript
await c.agents.reportLoad("my-agent", new AgentLoad({
  activeTasks: 3,
  maxCapacity: 10,
  cpuUsage: 0.45,
  memoryUsage: 0.62,
}));
```

---

### 3.4 TasksService

#### 3.4.1 `TasksService.submit(req) -> Promise<SubmitResponse>`

`POST /registry/tasks/submit` — L4 真发 A2A。

```typescript
const resp = await c.tasks.submit(new SubmitRequest(
  "What is the capital of France?",
  30_000,  // timeoutMs
));
console.log(`✅ ${resp.selected_agent}: score=${resp.score.toFixed(2)} `
            + `a2a=${resp.a2a_call_ms}ms response=${resp.response}`);
```

**`SubmitRequest` 关键修正**(per Stage 0):
- 构造函数:`new SubmitRequest(prompt: string, timeoutMs?: number)`
- 只有 2 个字段:必填 `prompt` + 可选 `timeoutMs`
- wau-cli 旧 DTO(`{message, sourcePeer, ...}`)已废弃
- SDK 以 kernel 真相源为准(per [[project-v0-9-0-stage0-closure-2026-06-28]])

#### 3.4.2 `TasksService.simulate(req) -> Promise<DecisionInfo>`

`POST /registry/tasks/submit/simulate`(L3 决策) — 走 Thompson 评分但不真发。
返 `DecisionInfo`(无 `a2a_call_ms` / `response`)。

#### 3.4.3 `TasksService.get(taskId) -> Promise<Task>`

`GET /registry/tasks/{taskId}` — 查询任务详情(`status` / `assignedAgent` / `result`)。

---

### 3.5 HandshakeService

> **v0.8.0 M5-1 B.1**:4 SDK Handshake Client 当日完成,字段 1:1 对齐 `kernel/internal/handshake/session.go:92-142`。

#### 3.5.1 `HandshakeService.createSession(req) -> Promise<HandshakeResponse>`

`POST /v0.8.0/handshake/sessions` — 创建 handshake session(返回 `directEndpoint`,4 SDK 复用同一逻辑)。

```typescript
const req = new HandshakeRequest({
  tenantId: "tenant-A",   // 必填
  clientId: "my-bot-v1",  // 可选(空时自动用 SDK userAgent)
  agentId: "my-agent",
  protocol: "a2a",
  universe: "medical",
});
const resp = await c.handshake.createSession(req);
console.log(`session_id=${resp.sessionId} direct=${resp.directEndpoint} reused=${resp.reused}`);
```

#### 3.5.2 `HandshakeService.getSession(sessionId) -> Promise<HandshakeSessionDetail>`

`GET /v0.8.0/handshake/sessions/{id}` — 查询 session 详情(11 字段)。

#### 3.5.3 `HandshakeService.getStats() -> Promise<HandshakeStats>`

`GET /admin/handshake/stats` — 全局统计(`totalSessions` / `totalReuses` / `reuseHitRate` / `perTenant`)。

---

### 3.6 IntentService(M3.1 stub)

P2 / M3.1 阶段 stub,所有方法返 `NotImplementedError`:
- `IntentService.recommend(prompt, topK=1)` — 返 `Promise<any>`
- `IntentService.parseIntent(text)` — 返 `Promise<any>`
- `IntentService.listAgents(onlineOnly=true)` — 返 `Promise<any>`
- `IntentService.healthCheck()` — 返 `Promise<any>`

```typescript
import { NotImplementedError } from "wau-sdk";
try {
  await c.intent.recommend("hi");
} catch (e) {
  if (e instanceof NotImplementedError) {
    console.log("⏳ IntentService M3.1 阶段未实装");
  }
}
```

---

### 3.7 ChatService ⭐(Stage 3.1 2xx 验证)

> **v0.9.0 M3 §3.7 + D20 architecture-pivot**:Chat 直连 wau-edge `:18402/v1/chat/completions`(走 wau-llm-router + new-api),替换 v0.8.0 时代 `tasks.submit` 旧路径。
> **Stage 3.1 #6 TypeScript SDK e2e(2026-07-01)**:真实 2xx 响应 = `chatcmpl-b8d6af4c` / `wau-default` / 1 choice / **15 tokens** ✅。

#### 3.7.1 `ChatService.completions(req) -> Promise<ChatCompletionResponse>`

`POST /v1/chat/completions`(OpenAI 兼容)。

**完整链路**(per M3 §4.5.1):
```
bot → wau-edge :18402 /v1/chat/completions
     → wau-llm-router :18404 /v1/resolve  (决定 userToken + model)
     → new-api :3000 /v1/chat/completions  → LLM provider
```

**完整示例**(实测 2xx):
```typescript
import { Client, ChatMessage, ChatCompletionRequest } from "wau-sdk";

const c = new Client("http://localhost:18402", {  // wau-edge 端口
  auth: {
    role: Role.TRUSTED_AGENT,
    agentName: "my-agent",
    tenantId: "tenant-A",
    sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,
  },
});

const resp = await c.chat.completions(new ChatCompletionRequest({
  model: "wau-default",
  messages: [
    new ChatMessage({ role: "user", content: "Say hi in 3 words" }),
  ],
}));

console.log(`chatcmpl:${resp.id} model=${resp.model} choices=${resp.choices.length}`);
console.log(`usage: prompt=${resp.usage.promptTokens} `
          + `completion=${resp.usage.completionTokens} `
          + `total=${resp.usage.totalTokens} tokens`);
console.log(`answer: ${resp.choices[0].message.content}`);
// 输出:
// chatcmpl:chatcmpl-b8d6af4c model=wau-default choices=1
// usage: prompt=14 completion=1 total=15 tokens
// answer: Hello there friend!
```

**`ChatCompletionRequest` 构造参数**(类,字段顺序敏感):

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | `string` | **是** | `""` | 模型名(如 `"wau-default"` / `"gpt-4o-mini"` / `"claude-haiku"`),空时 wau-edge 走 default_model |
| `messages` | `ChatMessage[]` | **是** | `[]` | ≥ 1 条 user 消息 |
| `stream` | `boolean` | 否 | `false` | 雏形期只支持 `false` |
| `universe` | `string` | 否 | `""` | 业务分组(透传到 wau-llm-router + new-api) |
| `metadata` | `Record<string, string>` | 否 | `{}` | 自定义元数据 |
| `temperature?` | `number` | 否 | `undefined` | 0-2 |
| `maxTokens` | `number` | 否 | `0` | 限制最大输出(0 = 不限制) |

**校验**(客户端):
- `model` 为空 → 客户端 `throw Error`(拦在 SDK,不发请求)
- `messages` 为空 → 客户端 `throw Error`

**`ChatCompletionResponse` 字段**(8 字段,1:1 对齐 OpenAI):

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 形如 `chatcmpl-b8d6af4c`(wau-edge 生成) |
| `object` | `string` | 总是 `"chat.completion"` |
| `created` | `number` | UNIX timestamp(秒) |
| `model` | `string` | 实际用到的模型(可能 = 请求 model 或 wau-edge 重写) |
| `choices` | `ChatChoice[]` | LLM 返回的 choices(实测 1) |
| `usage` | `ChatUsage` | Token usage(`promptTokens` / `completionTokens` / `totalTokens`) |
| `reason` | `string` | WAU 扩展:wau-llm-router 决策原因 |

#### 3.7.2 Streaming 限制(per Stage 1)

```typescript
// v0.9.0 alpha:Stream 必须 false
const req = new ChatCompletionRequest({
  model: "wau-default",
  messages: [new ChatMessage({ role: "user", content: "hi" })],
  stream: false,  // ← 必须 false
});
// v1.2.0+:用 completionsStream(req) (per §8.3 路线)
```

---

### 3.8 Retry / Circuit 状态查询

#### 3.8.1 `RetryConfig` interface

| 字段 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `maxRetries` | `number` | `3` | ≥ 0 | 最大重试次数(`0` = 不重试) |
| `initialBackoffMs` | `number` | `200` | > 0 | 初始退避(ms) |
| `maxBackoffMs` | `number` | `5000` | ≥ initial | 最大退避(ms) |
| `jitter` | `number` | `0.2` | [0.0, 1.0] | 抖动比例 |
| `retryOn` | `number[]` | `[500, 502, 503, 504, 429]` | HTTP 状态码 | 触发重试的状态码 |

**策略**:指数退避 + 抖动。**只对幂等请求自动重试**(GET / HEAD);非幂等 POST 默认不重试。

#### 3.8.2 `CircuitConfig` interface

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `failureThreshold` | `number` | `5` | 连续失败次数触发开路 |
| `openTimeoutMs` | `number` | `30000` | 开路持续时间(30s 后半开恢复) |
| `halfOpenMax` | `number` | `1` | 半开状态允许的探测请求数 |
| `enabled` | `boolean` | `true` | 是否启用熔断(测试时可设 `false`) |

#### 3.8.3 `Client.circuitState() -> string`

```typescript
const c = new Client("http://localhost:18400");
const state = c.circuitState();  // "closed" | "open" | "half-open"
console.log(`circuit=${state}`);
```

**详细**:见 `docs/retry_circuit.md`(新建于 Stage 3.2,07-03)。

---

## 4. Bot 子包(per D13)

> **D13 拍板(2026-06-26)**:4 SDK Bot interface 完全统一 — 5 个方法签名 100% 一致。
> Go `Start/Stop/OnMessage/WithTenant/WithUniverse` ↔ TypeScript `start/stop/onMessage/withTenant/withUniverse`(全 `Promise<>`)。

### 4.1 公共类型(`wau-sdk/bot/common`)

| 类型 | 字段 | 说明 |
|---|---|---|
| `IncomingMessage` | `id` / `text` / `fromId` / `fromName` / `chatId` / `timestamp` / `attachment` | 收到用户消息 |
| `OutgoingMessage` | `text` / `replyTo` / `attachment` | 发送给用户消息 |
| `Attachment` | `type` / `url` / `mimeType` / `size` | 通用附件(type ∈ `"image"` / `"file"` / `"audio"` / `"video"`) |
| `Bot`(interface)| 5 个方法(见下)| 通用 Bot 接口 |
| `MessageHandler` | `(msg: IncomingMessage) => OutgoingMessage` | handler 签名 |

**4 SDK 必须实现的 5 个方法**(`Promise<>` 统一):
1. `start(): Promise<void>` — 启动 bot(长连接 / webhook server)
2. `stop(): Promise<void>` — 优雅停止
3. `onMessage(handler: MessageHandler): Bot` — 注册 handler,**返回 Bot 链式**
4. `withTenant(tenantId: string): Bot` — 设置 tenant 上下文,**返回 Bot 链式**
5. `withUniverse(universe: string): Bot` — 设置 universe 上下文,**返回 Bot 链式**

```typescript
import { Bot, MessageHandler, IncomingMessage, OutgoingMessage } from "wau-sdk/bot/common";
```

### 4.2 Telegram Bot(`wau-sdk/bot/telegram`)— Stage 1 M1 实装

```typescript
import { TelegramBot } from "wau-sdk/bot/telegram";

const bot = new TelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  tenantId: "tenant-A",
});

bot.onMessage((msg) => ({
  text: `echo: ${msg.text}`,
  replyTo: msg.id,
}));

await bot.start();
```

### 4.3 Discord Bot(`wau-sdk/bot/discord`)— Stage 1 M1 实装

```typescript
import { DiscordBot } from "wau-sdk/bot/discord";

const bot = new DiscordBot({
  token: process.env.DISCORD_BOT_TOKEN!,
  tenantId: "tenant-A",
});

bot.onMessage((msg) => ({ text: `echo: ${msg.text}` }));

await bot.start();
```

### 4.4 Webhook Bot(`wau-sdk/bot/webhook`)— 通用 HTTP webhook

```typescript
import { WebhookBot } from "wau-sdk/bot/webhook";

const bot = new WebhookBot({
  listenAddr: ":8080",
  path: "/webhook",
  tenantId: "tenant-A",
});

bot.onMessage((msg) => ({ text: `echo: ${msg.text}` }));

await bot.start();  // long-lived
```

### 4.5 5+ 其他平台(推 v1.0.0)

- **Slack** / **WhatsApp** / **钉钉** / **飞书** / **Email** — 留 v1.0.0 推
- **Stage 3.2** 注册接口已就位(`withTenant` / `withUniverse` 已支持多租户 / 多 universe)
- 跟踪 issue:https://github.com/XploreAlpha/wau-typescript-sdk/issues

---

## 5. 配置项

### 5.1 环境变量覆盖

| 变量 | 默认 | 用途 |
|---|---|---|
| `WAU_EDGE_JWT_SECRET` | (无) | HS256 共享密钥(从 env 注入到 `AuthConfig.sharedSecret`) |
| `WAU_KERNEL_BASE_URL` | `http://localhost:18400` | wau-core-kernel 地址(Quickstart 用) |
| `WAU_EDGE_BASE_URL` | `http://localhost:18402` | wau-edge 地址(Chat 用) |
| `WAU_TENANT_ID` | (无) | 当前请求 tenantId(从 env 读) |

### 5.2 YAML / dotenv 配置(可选)

```typescript
// 用 dotenv 加载 .env 文件
import * as dotenv from "dotenv";
dotenv.config();

const c = new Client("http://localhost:18402", {
  auth: {
    role: Role.TRUSTED_AGENT,
    agentName: "my-agent",
    tenantId: process.env.WAU_TENANT_ID!,
    sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,
  },
});
```

---

## 6. 类型定义

> 所有 DTO 在 [`src/types.ts`](./src/types.ts)。字段以 **WAU-core-kernel 真相源**为准(per [[project-v0-9-0-stage0-closure-2026-06-28]])。

### 6.1 Chat DTO(per §3.7)

| 类型 | 字段 |
|---|---|
| `ChatMessage` | `role` / `content` / `name=""` |
| `ChatCompletionRequest` | `model` / `messages` / `stream=false` / `universe=""` / `metadata={}` / `temperature?` / `maxTokens=0` |
| `ChatChoice` | `index=0` / `message` / `finishReason=""` |
| `ChatUsage` | `promptTokens=0` / `completionTokens=0` / `totalTokens=0` |
| `ChatCompletionResponse` | `id=""` / `object="chat.completion"` / `created=0` / `model=""` / `choices=[]` / `usage` / `reason=""` |

### 6.2 Tasks DTO

```typescript
export class SubmitRequest {
  constructor(
    public prompt: string,        // 必填
    public timeoutMs?: number,
  ) {}
}

export class SubmitResponse {
  task_id: string = "";
  agent_id: string = "";
  selected_agent: string = "";
  score: number = 0;
  decision: DecisionInfo = new DecisionInfo();
  status: string = "";
  a2a_call_ms: number = 0;
  response: unknown = null;
  error: string = "";
  source_peer: string = "";
  source_agent_id: string = "";
}
```

### 6.3 Handshake DTO(v0.8.0 M5-1 B.1)

| 类型 | 字段 |
|---|---|
| `HandshakeRequest` | `tenantId` / `clientId=""` / `agentId=""` / `protocol="a2a"` / `universe=""` |
| `HandshakeResponse` | `sessionId` / `directEndpoint` / `protocol` / `expiresAt` / `ttlSeconds` / `reused` |
| `HandshakeSessionDetail` | `sessionId` / `tenantId` / `clientId` / `agentId` / `directEndpoint` / `protocol` / `trustScore` / `createdAt` / `expiresAt` / `ttlSeconds` / `reuseCount` |
| `HandshakeStats` | `totalSessions` / `totalReuses` / `reuseHitRate` / `activeSessions` / `perTenant` |

### 6.4 Agents DTO

| 类型 | 字段(部分)|
|---|---|
| `Agent` | `name` / `id=""` / `url=""` / `description=""` / `skills=[]` / `universes=[]` / `universeLabels?`(v0.8.0 M3-2C)/ `trust=0.0` / `status=""` / `lastSeen=""` |
| `AgentRegisterRequest` | `name` / `url` / `description=""` / `skills=[]` / `universes=[]` / `universeLabels?` |
| `AgentScore` | `name` / `totalScore` / `trustScore` / `skillMatch` / `healthScore` / `loadScore` |
| `AgentLoad` | `activeTasks` / `maxCapacity=10` / `cpuUsage` / `memoryUsage` |
| `AgentStatus` | `name` / `status` / `trust` / `load` / `circuit="closed"` |

### 6.5 通用的 Request / Response 类型

| 类型 | 字段 |
|---|---|
| `HealthResponse` | `status` / `version` / `uptime` / `redis` / `error?` |
| `KernelInfo` | `version` / `startTime` / `uptime` / `agentsCount` / `tasksCount` |
| `PageOptions` | `page?` / `pageSize?` / `skill?` / `status?` / `search?` |
| `Candidate` | `name` / `score=0.0` / `reason=""` |
| `DecisionInfo` | `selected_agent=""` / `score=0.0` / `decision_time_ms=0` / `candidates=[]` |
| `Task` | `taskId` / `message` / `sourcePeer` / `sourceAgentId` / `status` / `assignedAgent` / `result` / `createdAt` / `updatedAt` / `requiredSkills` |

---

## 7. 错误码

> 所有错误继承 `WauError`。HTTP 4xx/5xx 由 `Transport` 自动映射到对应子类。

### 7.1 `APIError` 基类

| 字段 | 类型 | 说明 |
|---|---|---|
| `statusCode` | `number` | HTTP 状态码(如 404)(`readonly`) |
| `code` | `string` | wau 标准错误码(如 `"not_found"`)(`readonly`) |
| `requestId` | `string` | server 端 request ID(用于日志追踪)(`readonly`) |
| `body` | `Buffer \| undefined` | 原始响应体(debug 用,前 200 字符自动截断)(`readonly`) |
| `is(target: WauError)` | `boolean` | 允许 `errors.is(err, NotFoundError)` 模式匹配 statusCode |

**捕获示例**:
```typescript
import { APIError, NotFoundError } from "wau-sdk";

try {
  await c.tasks.submit(new SubmitRequest("hi"));
} catch (err) {
  if (err instanceof APIError) {
    logger.error({
      status: err.statusCode,
      code: err.code,
      requestId: err.requestId,
      body: err.body?.toString("utf-8").slice(0, 200),
    });
  }
}
```

### 7.2 9 SDK Sentinel(per Stage 1)

| 异常类 | 状态码 | 触发 |
|---|---|---|
| `NotFoundError` | 404 | 资源不存在 |
| `UnauthorizedError` | 401 | 鉴权失败(per Stage 3.1 #1 缺 `tenantId` 也会触发) |
| `ForbiddenError` | 403 | RBAC 不足 |
| `BadRequestError` | 400 | 字段缺失 / 格式错 |
| `ConflictError` | 409 | 资源冲突(重名注册等) |
| `APIError` | 其他 4xx/5xx | 通用 HTTP 错(基类) |
| `CircuitOpenError` | — | 熔断开("circuit breaker is open") |
| `MaxRetriesError` | — | 重试耗尽(`lastError` 属性保存 last error)|
| `NotImplementedError` | — | P2 stub(IntentService) |

**捕获约定**:`instanceof` + 状态码:
```typescript
try {
  await c.tasks.submit(req);
} catch (err) {
  if (err instanceof NotFoundError) {
    // err.statusCode 自动 = 404
    ...
  } else if (err instanceof UnauthorizedError) {
    // err.statusCode 自动 = 401
    ...
  } else if (err instanceof APIError) {
    logger.error(`unexpected: status=${err.statusCode} code=${err.code}`);
  }
}
```

### 7.3 9 Handshake Sentinel(per v0.8.0 M5-1 B.1)

| 异常类 | 状态码 | code | 触发 |
|---|---|---|---|
| `HandshakeInsufficientTrustError` | 403 | `INSUFFICIENT_TRUST` | Agent 信任分不足 |
| `HandshakeAgentNotFoundError` | 404 | `AGENT_NOT_FOUND` | Agent 不存在 |
| `HandshakeTenantMismatchError` | 403 | `TENANT_MISMATCH` | 跨 tenant |
| `HandshakeRateLimitedError` | 429 | `RATE_LIMITED` | 频次限制 |
| `HandshakeProtocolNotSupportedError` | 400 | `PROTOCOL_NOT_SUPPORTED` | 协议不支持 |
| `HandshakeSessionNotFoundError` | 404 | `SESSION_NOT_FOUND` | Session 不存在 |
| `HandshakeAgentNoEndpointError` | 404 | `AGENT_NO_ENDPOINT` | Agent 无 endpoint |
| `HandshakeInvalidProtocolError` | 400 | `INVALID_PROTOCOL` | 协议格式错 |
| `HandshakeInvalidRequestError` | 400 | `INVALID_REQUEST` | 请求格式错 |

### 7.4 wau-edge 错误码(透传到 SDK,Stage 3.1 实测)

| wau-edge 错误 | 状态码 | 触发 |
|---|---|---|
| `INSUFFICIENT_TRUST` | 403 | Agent 信任不足 |
| `AGENT_NOT_FOUND` | 404 | Agent 不存在 |
| `TENANT_MISMATCH` | 403 | 跨 tenant 访问 |
| `RATE_LIMITED` | 429 | 频次限制 |
| `PROTOCOL_NOT_SUPPORTED` | 400 | 协议不支持 |
| `MODEL_NOT_FOUND` | 404 | Model 不在 wau-llm-router universe 配置中(per [[project-v0-9-0-M3-§3.7-chat-sdk-4langs-2026-06-30]]) |

### 7.5 自定义 Client 校验

| 异常 | 触发 |
|---|---|
| `Error`(非 `WauError`)| `ChatCompletionRequest` 客户端拦截空 `model` / `messages`(不发请求) |
| `Error` | `Signer` 构造时 `sharedSecret` / `agentName` / `tenantId` 任一为空 |
| `RangeError` | `RetryConfig.maxBackoffMs < initialBackoffMs` 或 `jitter` 不在 [0,1] |

---

## 8. 版本与变更

### 8.1 当前版本

**v1.1.0**(v0.9.0 "Acorn" Stage 3.2 完整化,2026-07-03,SDK 同步发版 per [[project-v0-8-0-GA-2026-07-13]])
- ✅ 11 HTTP 端点 × 6 服务(per Stage 0 4 SDK 5/5 字段对齐)
- ✅ Stage 3.1 #1+#2:`AuthConfig.tenantId` 必填(per [[project-v0-9-0-blocker-fix-1-plus-2-2026-07-01]])
- ✅ Stage 3.1 #6:TypeScript SDK Chat e2e 2xx 实测(`chatcmpl-b8d6af4c` / 15 tokens)
- ✅ ESM 兼容(per [[project-v0-9-0-sdk-typescript-e2e-2026-07-01]]):修复 `import * as jwt → import jwt default` bug
- ✅ Bot 5 方法 interface 4 SDK 完全统一(per D13)
- ✅ Handshake 9 sentinel error 4 SDK 一致

### 8.2 升级指南(v0.7.0 → v1.1.0)

```bash
npm install wau-sdk@^1.1.0
```

**破坏性变更**:
1. **AuthConfig.tenantId 必填**(per Stage 3.1 #1):v0.7.x 时代可选,v1.1.0 必填。
   修复:
   ```typescript
   const auth = {
     ...,
     tenantId: "tenant-A",  // 必填(per Stage 3.1 #1)
     sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,
   };
   ```
2. **ESM import 语法**(per Stage 3.1 #6):必须 `import { Client } from "wau-sdk"`,**避免** `import * as wau`。
3. **Chat DTO**:v0.8.0 时代 Chat 走 `tasks.submit` 旧路径,v1.1.0 必须用 `chat.completions` 直连 wau-edge。

**非破坏**:
- ✅ Bot 5 方法接口不变(`Promise<>` 风格已就位)
- ✅ 11 端点路径不变
- ✅ `instanceof` / `errors.is` 错误判断仍可用

### 8.3 v1.2.0+ 路线(不做的)

- ❌ Streaming SSE(留 v1.2.0):用 `completionsStream(req)` 替换
- ❌ Slack / WhatsApp / 钉钉 / 飞书 / Email bot(留 v1.0.0)
- ❌ IntentService gRPC 4 方法实装(留 M3.1)
- ❌ Thompson Update 给 SDK 暴露(留 v1.0.0 后)

### 8.4 历史

| 版本 | 日期 | 关键变更 |
|---|---|---|
| v0.6.0-preview.1 | 2026-06-14 | W6.7-W6.11:11 端点 + 异步镜像 + retry/circuit + 4 docs + 4 examples |
| v1.0.0 GA | 2026-06-19 | W7.7:Public API stable + deprecation policy 文档校准 |
| **v1.1.0** | **2026-07-13**(target) | **v0.9.0 sync:Stage 3.1 #1+#2 tenantId fix + #6 TS SDK e2e + ESM 修复 + Stage 3.2 doc 完整化** |

---

## 链接

- [README.md](./README.md) — 入口
- [QUICKSTART.md](./QUICKSTART.md) — 15 分钟跑通(已存在,Stage 3.2 不重写)
- [DEPLOY.md](./DEPLOY.md) — npm 发布
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 模块 + 4 SDK 对齐
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更
- [docs/quickstart.md](./docs/quickstart.md) — Bot 5 分钟上手(Stage 3.2 新建 07-03)
- [docs/auth.md](./docs/auth.md) — HS256 + JWT 详细(Stage 3.2 新建 07-03)
- [docs/retry_circuit.md](./docs/retry_circuit.md) — 重试 + 熔断详细(Stage 3.2 新建 07-03)
- [examples/](./examples/) — 7 个 runnable example
- [FAQ.md](./FAQ.md) — 故障排查(10 通用 + 5 TS 特定)

---

**维护**:Claude + youhaoxi(Stage 3.2 SDK doc 完整化,2026-07-03)
**WAU 业务代码改动 = 0**(纯文档,不改 .ts)
