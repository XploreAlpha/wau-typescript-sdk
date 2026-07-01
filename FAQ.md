# wau-typescript-sdk 故障排查(FAQ)

> **版本**:v1.1.0(v0.9.0 "Acorn" Stage 3.2,2026-07-03)
> **范围**:10 通用问题 + 5 TypeScript / Node.js 语言特定问题 = 15 Q&A
> **配套**:`docs/retry_circuit.md`(重试熔断详解)+ `docs/auth.md`(鉴权详解)

---

## 通用问题(10 Q,跨 4 SDK 适用)

### Q1: 401 Unauthorized / invalid tenant

**症状**:
```
WauAPIError(status=401, code=unauthorized, request_id=..., message=..., body="{"error":"tenant_id missing"}")
```

**原因**:
- `Signer.sign()` 没签 `tenant_id` claim(per Stage 3.1 #1 修复前的旧 bug)
- `wau-edge` JWT secret 跟 SDK `AuthConfig.sharedSecret` 不一致
- `AuthConfig.tenantId` 是空字符串

**修复**:
```typescript
// 1. 必填 tenantId(空字符串 → Signer 构造时 throw Error)
const auth = {
  role: Role.EXTERNAL_AGENT,
  agentName: "my-agent",
  tenantId: "tenant-A",  // ← 必填,per Stage 3.1 #1
  sharedSecret: process.env.WAU_EDGE_JWT_SECRET!,  // 必填
};

// 2. JWT secret 一致(server 端 wau-edge/internal/auth/jwt.go 校验)
//    wau-edge 默认空 secret = 严格 reject(per #1+#2 修复)
//    必须 env WAU_EDGE_JWT_SECRET=xxx 启动 wau-edge

// 3. 验证
import axios from "axios";
import { Signer, ChatMessage, ChatCompletionRequest } from "wau-sdk";

const signer = new Signer(auth);
const token = signer.sign(300);
const r = await axios.post(
  "http://localhost:18402/v1/chat/completions",
  { model: "wau-default", messages: [{ role: "user", content: "hi" }] },
  { headers: { Authorization: `Bearer ${token}` } }
);
console.log(r.status);  // 期望:200
```

**进度报告**:[[project-v0-9-0-blocker-fix-1-plus-2-2026-07-01]]

---

### Q2: connection refused :18402 / :18400 / :18404

**症状**:
```
Error: connect ECONNREFUSED 127.0.0.1:18402
# 或 WauAPIError(status=502, code=..., body=...)
```

**原因**:wau-core-kernel(:18400)/ wau-edge(:18402)/ wau-llm-router(:18404)未启。

**修复**:
```bash
# 走 §3.8 onelab 脚本(4 步基线)
bash /home/inamoto888/WAU-develop/develop-log/kernel/v0.9.0/v0.9.0-onelab-deploy.sh up

# 或单独启(每个进程一个 tmux pane)
cd /home/inamoto888/project/wau-edge
go run ./cmd/wau-edge -config configs/edge.yaml &

cd /home/inamoto888/project/wau-llm-router
go run ./cmd/wau-llm-router -config configs/router.yaml &

# 验证端口活
curl http://127.0.0.1:18402/health     # wau-edge
curl http://127.0.0.1:18400/health     # wau-core-kernel
grpcurl 127.0.0.1:18404 list           # wau-llm-router gRPC
ss -tlnp | grep -E ":1840[0-4]"
```

**端口速查**:

| 服务 | HTTP | gRPC | 备注 |
|---|---|---|---|
| wau-core-kernel | :18400 | :18401 | SDK baseURL 默认 |
| wau-edge | :18402 | :18403 | Chat completions 用 |
| wau-llm-router | :18403 | :18404 | HTTP/gRPC 不同协议层不冲突 |

---

### Q3: timeout / AbortError

**症状**:
```
AxiosError: timeout of 30000ms exceeded
# 或 DOMException: signal is aborted without reason
```

**原因**:`ClientOptions.timeoutMs` < kernel 处理时间。

**修复**:
```typescript
// 1. 调高 timeout(默认 30000ms = 30s)
const c = new Client("http://localhost:18400", { timeoutMs: 60_000 });

// 2. 长 task 用 SubmitRequest.timeoutMs
const resp = await c.tasks.submit(new SubmitRequest("long task", 300_000));

// 3. 单次请求传 AbortSignal(覆盖全局 timeout)
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 90_000);
const resp = await c.kernel.info();  // AbortSignal 需 Transport 支持
```

---

### Q4: `bot.start()` 卡住 / 不响应

**症状**:`await bot.start()` 返回但 Telegram/Discord/Webhook 不响应消息。

**原因**:
- Bot token 没设 / 不对(env var 没读到)
- 网络不通(国内访问 Telegram/Discord API 需代理)
- `onMessage` handler 没注册

**修复**:
```typescript
import { TelegramBot } from "wau-sdk/bot/telegram";

// 1. 检查 token
const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
console.log(token.slice(0, 10));  // 应该以数字开头(格式:123456:ABC-DEF...)
if (!token) throw new Error("❌ TELEGRAM_BOT_TOKEN 未设");

// 2. 检查网络(proxy 用 proxy-agent)
import { HttpsProxyAgent } from "https-proxy-agent";
import axios from "axios";
const r = await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
  httpsAgent: new HttpsProxyAgent("http://127.0.0.1:7890"),
  timeout: 10_000,
});
console.log(r.data);  // { ok: true, result: {...} }

// 3. SDK 端确认 onMessage 注册
const bot = new TelegramBot({ token, tenantId: "tenant-A" });
bot.onMessage((msg) => ({ text: `echo: ${msg.text}`, replyTo: msg.id }));
await bot.start();
```

**注意**:Bot interface 5 个方法(`start` / `stop` / `onMessage` / `withTenant` / `withUniverse`)必须实现(per D13)。

---

### Q5: 重试耗尽 / 熔断开

**症状**:
```
MaxRetriesError: max retries exceeded: ...
CircuitOpenError: circuit breaker is open
```

**原因**:上游 5xx / 网络抖动超过阈值。

**修复**:
```typescript
import {
  Client,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_CONFIG,
} from "wau-sdk";

// 1. 调高 retry 阈值(默认 3 次)
const c = new Client("http://localhost:18400", {
  retry: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 5,
    initialBackoffMs: 500,
    maxBackoffMs: 10_000,
    retryOn: [500, 502, 503, 504, 429],
  },
});

// 2. 调高熔断阈值(默认 5 失败)
const c2 = new Client("http://localhost:18400", {
  circuit: {
    ...DEFAULT_CIRCUIT_CONFIG,
    failureThreshold: 10,
    openTimeoutMs: 60_000,
  },
});

// 3. 临时禁用(测试用)
const c3 = new Client("http://localhost:18400", {
  retry: { ...DEFAULT_RETRY_CONFIG, maxRetries: 0 },
  circuit: { ...DEFAULT_CIRCUIT_CONFIG, enabled: false },
});

// 4. 检查当前熔断状态
console.log(c.circuitState());  // "closed" | "open" | "half-open"
```

**详细**:[docs/retry_circuit.md](./docs/retry_circuit.md)

---

### Q6: chat completions 返回 404 MODEL_NOT_FOUND

**症状**:
```
NotFoundError: WauAPIError(status=404, code=MODEL_NOT_FOUND, ...)
```

**原因**:`model` 字段不在 wau-llm-router universe 配置里。

**修复**:
```typescript
import { ChatMessage, ChatCompletionRequest } from "wau-sdk";

// Stage 1 MockModels 唯一接受 model 名(per §3.7 实测)
const resp = await c.chat.completions(new ChatCompletionRequest({
  model: "wau-default",  // ← Stage 1 唯一接受
  messages: [new ChatMessage({ role: "user", content: "hi" })],
}));

// Stage 2 后真模型(gpt-4o / claude-haiku 等)需 wau-llm-router 配 universe
// per wau-llm-router/configs/router.yaml
```

---

### Q7: Thompson Update 失败 / reward out of range

**症状**(v1.0.0 才会触发,本期不适用):
```
BadRequestError: thompson: reward out of range [0,1]
```

**原因**:reward 超 [0,1] 范围。

**修复**:
```typescript
// reward ∈ [0, 1](v1.0.0 实装后)
const update = { model: "gpt-4o-mini", reward: 0.85 };
```

---

### Q8: SDK 跨语言字段不一致

**症状**:Go SDK / Python SDK / TS SDK / Rust SDK 调同一端点,JSON 字段大小写 / 顺序不同。

**原因**:JSON 序列化策略差异(Go json.Marshal / Python json.dumps / TS JSON.stringify / Rust serde_json)。

**修复**:
- **Stage 0 收口**(2026-06-28):4 SDK 5/5 字段对齐(per [[project-v0-9-0-stage0-closure-2026-06-28]])
- **Stage 3.1 #4-#7** 实测:4 SDK Chat completions 全部 2xx 响应,字段字节级对齐
- **基准**:`wau-go-sdk/types.go` 为准(per ADR-0004),TS `types.ts` 镜像对齐
- **小差异**:字段顺序不影响语义,JSON parser 都容忍

```typescript
// TS 类构造参数顺序跟 Go json tag 镜像,编译器会强制顺序
export class SubmitRequest {
  constructor(
    public prompt: string,        // 必填
    public timeoutMs?: number,    // 可选,跟 Go json tag 对齐
  ) {}
}
```

---

### Q9: 流式响应 / SSE 不工作

**症状**:`stream: true` 返回非预期数据或报错。

**原因**:v0.9.0 alpha **不支持 streaming**(per `chat.ts` 注释 + Stage 1 限制)。

**修复**:
```typescript
// v0.9.0 alpha:用 completions() non-streaming
const resp = await c.chat.completions(new ChatCompletionRequest({
  model: "wau-default",
  messages: [new ChatMessage({ role: "user", content: "hi" })],
  stream: false,  // ← 必须 false
}));

// v1.2.0+:用 completionsStream(req) (per §8.3 路线)
```

---

### Q10: TLS / CA 证书错误

**症状**:
```
Error: unable to verify the first certificate
# 或 ENOTFOUND / CERT_HAS_EXPIRED / SELF_SIGNED_CERT_IN_CHAIN
```

**原因**:自签证书 / CA bundle 缺失 / Node.js 旧版。

**修复**:
```typescript
import axios from "axios";
import * as https from "node:https";

// 1. 注入跳过验证的 axios(仅 dev!)
const transport = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 30_000,
});

const c = new Client("https://wau.example.com", { transport });

// 2. 配 Node.js CA bundle
//    NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt node app.js
process.env.NODE_EXTRA_CA_CERTS = "/path/to/ca-bundle.crt";

// 3. 升级 Node.js + 用系统 CA
//    macOS:brew install ca-certificates
//    Linux:sudo update-ca-certificates
```

---

## TypeScript / Node.js 语言特定问题(5 Q)

### Q11: `npm install wau-sdk` ECONNRESET / EAI_AGAIN

**症状**:
```
npm install wau-sdk
npm ERR! network tunneling socket could not be established, cause=ECONNRESET
# 或 npm ERR! errno EAI_AGAIN
```

**原因**:npm registry 连不上 / 代理配置错 / DNS 解析失败。

**修复**:
```bash
# 1. 配国内镜像(npm config)
npm config set registry https://registry.npmmirror.com
npm install wau-sdk@1.1.0

# 2. 或 .npmrc 局部配置
echo "registry=https://registry.npmmirror.com" > .npmrc
npm install

# 3. 临时绕过 SSL(仅 dev!)
npm install wau-sdk@1.1.0 --registry=http://registry.npmjs.org --strict-ssl=false

# 4. 配代理(公司内网 npm proxy)
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890

# 5. 检查 Node.js + npm 版本
node --version  # >= 18
npm --version
```

---

### Q12: `import * as jwt from "jsonwebtoken"` → `jwt.sign is not a function`

**症状**(ESM 模式):
```
TypeError: jwt.sign is not a function
# 或 TypeError: jwt.default is not a function
```

**原因**(per [[project-v0-9-0-sdk-typescript-e2e-2026-07-01]]):ESM 下 `import * as jwt` 把 default export 当成命名空间导出,而 `jsonwebtoken` CJS 的 `module.exports = { sign, verify, ... }` 是命名空间,**ESM 下必须用 default import**。

**修复**:
```typescript
// ❌ 错(ESM 模式拿不到 sign 函数)
// import * as jwt from "jsonwebtoken";

// ✅ 对:ESM default import(命名空间对象)
//    此时 jwt 是 { sign, verify, ... }
//    jwt.sign 就 work 了
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const token = jwt.sign({ foo: "bar" }, secret, { algorithm: "HS256" });

// ⚠️ 加 tsconfig.json:"esModuleInterop": true
//    或在 import 处 fallback:
// import * as jwtLib from "jsonwebtoken";
// const jwt = (jwtLib as any).default ?? jwtLib;
// const token = jwt.sign(...);
```

**快速验证**:
```bash
# 哪条 import 报错?ESM 还是 CJS?
node --input-type=module -e "import jwt from 'jsonwebtoken'; console.log(typeof jwt.sign)"
# 期望:function
```

---

### Q13: Promise rejection unhandled / no await

**症状**:
```
(node:12345) UnhandledPromiseRejectionWarning: ...
# 或 await 漏掉导致 result undefined
```

**原因**:`async` 函数返回 `Promise`,没用 `await` 或 `.then()` 就丢失。

**修复**:
```typescript
// ❌ 错:Promise 漏 await
function bad(): void {  // 隐式 Promise 返 void,Warning!
  c.tasks.submit(new SubmitRequest("hi"));  // ⚠️ no await
}

// ✅ 对:async 函数 + await,或返 Promise<void>
async function good(): Promise<void> {
  await c.tasks.submit(new SubmitRequest("hi"));
}

// ✅ 或用 .then / .catch 显式处理
c.tasks.submit(new SubmitRequest("hi"))
  .then((r) => console.log(r))
  .catch((err) => console.error(err));

// ✅ Promise.all 并发
const [info, health, agents] = await Promise.all([
  c.kernel.info(),
  c.kernel.health(),
  c.agents.list(),
]);

// ✅ AbortController 超时
const ctrl = new AbortController();
const timeout = setTimeout(() => ctrl.abort(), 30_000);
try {
  const resp = await c.tasks.submit(req, { signal: ctrl.signal });
} finally {
  clearTimeout(timeout);
}
```

---

### Q14: `AbortController` / `AbortSignal` 不生效

**症状**:传 `signal` 给 SDK,却捕获不到,或根本没传到 axios。

**原因**:SDK Transport 当前 **未必透传 AbortSignal**(axios 调 `request(method, path, body, options)` 时 options 需 SDK 支持)。

**修复**:
```typescript
// 1. SDK 客户端层 AbortController(SDK 自己用超时)
const ctrl = new AbortController();
const timeoutId = setTimeout(() => ctrl.abort(), 30_000);
try {
  const resp = await c.tasks.submit(req, { signal: ctrl.signal });
  //           ↑ 注:SDK 当前 options 未透传 signal,需要 SDK 实现
  //           暂时用以下降级方案 ↓
} catch (err) {
  if ((err as Error).name === "AbortError" || err === ctrl.signal.reason) {
    console.log("🛑 取消成功");
  } else {
    throw err;
  }
} finally {
  clearTimeout(timeoutId);
}

// 2. 降级方案:独立 axios 调 + AbortController
import axios from "axios";

async function chatWithAbort(req: ChatCompletionRequest, signal: AbortSignal) {
  const resp = await axios.post(`${c.baseURL}/v1/chat/completions`, req, { signal });
  return resp.data;
}

const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 5_000);
const data = await chatWithAbort(req, ctrl.signal);
```

---

### Q15: Bot 长跑 node event loop 阻塞 / 内存泄漏

**症状**:Bot 跑几天后 `process.memoryUsage()` 单调递增 / 任务堆积 / 不再响应消息。

**原因**:
- `onMessage` handler 内阻塞 IO(`fs.readFileSync` / `fetch` 同步版)
- 异步任务未收集(`Promise.all` 漏掉 reject handler)
- axios 连接池未复用 / 短连接爆发

**修复**:
```typescript
import { TelegramBot } from "wau-sdk/bot/telegram";

const bot = new TelegramBot({ token, tenantId: "tenant-A" });

// 1. handler 必须异步 + 异步 IO(不要用 fetch sync 包装)
bot.onMessage(async (msg) => {
  // ❌ 错:阻塞
  // const data = fs.readFileSync("big.json");

  // ✅ 对:异步
  const data = await fs.promises.readFile("big.json", "utf-8");
  return { text: data.slice(0, 100) };
});

// 2. 收集 background task
const pending = new Set<Promise<unknown>>();

bot.onMessage((msg) => {
  const task = processAsync(msg).catch(console.error);
  pending.add(task);
  task.finally(() => pending.delete(task));
  return { text: "processing" };
});

// 3. graceful shutdown(配合 systemd / pm2)
process.on("SIGTERM", async () => {
  console.log("🛑 收到 SIGTERM,清理中...");
  await bot.stop();
  await Promise.allSettled(pending);  // 等所有 task
  setTimeout(() => process.exit(0), 5_000);  // 5s 缓冲
});

// 4. 定期 dump 内存(找泄漏源)
setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.heapUsed > 1_000_000_000) {  // 1GB 报警
    console.error("💥 内存超 1GB!", mem);
    if (process.env.NODE_ENV === "production") {
      process.exit(1);  // 触发 systemd 重启
    }
  }
}, 60_000);

// 5. heap snapshot 调试
// node --inspect app.js
// chrome://inspect → Memory → Take Heap Snapshot
```

---

## 性能调优(预留,留给 v1.0.0 实测后)

> 本期(07-03)不写,留给 v1.0.0 实测后补。

- axios 客户端连接池调优(`httpAgent: new https.Agent({ keepAlive: true, maxSockets: 100 })`)
- TLS handshake 复用(`httpAgent.keepAliveTimeout = 60_000`)
- 高并发下 `Promise.all` + `AbortSignal` 限流
- 长 timeout 任务的 streaming(留 v1.2.0)

---

## 链接

- [README.md](./README.md) — 入口
- [API.md](./API.md) — 完整 API 参考
- [QUICKSTART.md](./QUICKSTART.md) — 15 分钟跑通
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更
- [docs/auth.md](./docs/auth.md) — HS256 + JWT 详细
- [docs/retry_circuit.md](./docs/retry_circuit.md) — 重试 + 熔断详细
- [docs/quickstart.md](./docs/quickstart.md) — Bot 5 分钟上手
- [examples/](./examples/) — 7 个 runnable example

---

**维护**:Claude + youhaoxi(Stage 3.2 SDK doc 完整化,2026-07-03)
**WAU 业务代码改动 = 0**(纯文档,不改 .ts)
