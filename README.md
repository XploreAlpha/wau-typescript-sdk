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

## 协议

MIT © 2026 youhaoxi
