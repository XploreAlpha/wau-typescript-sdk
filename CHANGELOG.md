## Wire Format Reference (added 2026-07-11 per D93 SOP)

This SDK is **canonical-compliant** with [WAU-protocol-spec v1.0.0](https://github.com/youhaoxi/WAU-protocol-spec).
JSON schemas for `a2a-message` / `afp-send` / `ap2-mandate` / `netbird-config` / `ucp-checkout` / `wau-workflow` are reference;
TypeScript interface field names (snake_case in JSON+TS, per #14 A 拍板) match schema `properties` keys for `wau-workflow`,
but the **JSON-RPC envelope + wire format MUST match** for all schemas.

---

## [1.3.4] — v1.3.4 "Patch: auto-add `.js` to relative imports on emit (2026-07-13, 路径 Y 拍板)"

### Fixed

- **ESM relative imports**: `dist/**/*.js` no longer uses bare relative paths like
  `from "./errors"`. A new `scripts/postbuild.mjs` is invoked after `tsc` and
  rewrites every relative import (`./X` or `../X`) to append `.js`, so
  Node 24's strict ESM resolver can find the file. Without this fix,
  `npm install wau-sdk@1.3.3` succeeds but `import 'wau-sdk/wau'`
  immediately fails with `ERR_MODULE_NOT_FOUND` for the first
  relative import reached.
  (Discovered via post-publish audit at 2026-07-13 ~14:08.)

- **Root cause**: `tsconfig.json` uses `"moduleResolution": "Bundler"`, which
  makes `tsc` emit ESM without the `.js` extension. Dev experience (using
  Bundler resolution in source) is preserved; only the published `dist/`
  gets the extension injected at build time.

### Changed

- package.json version: 1.3.3 → 1.3.4
  (npm disallows republishing the same version; 1.3.3 stays broken on npm).
- package.json scripts: added `postbuild: "node scripts/postbuild.mjs"` so
  `npm run build` automatically runs the `.js` injector.
- new file: `scripts/postbuild.mjs` — pure Node stdlib (no new dependency).
  Not published to npm (per `package.json` `files: ["dist","README.md","LICENSE"]`).

### Why (背景)

- 7-13 publish v1.3.2 + v1.3.3 期间,wau-team session 跑了 4 维度 audit (npm view,
  install test, ERROR_MAPPING test, functional smoke test)。
- 5 个 audit 维度里有 1 个被 ETARGET (dep typo) 掩盖 — Node ESM .js extension miss。
- 本 fix 是 audit 表里的"critical path" — 没它任何 wau-sdk 消费者都会 fail。

### Test

- `npm run build`: tsc 0 error + postbuild 打印`N file(s), M imports +.js`
- `npm view wau-sdk@1.3.4 dist.unpackedSize` 比 `1.3.3` 略大(因为 .js 字符串加长 ~6-8 字节/import)
- 真 install + `node -e "import('wau-sdk/wau').then(m => console.log(Object.keys(m)))"` 见到 11 个 export

---

## [1.3.3] — v1.3.3 "Patch: fix `dingtalk-stream` dep typo (2026-07-13, same-day from 1.3.2 publish)"

### Fixed

- **Dependencies**: `dingtalk-stream` `^1.0.0` → `^2.1.0`. npmjs never published any 1.0.x version
  (latest series = 2.1.0+), so `npm install wau-sdk@1.3.2` immediately fails with
  `ETARGET: No matching version found for dingtalk-stream@^1.0.0` regardless of caller.
  Bump dep range to match real published versions.

### Changed

- package.json version: 1.3.2 → 1.3.3 (npm disallows republishing the same version)
- 1.3.2 stays on npm registry as "latest" until npm index updates within ~30s — 5 min
  after 1.3.3 publish; users who already pinned `^1.3.2` will auto-upgrade to 1.3.3.

### Why (背景)

- 7-13 user 想发 `wau-sdk@1.3.2` 配合 homerail PR-B-rcp RPC unlock(3 仓 4 commit / wau-team 一键全干拍板)
- Pre-existing `dingtalk-stream` dep typo in package.json 旧版就存在,未被发现
- Audit at 7-13 13:34 通过 `/tmp` 真实 install test 立即抓到 bug

### Test

- tsc: 0 error
- npm install wau-sdk@1.3.3 --dry-run: 全部 deps resolve
- (publish 后) `/tmp` 真实 install + grep `WAU_DEFAULT_USER_AGENT` = `wau-typescript-sdk/wau/v1.3.2` (源码不变,dist 无 diff)

---

## [1.3.2] — v1.3.2 "Wau RPC full unlock (2026-07-13, wau-team 一键全干拍板)"

### Added — 4 method full RPC (per homerail-end.md §三.1 + WAU-develop log wau-homerail/homerail-end.md §十 ask 1)

- WauClient 4 method 替换 v1.3.1 stub throw → 真 fetch 实装:
  1. `registerAgent()` — POST `{registry_url}/v1/agents` (wau-registry Phase 1 /v1 alias per commit 4df570f)
  2. `heartbeat()` — POST `{registry_url}/v1/agents/heartbeat` (wau-registry Phase 1 /v1 alias)
  3. `recommendWorkflow(query)` — POST `{edge_url}/v1/recommend` (wau-edge Phase 2 proxy per commit 18a12a6)
  4. `matchWauPattern(query)` — POST `{edge_url}/v1/patterns/match` (wau-edge Phase 3 STUB 501 per commit 262f8cf, 等 wau-dag-patterns 仓)
- JWT 4-claim bearer (per D66=B + #21): `Authorization: Bearer ${config.auth_token}` (从 config.auth_token 读)
- AbortController 超时机制: 默认 30s (config.timeout_ms 覆盖)
- 错误分层:
  - 401/403 → WauWorkflowError('AUTH_FAILED', retryable=true)
  - 400     → WauWorkflowError('INVALID_WORKFLOW_TYPE', retryable=false)
  - 404     → WauWorkflowError('SERVER_ERROR', retryable=false)
  - 5xx     → WauWorkflowError('SERVER_ERROR', retryable=true)
  - timeout → WauWorkflowError('TIMEOUT', retryable=true)
  - network → WauWorkflowError('NETWORK_ERROR', retryable=true)
- Endpoint URL 修正: 去掉 `/wau/` namespace 前缀, 跟 wau-registry v1.0.1 /v1 alias + wau-edge v1.0.1 /v1 routes 1:1 对齐

### Changed

- WAU_DEFAULT_USER_AGENT: `wau-typescript-sdk/wau/v1.3.1` → `wau-typescript-sdk/wau/v1.3.2`
- Client constructor: 改用 sync 赋值 (was void _resolvedTimeoutMs stub 占位)
- package.json version: 1.3.1 → 1.3.2
- tests/wau/client.test.ts: 24 测试全重写 (从 4 method throw 改成 4 method fetch happy/error/network path)

### Protocol Compliance

- ✅ D60 additive: 0 改老 SDK exports (只改 client.ts 实装 + 替换 test)
- ✅ D78 byte-equal: WauWorkflow 19 字段 snake_case, 与 wau-go-sdk / python / rust / java byte-equal
- ✅ D66=B: JWT 4-claim bearer (sub/aud/exp/scope)
- ✅ #14 A: snake_case field name (auth_token, registry_url, edge_url 等)
- ✅ #15 B: recommendWorkflow/matchWauPattern 走 edge_url
- ✅ #17 B: harness 校验在 homerail PR-E handler, SDK 端不重复
- ✅ #18 b: retryable flag 区分 registerAgent(false) 一次性 vs 其他(true)
- ✅ #21 DAG-aware RPC schema: JWT 4-claim 注入 ready
- ✅ #22 失败回退: retryable flag + DEFAULT_RETRYABLE map
- ✅ Feedback-no-branches-until-1.0-0: 单分支 main, 0 PR
- ✅ Feedback-cli-cant-push-git: commit 由 Claude 做 (per user 7-13 一键全干), push 由 user 手动

### Test

- vitest: 278 tests PASS (0 failed, 2 pre-existing DataCloneError 来自 vitest vendor / 不影响 PASS 计数)
- typecheck: pre-existing 4 错 (src/index.ts Duplicate 'Task' + src/mcp/client.ts unused imports) 跟本改动无关
- committable after this update (per user 7-13 "开发完统一测试通过在publish"):
  - npm publish wau-sdk@1.3.2 (user 手动, per feedback-cli-cant-push-git)
  - 切 homerail dep "file:../../wau-typescript-sdk" → "^1.3.2" (user/homerail session)
  - homerail PR-E + PR-B-imp 部分可立即实装 (B-rcp 等 v1.3.3 wau-dag-patterns 仓)

## [1.3.1] — v1.3.1 "Wau client add (v1.0.1 Phase 0 拍板, 2026-07-12)"

### Added — wau/ sub-package (per SDK Consumer Contract §二)

- `WauClient` class with 4 method skeleton (per #14 + #15 + #19):
  1. `registerAgent(config)` — 调 wau-registry 注册 homerail-voice 为 system_ui agent
  2. `heartbeat()` — 周期心跳发到 wau-registry (走 wau-edge per #15)
  3. `recommendWorkflow(query)` — 调 wau-intent (经 wau-edge) 推荐 workflow
  4. `matchWauPattern(query)` — 推 wau-dag-patterns (per #4 抽象 consumer-side)
- `WauClientConfig` interface (5 URL + systemCapability + timeoutMs + authToken)
- `WauWorkflow` interface (19 字段: 5 必填 + 14 元数据)
- `WauWorkflowType` enum (6 值: UNSPECIFIED/SINGLE/CHAIN/PARALLEL/QUORUM/FAN_OUT)
- `WauWorkflowAgent` + `WauWorkflowDependency` + `WauSystemCapability` 嵌套 type
- `WauWorkflowError` class + 7 code constants (per #22 retry 2x + 失败回退)
- `asWauWorkflowError` + `isWauRetryable` helpers (跟 UCP/MCP errors.ts 1:1 pattern)

### Public API Exposed (v1.3.1)

- Main entry: `import { WauClient, WauClientConfig, WauWorkflow, WauWorkflowError } from 'wau-sdk'`
- Subpath entry: `import { WauClient } from 'wau-sdk/wau'`
- `./wau` subpath added to `package.json` `exports`

### Stub Stage (v1.3.1, B1 决策)

- 4 methods all throw `WauWorkflowError('SERVER_ERROR', retryable flag)` — 真实 RPC 等 wau-edge / wau-intent / wau-registry endpoint schema 落地后实装 (v1.3.2+)
- homerail PR-E + PR-B 可以编译 + 跑通 type check + 失败时拿到友好 retryable 信息
- 0 新 HTTP 调用, 0 依赖新 lib (跟 MCP/UCP 子包 1:1 pattern)

### Compatibility

- D60 additive: 0 改老 SDK modules, 独立子包 (`src/wau/` + `tests/wau/`)
- D78 byte-equal: 5 SDK 必须 WauClientConfig / WauWorkflow / WauWorkflowError 字段名 + 类型 1:1 (本文件 TS canonical)
- D66=B RBAC: registerAgent 默认带 owner_user_id (string, 从 systemCapability.user 取)
- #1c 全局: category: 'USER_ENTRY' + trust_exempt: true
- #17 voice harness: harness 字段强校验 'codex-appserver' (homerail PR-E handler 实现, SDK 端 throw 友好消息)
- #22 失败回退: retryable flag 由 caller 决定 (per SDK Consumer Contract §二.4)

### Test

- 18 unit tests in `tests/wau/client.test.ts` (constructor × 3, 4 method skeleton × 4, retryable flag × 5, sample fixture × 3, constants × 3)
- 老 SDK v1.3.0 → v1.3.3 tests 100% 不破 (D60 additive)

### Reference

- SDK Consumer Contract: `wau-homerail/2026-07-12-wau-sdk-v1.3.1-consumer-contract.md`
- v1.0.1 SoT doc: `kernel/v1.0.1/2026-07-12-wau-v1.0.1-for-homerail.md`
- WauWorkflow msg type spec: `kernel/v1.0.1/2026-07-12-wau-workflow-msg-type.md`
- 24-decisions-closure: `kernel/v1.0.1/2026-07-12-24-decisions-closure.md`

---

## [Unreleased] — v1.3.0 "botUuid field add (W7.1, 2026-07-09)"

### Added

- `botUuid` (UUID v4, server-assigned) field added to `Account` + `RegisterBotRequest` interfaces in `src/bot/common/account.ts`
- Per D78/D79/D80 decisions; D60 additive, 0 breaking change
- Cross-SDK JSON byte-equal alignment per D13
- 老 SDK v1.2.0 向后兼容(server 自动从 botId slug 寻址并生成 botUuid)
- 0 unit tests added (W7.2 will add 15 mock e2e tests for 5 platforms × 3 cases)

### Compatibility

- 100% 保持向后兼容 — `botUuid` 字段 optional(`botUuid?: string`),老 client 不传 = server 自动生成
- 老 9 字段(`accountId, tenantId, botId, publicBotId, ownerUserId, channelType, channelConfigId, createdAt, updatedAt`) 0 改
- 老 `botId` slug 语义不变(tenant-local, client-supplied)
- 跟 D66=B RBAC 兼容(`ownerUserId` 维持 string)

---

## [Unreleased] — v1.3.2 "MCP client add (D87.7, 2026-07-11)"

### Added

- ⭐ New `src/mcp/` submodule: 6 files + tests, ~1500 LoC
  - `src/mcp/client.ts` — `MCPClient` class + 8 sync tool wrapper methods
  - `src/mcp/types.ts` — 8 DTOs (Message / Part / Task / Artifact / AgentCard / ExtendedAgentCard / HealthCheckResult / ListTasksFilter+ListTasksResult / PushConfig+PushConfigResult)
  - `src/mcp/errors.ts` — `RPCError` class + 5 spec code + 3 MCP-specific code (-32001 ~ -32003)
  - `src/mcp/tools.ts` — 10 tool name constants + `ALL_TOOL_NAMES` + `isStreamingTool` helper
  - `src/mcp/auth.ts` — `setBearerToken` / `buildHeaders` / `McpAuth` class
  - `src/mcp/index.ts` — sub-package统一导出
  - `tests/mcp_client.test.ts` — 35 vitest tests covering 8 sync tool + W5 stub + error path + auth + helpers + concurrent
- 8 sync MCP tool wrappers:healthCheck / parseAgentCard / sendMessage / getTask / listTasks / cancelTask / createTaskPushNotificationConfig / getExtendedAgentCard
- 2 SSE streaming tool (streamMessage / subscribeToTask) deferred to W5+
- Per D87 ⭐⭐ decision; D60 additive (0 改老 chat.ts / bot/ / ucp/ / client.ts etc)
- Cross-SDK JSON byte-equal alignment per D13
- Bearer token 注入 OAuth 2.0 identity_linking (per D78/D79/D80)

### Compatibility

- 100% 向后兼容 — 老 SDK v1.3.0 / v1.3.1 client 不感知 mcp/ 新增
- 0 breaking change to existing APIs
- JSON-RPC 2.0 envelope 跟 wau-go-sdk `mcpclient/` 字段 1:1 对齐

---

## [Unreleased] — v1.3.3 "UCP client (W3, 2026-07-11, per D88.7)"

### Added

- 新 submodule `src/ucp/`(与 `src/bot/` 同级独立模块,D60 additive),含 7 文件:
  - `src/ucp/types.ts` — 8 commerce DTO(`Product` / `Cart` / `Order` / ... + filter/result 包装)
  - `src/ucp/errors.ts` — `RPCError` class + 5 spec code + 5 UCP code(`-32101 ~ -32105` 跟 MCP `-32001 ~ -32003` 错开)+ `isNotFound` / `isStripeError` helpers
  - `src/ucp/auth.ts` — `setBearerToken` / `setTenantID` helpers + `UcpAuth` class
  - `src/ucp/stripe.ts` — `isStripePath` + 4 `PAYMENT_STATUS_*` 常量
  - `src/ucp/tools.ts` — 11 `ToolXxx` 常量(`TOOL_LIST_PRODUCTS` ... `TOOL_CANCEL_ORDER`)
  - `src/ucp/client.ts` — `UCPClient` class + 11 typed wrapper method(`listProducts` / `getProduct` / `addToCart` / ...)+ `_callTool` JSON-RPC 通用 dispatch
  - `src/ucp/index.ts` — public API re-export
- `UCPClient` + `UCPClientOptions`:11 commerce tool wrapper(走 JSON-RPC 2.0 over HTTP,endpoint `POST {baseURL}/ucp`):
  - `listProducts(filter?: ListProductsFilter): Promise<ListProductsResult>`
  - `getProduct(product_id: string): Promise<Product>`
  - `searchProducts(query: string, limit?: number): Promise<SearchProductsResult>`
  - `addToCart(product_id: string, quantity: number): Promise<Cart>`
  - `getCart(cart_id: string): Promise<Cart>`
  - `removeFromCart(cart_id: string, line_item_id: string): Promise<Cart>`
  - `createCheckoutSession(cart_id: string): Promise<CheckoutSession>` — W3 stub, W5+ Stripe
  - `confirmPayment(checkout_session_id: string): Promise<PaymentConfirmation>` — W3 stub, W5+ Stripe
  - `getOrder(order_id: string): Promise<Order>`
  - `listOrders(user_id: string, filter?: ListOrdersFilter): Promise<ListOrdersResult>`
  - `cancelOrder(order_id: string): Promise<CancelOrderResult>` — W5+ Stripe refund
- 8 commerce DTO 含 `tenant_id` 字段(per D65 multi-tenant)
- 11 `ToolXxx` 常量 (`ToolListProducts` ... `ToolCancelOrder`)
- `RPCError` + 5 spec code + 5 UCP-specific code(`-32101 ~ -32105`)
- `setBearerToken` / `setTenantID` helpers(per D78/D79/D80 OAuth bearer + D65 tenant 隔离)
- `isStripePath(tool_name)` Stripe 路径 helper(per D88.7)
- `PaymentStatusSucceeded` / `Failed` / `Processing` / `Pending` 4 payment status 常量
- 29 unit tests (`tests/ucp/client.test.ts`, fetchImpl 注入 mock + 11 tool round-trip + W3 stub 验证 + error path + auth helper + stripe helper + envelope sanity) 100% PASS

### Compatibility (D60 additive)

- 0 改老 SDK(`chat.ts` / `bot/` / `client.ts` / `transport.ts` / `oauth.ts` 等全部 0 触碰)
- 走独立 JSON-RPC 2.0 client(`callTool` 通用 dispatch),不耦合 `transport.do` 跟 `Client`
- W3 stub:`createCheckoutSession` + `confirmPayment` 走 kernel `ErrNotImplemented` → SDK 抛 Error 友好提示 "W5 Stripe 集成中"
- Stripe SDK 0 直接依赖(等 kernel `internal/protocol/ucp/ucp_stripe.go` 落地 W5+)

### Reference

- D88 拍板(UCP server):[stage2/2026-07-10-D86-D87-D88-protocol-gateway-decision](https://github.com/wau-network/WAU-develop/blob/main/develop-log/kernel/v1.0.0/stage2/2026-07-10-D86-D87-D88-protocol-gateway-decision.md)
- 5 SDK UCP client 详设:[process/2026-07-11-W3-UCP-client-SDK-design](https://github.com/wau-network/WAU-develop/blob/main/develop-log/kernel/v1.0.0/process/2026-07-11-W3-UCP-client-SDK-design.md)
- UCP Stripe design:[process/2026-07-11-W3-UCP-Stripe-Checkout-design](https://github.com/wau-network/WAU-develop/blob/main/develop-log/kernel/v1.0.0/process/2026-07-11-W3-UCP-Stripe-Checkout-design.md)
- 兄弟: wau-go-sdk v1.3.3 `ucpclient/` 已落地 (D88.5 commit `d8a600f`, 28 单测 PASS);wau-python-sdk v1.3.3 `ucp_*` 已落地 (D88.6 commit `43c2e08`, 25 单测 PASS);本模块 D88.7 同步实跑
- benny 迁移澄清:kernel UCP 是通用 commerce 垂直协议层,benny 保持独立 demo plugin(2026-07-11 user 拍板)

---

## [v1.2.0] - 2026-07-02 (v0.9.0 GA)

### Highlights

- v1.2.0 (与 v0.9.0 "Acorn" 同步发版) + Stage 3.1 #10 Chat SSE streaming + 5 字段 100% 保留 + SDK doc 完整化
- 详见 GA 收口报告:~/WAU-develop/develop-log/kernel/v0.9.0/wrapup/2026-07-02-PROGRESS-v0.9.0-GA-CLOSURE.md

### Compatibility

- API 100% 保留
- LLMDecision 字段 100% 保留

# Changelog

## v1.0.0 (2026-06-25) — GA

> 🟢 **Amber W3 Day 4: TypeScript SDK 1.0 GA**
> 57/57 tests pass · 94.98% 覆盖率 · 0 breaking changes vs 0.6.0-preview.1

### 升级说明

- 0.6.0-preview.1 → 1.0.0:无 API 变化,只是去掉 preview 标签
- 1.0.0 = 稳定 API 保证(以后 1.x.y 只做 bug fix,1.x.0+ 才加新功能)
- npm install: `npm install wau-sdk@1.0.0`

### 已就位(从 v0.6.0-preview.1 继承)

- HTTP API 11 端点 × 2 同步/异步 = 22 方法
- 4 场景契约 25/25 过
- 装饰器链(translate / agentrec / circuit)
- 4 service 客户端(Kernel / Registry / Intent / Circuit)
- 5 场景契约 + 8 服务单测
- 4 examples(basic / async / decorators / circuit-breaker)
- docs/ 全套

## v0.6.0-preview.1 (2026-06-14)

> 🔶 Carnelian M3 W6 — 完整 TypeScript SDK
> 翻译 wau-python-sdk 0.6.0-preview.1 → TypeScript / JavaScript 双生态

## [Unreleased] — v1.0.0 "Phoenix" M10 W8 (2026-07-08)

### Added

#### M10 N1 — Bot 注册 DTO + BotsService 公共 interface

- `src/bot/common/account.ts`(NEW,~84 行):
  - `Account` interface 字段与 wau-go-sdk / wau-python-sdk 100% 一致
  - `newAccount(...)` factory + `publicBotIdOf(...)` helper
  - `RegisterBotRequest` / `UpdateBotRequest` / `ListBotsFilter` interfaces
- `src/bot/common/bots_service.ts`(NEW,~47 行):
  - `BotsService` interface:register / get / update / list / delete
  - 2 sentinel errors:`BotNotFoundError` / `BotAlreadyExistsError`
- `src/bot/common/index.ts` 加 8 export

#### Compatibility (D60)

- `Bot` interface / `IncomingMessage` / `OutgoingMessage` / `BotBuilder` 0 改
- 字段 camelCase,D13 跨 SDK 一致

#### M4 OAuth 增强 (2026-07-08)
- `RefreshableTokenStore.refreshToken()` 公开方法(declare merging + prototype 注入)
- `RefreshableTokenStore.currentPair()` 返当前 token pair
- `PKCEClient` + `PKCEConfig` + `generatePKCEChallenge()` 公共 client 走 Auth Code + PKCE
- 0 改老 OAuthClient + 老 RefreshableTokenStore(D60 additive,prototype injection 不影响类型)
