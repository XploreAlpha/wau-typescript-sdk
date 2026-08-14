# wau-sdk

> **Official TypeScript / JavaScript SDK for [WAU-core-kernel](https://github.com/xplorealpha/WAU-core-kernel) — AI agent dispatch, gRPC + HTTP, 8 bot platforms, UCP commerce, MCP tooling.**

[English](README.md) | [中文](README.zh-CN.md)

[![npm version](https://badge.fury.io/js/wau-sdk.svg)](https://www.npmjs.com/package/wau-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/wau/wau-typescript-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/wau/wau-typescript-sdk/actions)
[![npm downloads](https://img.shields.io/npm/dm/wau-sdk)](https://www.npmjs.com/package/wau-sdk)

---

## Features

A single typed client that bundles every WAU surface area:

- **Core `Client`** with 6 sub-clients wired through retry + circuit breaker + JWT signer:
  - `client.kernel` — `/healthz`, `/readyz`, kernel info
  - `client.agents` — register, list, score, heartbeat
  - `client.tasks` — submit (sync + async), list, fetch
  - `client.intent` — intent resolution (gRPC stub for v1.4+)
  - `client.handshake` — multi-agent handshake protocol (v0.8.0+)
  - `client.chat` — OpenAI-compatible `/v1/chat/completions` with SSE streaming
- **`UCPClient`** (v1.3.3+) — Universal Commerce Protocol over JSON-RPC 2.0: 11 commerce tools (`listProducts`, `addToCart`, `createCheckoutSession`, Stripe checkout, …) with 8 commerce DTOs byte-equal across all 5 SDKs
- **`MCPClient`** (v1.3.2+) — Model Context Protocol over JSON-RPC 2.0: 8 sync tools (`sendMessage`, `getTask`, `listTasks`, …) + 2 SSE streaming tools (`streamMessage`, `subscribeToTask`)
- **`WauClient`** (v1.3.1+, exported via `wau-sdk/wau` subpath) — workflow submission with 19-field `WauWorkflow` type, JWT 4-claim auth, heartbeat loop
- **Bot platforms** — 8 native SDK integrations under `wau-sdk/bot/`:
  Telegram, Discord, Webhook, Slack (Socket Mode), Feishu (Lark), QQ (WSS), DingTalk (Stream), Email (IMAP + SMTP)
- **Resilience built-in** — exponential backoff with jitter (no external deps), 3 retries by default (200ms → 5s), circuit breaker ported byte-for-byte from `wau-circuit` Go reference
- **Typed errors** — `APIError` + 5 HTTP 4xx subclasses + `CircuitOpenError` + `MaxRetriesError` + MCP / UCP / Wau error families
- **Strict TypeScript** — no `any` in public surface; targets `tsc` strict + ESM-only output (Node 18+)
- **78 source files / ~7.7K LOC**, **24 test files / ~5.2K LOC** with ~95% coverage

---

## Installation

```bash
npm install wau-sdk@^1.3.4
# or
pnpm add wau-sdk@^1.3.4
# or
yarn add wau-sdk@^1.3.4
```

**Requirements**: Node.js ≥ 18, TypeScript ≥ 5.0 (if using TS).

---

## Quickstart

```typescript
import { Client, SubmitRequest } from "wau-sdk";

async function main(): Promise<void> {
  const c = new Client("http://localhost:18400");

  try {
    // Submit a task — kernel picks the best agent and dispatches over A2A
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

ESM-only — use `import { ... } from "wau-sdk"`. The package ships pre-built ESM in `dist/`.

---

## Public API

### Top-level exports

| Symbol | Kind | Description |
|---|---|---|
| `Client` | class | Main HTTP client (orchestrates transport + retry + circuit + signer) |
| `UCPClient` | class | Universal Commerce Protocol client (JSON-RPC 2.0 over HTTP) |
| `MCPClient` | class | Model Context Protocol client (JSON-RPC 2.0 over HTTP, SSE streaming) |
| `WauClient` | class | WAU workflow client (re-exported from `wau-sdk/wau`) |
| `APIError`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `CircuitOpenError`, `MaxRetriesError`, `NotImplementedError`, `WauError` | classes | Typed error hierarchy |
| `Breaker`, `CircuitState`, `Retrier`, `Signer`, `Transport` | classes | Building blocks (advanced) |
| `DEFAULT_CIRCUIT_CONFIG`, `DEFAULT_RETRY_CONFIG`, `Role` | const/enum | Default config + agent roles |

### Sub-clients (via `client.<service>`)

| Service | Methods (sync / async) | Notes |
|---|---|---|
| `client.kernel` | `healthz()`, `readyz()`, `info()` | Liveness/readiness + kernel metadata |
| `client.agents` | `register()`, `list()`, `score()`, `heartbeat()` | Agent registry + scoring |
| `client.tasks` | `submit()`, `submitAsync()`, `list()`, `fetch()` | L4 dispatch (sync + async) |
| `client.intent` | `resolve()` *(stub)* | Returns `NotImplementedError` until v1.4 |
| `client.handshake` | `start()`, `accept()`, `reject()`, `list()` | Multi-agent handshake (v0.8.0+) |
| `client.chat` | `complete()`, `stream()` | OpenAI-compatible chat (SSE) |

---

## Sub-modules

The package exposes two subpath imports:

```jsonc
// package.json (excerpt)
"exports": {
  ".":        { "import": "./dist/index.js",        "types": "./dist/index.d.ts" },
  "./wau":    { "import": "./dist/wau/index.js",    "types": "./dist/wau/index.d.ts" }
}
```

- **`wau-sdk`** (default) — `Client` + all 6 sub-clients + UCP + MCP + errors + types.
- **`wau-sdk/wau`** — `WauClient` only (workflow submission). Use when you only need workflow dispatch and want a smaller import graph:

```typescript
import { WauClient, WauWorkflow } from "wau-sdk/wau";

const wau = new WauClient({
  baseURL: "https://kernel.example.com",
  tenantId: "acme",
});

const wf: WauWorkflow = {
  workflow_type: "research",
  requester_agent_id: "orchestrator-01",
  // ...19 fields total
};

const { workflow_id } = await wau.submit(wf);
```

---

## Examples

Five runnable examples ship under `examples/`. Each has its own `main.ts` you can run with `npx tsx`:

| Example | Path | What it shows |
|---|---|---|
| **`chat_stream`** | [`examples/chat_stream/main.ts`](examples/chat_stream/main.ts) | OpenAI-compatible SSE chat completion with chunk delta accumulation |
| **`five_scenarios`** | [`examples/five_scenarios/main.ts`](examples/five_scenarios/main.ts) | The 5 canonical contract scenarios (golden JSON parity with `wau-go-sdk`) |
| **`heartbeat_loop`** | [`examples/heartbeat_loop/main.ts`](examples/heartbeat_loop/main.ts) | Agent heartbeat keep-alive loop |
| **`list_agents`** | [`examples/list_agents/main.ts`](examples/list_agents/main.ts) | `client.agents.list()` + pagination |
| **`submit_task`** | [`examples/submit_task/main.ts`](examples/submit_task/main.ts) | The canonical `client.tasks.submit()` end-to-end call |

Run any of them:

```bash
cd examples/submit_task
npx tsx main.ts "What is the capital of France?"
```

---

## Documentation

- **[API.md](API.md)** — full generated API doc for every exported symbol (33 KB)
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — module layout, data flow, gRPC-web vs Node.js direct, key design decisions
- **[QUICKSTART.md](QUICKSTART.md)** — 15-minute runbook for new users
- **[DEPLOY.md](DEPLOY.md)** — npm publish workflow + CI/CD
- **[RELEASING.md](RELEASING.md)** — release checklist (7 sections)
- **[FAQ.md](FAQ.md)** — frequently asked questions (16 KB)
- **[CHANGELOG.md](CHANGELOG.md)** — full version history
- **[wau-protocol-spec](https://github.com/youhaoxi/WAU-protocol-spec)** — wire format reference (canonical)
- **[wau-go-sdk](https://github.com/xplorealpha/wau-go-sdk)** — sibling Go SDK (golden contract source)

---

## Versioning

This SDK is **lockstep-versioned** with the WAU 19-repo monorepo. The current
package version (`1.3.4`) matches the corresponding kernel version exactly — if
your kernel is on `v1.3.x`, pin to `wau-sdk@^1.3.4`.

We follow [Semantic Versioning](https://semver.org/):

- **Patch** (`1.3.4` → `1.3.5`) — bug fixes, ESM/postbuild tweaks, additive error fields. Always safe to upgrade.
- **Minor** (`1.3.x` → `1.4.0`) — new sub-client or method, new bot platform, non-breaking type additions. Deprecations announced 1 minor ahead.
- **Major** (`1.x.y` → `2.0.0`) — breaking changes to public API surface. Reserved for the rare cases when the wire format itself changes.

> **Deprecation policy**: methods are marked `@deprecated` one minor release
> before removal. No public method has been removed since `v1.0.0`.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
for development setup, test/lint workflow, commit message convention, and the
version sync policy with `wau-core-kernel`.

---

## License

[MIT](LICENSE) © 2026 youhaoxi

Official SDK for the [WAU-core-kernel](https://github.com/xplorealpha/WAU-core-kernel) AI agent dispatch kernel. Lockstep with kernel `v1.3.4`.