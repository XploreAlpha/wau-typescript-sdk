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
