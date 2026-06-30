# wau-typescript-sdk 架构

## 模块拆分

```
wau-typescript-sdk/
├── src/
│   ├── client.ts               # gRPC + gRPC-web 双栈
│   ├── bot/
│   │   ├── adapter.ts          # BotAdapter interface
│   │   ├── telegram/
│   │   ├── discord/
│   │   └── webhook/
│   └── index.ts
├── examples/bot_webhook.ts     # 5 行 bot
├── tests/
├── package.json
└── README.md / QUICKSTART.md / DEPLOY.md / ARCHITECTURE.md / CHANGELOG.md
```

## 数据流

### Node.js 直连

```typescript
import { Client } from "wau-typescript-sdk/client";

const c = new Client("127.0.0.1:18404");
const resp = await c.resolve({ tenantId: "acme", intent: "chat" });
```

### 浏览器 → wau-edge gRPC-web

```typescript
const c = new Client("https://wau-edge.example.com");
const resp = await c.resolve({ ... });  // gRPC-web over HTTPS
```

## 关键决策

| 决策 | 内容 |
|---|---|
| **gRPC-web 浏览器路径** | per [[project-v0-9-0-M3-§3.7-chat-sdk-4langs-2026-06-30]] |
| **TypeScript strict 完整** | ResolveInput / LLMDecision type 完整 |
| **bot/ 字段 5/5 对齐** | per [[project-v0-9-0-stage0-closure-2026-06-28]] |

## 接口边界

- **入**:B 端 TS / React app
- **出**:Promise<LLMDecision> / bot 启动
- **依赖**:wau-channel / wau-llm-router / wau-edge
- **被依赖**:前端 app

## 性能预算

| 指标 | 目标 |
|---|---|
| Resolve P50 | < 5 ms(局域网)|
| Bot 启动 | < 200 ms |

## 跟其他仓的关系

- **上游**:B 端 TS / React app
- **下游**:wau-channel / wau-llm-router / wau-edge(gRPC-web)
- **同组 SDK(per [[project-v0-9-0-stage0-closure-2026-06-28]])**:wau-go-sdk / wau-python-sdk / wau-rust-sdk
