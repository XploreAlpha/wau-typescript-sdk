# wau-typescript-sdk

> **WAU TypeScript SDK v1.0.0 GA** — 官方 TypeScript / JavaScript 客户端,WAU-core-kernel 智能调度内核接入入口
> v0.7.0 "Amber" 🔷 — **v1.0.0 = 2026-06-25 GA**(M3 W6 完成,2026-07-25 W7.7 文档校准)

[![npm](https://badge.fury.io/js/wau-sdk.svg)](https://www.npmjs.com/package/wau-sdk)
[![Version](https://img.shields.io/badge/version-v1.0.0-blue?style=flat-square)](https://www.npmjs.com/package/wau-sdk)
[![TypeScript](https://img.shields.io/badge/typescript-5.4%2B-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## 状态

✅ **v1.0.0 GA** (2026-06-25 → 2026-07-25 W7.7 文档校准) — **Public API stable**

| 阶段 | 估时(plan §5.5) | 实际 | 状态 |
|---|---|---|---|
| W6.5-6 脚手架 (package.json + tsconfig + vitest) | 0.5 d | ~0.2 d | ✅ |
| W6.5-6 翻译 wau-circuit (154 行 Go → ~150 行 TS) | 0.5 d | ~0.2 d | ✅ |
| W6.5-7 Client + 4 服务 + 装饰器链 | 2 d | ~0.3 d | ✅ |
| W6.5-7 测试 (5 场景契约 + 8 服务单测 + 94.98% 覆盖率) | 1 d | ~0.2 d | ✅ |
| W6.5-7 docs + 4 examples | 0.5 d | ~0.1 d | ✅ |
| W7.7 Public API stable + deprecation policy 文档校准 | 0.05 d | ~0.05 d | ✅ |
| tag v1.0.0 + 发 npm | 0.5 d | ⏳ 用户手动(已 tag,发包待你) |

**实际完成 ~1d**(估时 5d,提前 4d)

## 安装

```bash
npm install wau-sdk@1.0.0
# 或
pnpm add wau-sdk@1.0.0
```

## 5 分钟快速开始

```typescript
import { Client, SubmitRequest } from "wau-sdk";

const c = new Client("http://localhost:18400");
const resp = await c.tasks.submit(new SubmitRequest("What is the capital of France?", 30000));
console.log(`✅ ${resp.selectedAgent}: ${resp.response}`);
```

异步 + 关闭:
```typescript
await c.close();
```

## 核心特性

- **11 HTTP 端点 × 2 同步/异步 = 22 方法**(P1 阶段)
- **typed errors**:`APIError` + 5 个 4xx 子类 + `CircuitOpenError` + `MaxRetriesError`
- **重试**:指数退避 + 抖动(自写,无外部依赖),默认 3 次 / 200ms-5s
- **熔断**:集成 wau-circuit(154 行 Go → ~150 行 TypeScript 翻译),3 SDK 行为字节级一致
- **HS256 鉴权**:JWT Bearer(jsonwebtoken),5min exp,UUID v4 jti 防重放
- **gRPC stub**:`IntentService` 4 方法返 `NotImplementedError`(P2 推 M3.1)

## 测试

```bash
# 全部测试(57 passed in ~0.5s)
npx vitest run

# 带覆盖率(94.98%)
npx vitest run --coverage

# 5 场景契约
npx vitest run tests/contract/

# 翻译测试
npx vitest run tests/circuit.test.ts
```

**当前覆盖率: 94.98%**(超过 plan §10.2 80% 门槛 15%)

## 关联仓库

- 上游: [wau-core-kernel](https://github.com/XploreAlpha/WAU-core-kernel) (HTTP :18400)
- 兄弟: [wau-go-sdk](https://github.com/XploreAlpha/wau-go-sdk) | [wau-python-sdk](https://github.com/XploreAlpha/wau-python-sdk)
- 依赖: [wau-circuit](https://github.com/XploreAlpha/wau-circuit) (熔断器,TypeScript 翻译版)
- 共享契约: [wau-go-sdk/tests/contract-golden/](https://github.com/XploreAlpha/wau-go-sdk/tree/main/tests/contract-golden) (5 黄金 JSON)

## 计划文档

- [M3 W6 进度报告](/home/inamoto888/WAU-develop/develop-log/kernel/v0.6.0/2026-06-14-M3-W6.7-10.1-wau-python-sdk-progress.md)
- [M3 计划](/home/inamoto888/.claude/plans/lexical-orbiting-nova.md)
- [wau-go-sdk ADR-0001~0004](https://github.com/XploreAlpha/wau-go-sdk/tree/main/docs/adr)

## v0.9.0 "Acorn" 收口段(2026-09-15 GA)

上文介绍 v0.7.0 计划 + ADR 链接。本段为 v0.9.0 GA 增量补充。

### 角色

| OS 类比 | Client SDK(TypeScript / Node.js,前端入口)|
|---|---|
| 部署 | npm package |
| 通信 | gRPC-web → wau-edge :18401(浏览器) 或 gRPC → wau-llm-router(Node.js)|
| 状态 | v1.1.0 同步发版(2026-07-13)|

### v0.9.0 新增

- **直连 + gRPC-web 双栈**(per [[project-v0-9-0-M3-§3.7-chat-sdk-4langs-2026-06-30]])
- **bot/ 字段 5/5 对齐 4 SDK**(per [[project-v0-9-0-stage0-closure-2026-06-28]])
- **TypeScript strict 类型**:ResolveInput / LLMDecision 完整

### 5 行 TS bot

```typescript
import { Bot } from "wau-typescript-sdk/bot/telegram";

const bot = new Bot({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  tenantId: "acme",
});
bot.start();
```

### v0.9.0 "Acorn" 5 份核心文档

| # | 文件 | 内容 |
|---|---|---|
| 1 | [README.md](README.md)(本文件)| SDK 入口 |
| 2 | [QUICKSTART.md](QUICKSTART.md) | 15 分钟跑通 |
| 3 | [DEPLOY.md](DEPLOY.md) | npm 发布 |
| 4 | [ARCHITECTURE.md](ARCHITECTURE.md) | 模块 + 4 SDK 对齐 |
| 5 | [CHANGELOG.md](CHANGELOG.md) | v0.7.0 + v1.1.0 倒序(27 行已存在)|

### 历史锚点

- v1.1.0 SDK 同步发版(per [[project-v0.8.0-GA-2026-07-13]])

## 协议

MIT © 2026 youhaoxi
## Bot Platforms

WAU SDK 通过两段责任分工对接 N 个 Bot 平台:

| 责任段 | 仓 | 文件 | 覆盖范围 |
|---|---|---|---|
| **公共契约** | 本 SDK(`bot/common/bots_service.<ext>`) | `Bot` + `BotsService` 抽象接口 | 5 SDK 100% 一致(per M10 N1)|
| **C 端 SDK bot/ 子包** | 本 SDK | `bot/{telegram,discord,webhook,slack,feishu,qq,dingtalk,email}/` | 每个 SDK 自带 8 平台(W5 Q1=B 反 W4.1 拍板)|
| **服务端 8 平台 adapter** | `wau-channel` | `internal/adapter/{slack,feishu,dingtalk,qq,email,telegram,discord,webhook}/*_real.go` | 全部 8 平台完整 4 步(per W7 2026-07-07 SDK 接通)|
| **服务端 bot HTTP API** | `wau-edge` | `POST /v1/bots/{bot_id}/messages`(per M10 N3) | Bot → 后端路由 |

**Bot Platforms 公开能力表**(2026-07-13, **W5 update 反 W4.1**):

| Platform     | 本 SDK bot/ | wau-channel adapter | 状态 |
|--------------|-------------|---------------------|------|
| Telegram     | ✅ | ✅ | 双端完整 |
| Discord      | ✅ | ✅ | 双端完整 |
| Webhook      | ✅ | ✅ | 双端完整 |
| Slack        | ✅ Stage 1 native | ✅ 完整 4 步(`@slack/web-api` v7+ + `@slack/socket-mode` v1+) | W6.2 closure: Socket Mode 集成 (~237 LoC) |
| Feishu       | ✅ Stage 1 native | ✅ 完整 4 步(`@larksuiteoapi/node-sdk` v1+ LarkChannel) | W6.2 closure: EventDispatcher 集成 (~223 LoC) |
| QQ           | ✅ Stage 1 native | ✅ 完整 4 步(`axios` + `ws` fallback) | W6.2 closure: 自实现 WSS gateway 4 类 opcode (~468 LoC) |
| DingTalk     | ✅ Stage 1 native | ✅ 完整 4 步(`dingtalk-stream` v2.1.0 DWClient) | W6.2 closure: TOPIC_ROBOT 订阅 + 加签 (~287 LoC) |
| Email        | ✅ Stage 1 native | ✅ 完整 4 步(`imap` v0.8+ + `nodemailer` v6+) | W6.2 closure: IDLE + SMTP 发送 (~472 LoC) |

> **W5 反 W4.1 设计反转**(per 2026-07-13 Q1=B 拍板):SDK 端 bot/ 现已支持 8 平台(原 W4.1 仅 3 平台);5 平台 (Slack/Feishu/QQ/DingTalk/Email) 走 SDK 端 Stage 0 stub 替代原"⛔ 走服务端 adapter"。Stage 1 路径(per M11 W5-W6)将替换 stub 为 native SDK integration。W7 之后 wau-channel 8 平台 adapter 全部完整(per W7 2026-07-07 SDK 接通)。
>
> **W6.2 closure (2026-07-09)**: 5 平台 (Slack/Feishu/QQ/DingTalk/Email) Stage 0 stub → Stage 1 native SDK integration 100% 收口(per M10 N1 + D13 + D78 + D80 公共契约)。

**使用范式**(4 SDK 一致,Go SDK 示例):

```go
// SDK 端(B 端开发者):通过 BotsService 公共契约操作 bot
client.Bots().Register(ctx, wau.RegisterBotRequest{
    TenantID:     "acme",
    Universe:     "default",
    PublicBotID:  "weather-bot",
})

// 平台通信端:平台 SDK 自动选择 — 通过 wau-channel 服务端 adapter 调用
// SDK 不需要直接 import slack/feishu/... — 走 wau-channel HTTP API
```

> **本节由 W4.1 README 标准化自动 append,2026-07-13**。D60 additive:0 改 README 老内容。
>
> 关联:`WAU-develop/develop-log/kernel/v1.0.0/stage2/2026-07-13-PROGRESS-W4-launch.md`
