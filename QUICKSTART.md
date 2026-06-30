# wau-typescript-sdk 15 分钟跑通

> 目标:npm install + 跑通 1 个 webhook bot。

## 前置

- Node.js 18+
- 上游:wau-llm-router :18404 / wau-channel webhook :18431
- Telegram token:`$TELEGRAM_BOT_TOKEN`

## 步骤

### 1. 装 SDK

```bash
npm install wau-typescript-sdk@1.1.0
# 或 yarn / pnpm
```

### 2. 5 行 bot

```typescript
// mybot.ts
import { Bot } from "wau-typescript-sdk/bot/telegram";

const bot = new Bot({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  tenantId: "acme",
});
bot.start();
```

### 3. 跑

```bash
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN npx ts-node mybot.ts
```

预期:`[telegram-bot] listening, tenant=acme`

## 直连模式(浏览器)

```typescript
import { Client } from "wau-typescript-sdk/client";

const c = new Client("https://wau-edge.example.com");  // gRPC-web
const resp = await c.resolve({ tenantId: "acme", intent: "chat" });
```

## 下一步

- [DEPLOY.md](DEPLOY.md) — npm publish
- [ARCHITECTURE.md](ARCHITECTURE.md) — gRPC-web + bot/ 对齐
- [README.md](README.md) — v0.9.0 收口段
