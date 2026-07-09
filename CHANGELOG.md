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
