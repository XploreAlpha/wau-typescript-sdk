# Contributing to wau-sdk

Thanks for your interest in contributing to the official WAU TypeScript SDK.
This document covers the full contributor workflow: setup, testing, linting,
type checking, pull request process, commit message convention, and the version
sync policy with `wau-core-kernel`.

---

## Code of Conduct

By participating in this project, you agree to abide by the
[Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Please report unacceptable behaviour to **howie@xplorealphainc.com**.

Be respectful, assume good faith, and prioritise the project goals over personal
preferences. Disagreements happen — discuss them on the PR, not in commits.

---

## Development Setup

### Prerequisites

- **Node.js ≥ 18** (we test on Node 18, 20, and 22; recommend [nvm](https://github.com/nvm-sh/nvm))
- **npm ≥ 9** (or `pnpm` / `yarn` if you prefer — CI uses npm)
- **TypeScript ≥ 5.4** (pulled in as a devDependency, no global install required)
- A working C compiler for the optional `nock` HTTP mocking native deps (most
  dev machines already have one; on Linux: `apt install build-essential`)

### First-time setup

```bash
git clone https://github.com/xplorealpha/wau-typescript-sdk.git
cd wau-typescript-sdk
npm install
npm run build         # builds dist/ and runs scripts/postbuild.mjs
```

`npm run build` is two steps under the hood:

1. `tsc` — compiles `src/**/*.ts` to `dist/` with declarations + sourcemaps.
2. `scripts/postbuild.mjs` — rewrites every relative import (`./X` or `../X`)
   in `dist/**/*.js` to append `.js`, so Node's strict ESM resolver can find
   the file. Do not skip this step; without it the published package will
   fail with `ERR_MODULE_NOT_FOUND`.

### Verifying your install

```bash
node -e "import('wau-sdk').then(m => console.log(Object.keys(m).length, 'exports'))"
```

You should see a number like `80+` — that's the full public surface.

---

## Running Tests

We use [Vitest](https://vitest.dev/) — same API as Jest, native ESM, faster.

```bash
# Run everything once (~0.5s on a warm cache)
npm test

# Watch mode during development
npm run test:watch

# With coverage report (target ≥ 80% per plan §10.2)
npm run coverage

# A specific test file
npx vitest run tests/agents.test.ts

# The 5 canonical contract scenarios (golden JSON parity with wau-go-sdk)
npx vitest run tests/contract/test_5_scenarios.test.ts
```

Tests are organised as:

- `tests/<service>.test.ts` — unit tests for each sub-client
- `tests/contract/test_5_scenarios.test.ts` — 5 golden contract scenarios
- `tests/bot/<platform>.test.ts` — bot platform integrations
- `tests/ucp/client.test.ts`, `tests/mcp_client.test.ts`, `tests/wau/client.test.ts` — JSON-RPC clients
- `tests/e2e/<platform>.e2e.test.ts` — end-to-end against live `wau-channel` adapters

All new public API must ship with tests. Aim for ≥ 80% coverage on any file
you touch; the project average is ~95%.

---

## Linting

We use [ESLint](https://eslint.org/) (typescript-eslint) + [Prettier](https://prettier.io/).

```bash
# Lint src/ and tests/
npm run lint

# Auto-fix what's safe
npm run lint:fix

# Check formatting
npm run format

# Apply formatting
npm run format:fix
```

Rules of thumb:

- **No `any`** in the public surface. Use `unknown` + type guards, or a proper generic.
- **No `console.log`** in `src/` — use `console.warn`/`console.error` only.
- Prefer named exports over default exports.
- ESM-only — no `require()` in new code.

---

## Type Checking

`tsconfig.json` runs in strict mode (`strict`, `noImplicitAny`, `strictNullChecks`,
`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`). Run:

```bash
npm run typecheck       # tsc --noEmit
```

CI will fail if this step fails, so run it locally before pushing.

---

## Pull Request Process

1. **Fork & branch** off `main`. Branch name format: `feat/<short-desc>`,
   `fix/<short-desc>`, `docs/<short-desc>`, or `chore/<short-desc>`.
2. **One logical change per PR** — multiple unrelated fixes should be split
   into separate PRs. Easier to review, easier to revert.
3. **Update CHANGELOG.md** under an `## [Unreleased]` section following
   the existing format (`### Added` / `### Changed` / `### Fixed` /
   `### Removed`). If your change is user-visible, it gets a CHANGELOG entry.
4. **Run the full gate locally** before requesting review:
   ```bash
   npm run lint && npm run typecheck && npm test
   ```
   All three must pass.
5. **Push & open the PR** against `main`. Fill in the PR template — what,
   why, how to test, screenshot/curl if UI/log changes.
6. **CI must be green** before merge. We run lint + typecheck + tests on
   Node 18, 20, 22 across Linux / macOS / Windows.
7. **Squash-merge** with a Conventional Commit subject (see below). The
   squash commit becomes the canonical history entry.

---

## Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — wrap at 72 chars, explain *why* not *what*

<footer>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`.

**Scopes**: `client`, `tasks`, `agents`, `kernel`, `chat`, `intent`, `handshake`,
`ucp`, `mcp`, `wau`, `bot`, `pkg`, `deps`, `examples`, `tests`.

**Examples**:

```
feat(tasks): add submitAsync() with retry-after-202 response

Returns Promise<SubmitResponse> for fire-and-forget dispatch.
Bumps SubmitResponse to include accepted_at timestamp.

Closes D92.4
```

```
fix(pkg): auto-add .js to relative imports on emit
```

Breaking changes get a `!` after the type/scope and a `BREAKING CHANGE:`
footer:

```
feat(client)!: rename SubmitRequest.timeout to SubmitRequest.timeoutMs

BREAKING CHANGE: SubmitRequest.timeout (ms) → SubmitRequest.timeoutMs.
Same value, clearer name. Coordinate with wau-go-sdk rename.
```

---

## Version Sync Policy

This SDK is **lockstep-versioned** with [wau-core-kernel](https://github.com/xplorealpha/WAU-core-kernel)
and the rest of the WAU 19-repo monorepo. Concretely:

- SDK patch version **must equal** kernel patch version at the moment of release.
- If you change the wire format, change the **kernel first**, then bump the SDK
  in a follow-up commit and tag both together.
- SDK-only changes (e.g. a new `UCPClient` method, a bot platform) can ship as
  an SDK minor bump **without** a kernel release, as long as the wire format
  is unchanged.

Practical checklist when bumping the version:

1. Edit `package.json` → `version`.
2. Add a new `## [X.Y.Z]` section at the top of `CHANGELOG.md`, with
   `### Added` / `### Changed` / `### Fixed` subsections.
3. Confirm `dist/` was rebuilt (`npm run build`) — the `files` field publishes
   pre-built artifacts, not sources.
4. Open a PR titled `chore(pkg): bump to vX.Y.Z — <one-line summary>`.
5. After merge, the maintainer tags `vX.Y.Z` and runs `npm publish`.

Do not bump the version in a feature PR — keep version bumps in their own
dedicated commit so the diff is trivial.

---

## 中文贡献指南

## 行为准则

参与本项目即表示同意遵守
[Contributor Covenant 行为准则 v2.1](https://www.contributor-covenant.org/zh-cn/version/2/1/code_of_conduct/)。
如遇不可接受的行为,请邮件联系 **howie@xplorealphainc.com**。

请保持尊重,假设善意,把项目目标放在个人偏好之上。出现分歧很正常 —— 在 PR 上讨论,而不是在 commit 里争吵。

---

## 开发环境

### 前置依赖

- **Node.js ≥ 18**(我们在 Node 18 / 20 / 22 上测试;推荐 [nvm](https://github.com/nvm-sh/nvm))
- **npm ≥ 9**(或 `pnpm` / `yarn`,但 CI 使用 npm)
- **TypeScript ≥ 5.4**(作为 devDependency 自动安装,无需全局安装)
- C 编译器(用于 `nock` HTTP mock 的原生依赖;Linux 上 `apt install build-essential`)

### 首次设置

```bash
git clone https://github.com/xplorealpha/wau-typescript-sdk.git
cd wau-typescript-sdk
npm install
npm run build         # 编译 dist/ 并执行 scripts/postbuild.mjs
```

`npm run build` 内部两步:

1. `tsc` —— 把 `src/**/*.ts` 编译到 `dist/`,带 declaration + sourcemap。
2. `scripts/postbuild.mjs` —— 把 `dist/**/*.js` 中所有相对导入(`./X` / `../X`)改写为追加 `.js`,以便 Node 严格 ESM 解析器能找到文件。**不要跳过这一步**;否则发布的包会因 `ERR_MODULE_NOT_FOUND` 而失败。

### 验证安装

```bash
node -e "import('wau-sdk').then(m => console.log(Object.keys(m).length, 'exports'))"
```

应该看到 `80+` 这种数量 —— 即完整公开接口大小。

---

## 运行测试

我们使用 [Vitest](https://vitest.dev/) —— 与 Jest 同 API,原生 ESM,更快。

```bash
# 一次性跑全部测试(预热缓存约 0.5 秒)
npm test

# watch 模式(开发用)
npm run test:watch

# 带覆盖率报告(目标 ≥ 80%,按 plan §10.2)
npm run coverage

# 跑单个测试文件
npx vitest run tests/agents.test.ts

# 5 个黄金契约场景(与 wau-go-sdk JSON 字节级对齐)
npx vitest run tests/contract/test_5_scenarios.test.ts
```

测试组织:

- `tests/<service>.test.ts` —— 各子客户端的单元测试
- `tests/contract/test_5_scenarios.test.ts` —— 5 个黄金契约场景
- `tests/bot/<platform>.test.ts` —— bot 平台集成
- `tests/ucp/client.test.ts`、`tests/mcp_client.test.ts`、`tests/wau/client.test.ts` —— JSON-RPC 客户端
- `tests/e2e/<platform>.e2e.test.ts` —— 对真实 `wau-channel` adapter 的端到端测试

所有新公开 API 必须配套测试。你修改的文件,目标覆盖率 ≥ 80%;项目平均约 95%。

---

## Lint

使用 [ESLint](https://eslint.org/)(typescript-eslint)+ [Prettier](https://prettier.io/)。

```bash
# lint src/ 和 tests/
npm run lint

# 自动修复安全项
npm run lint:fix

# 检查格式
npm run format

# 应用格式
npm run format:fix
```

经验法则:
- 公开接口**不允许 `any`**。用 `unknown` + 类型守卫,或正经的泛型。
- `src/` 中**不允许 `console.log`** —— 只用 `console.warn`/`console.error`。
- 优先命名导出,而不是默认导出。
- ESM-only —— 新代码不允许 `require()`。

---

## 类型检查

`tsconfig.json` 走严格模式(`strict`、`noImplicitAny`、`strictNullChecks`、
`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns`、
`noFallthroughCasesInSwitch`)。执行:

```bash
npm run typecheck       # tsc --noEmit
```

CI 会在这一步失败时直接挂掉,所以本地 push 前先跑一遍。

---

## Pull Request 流程

1. **Fork 并从 `main` 拉分支**。分支名格式:`feat/<short-desc>`、
   `fix/<short-desc>`、`docs/<short-desc>`、`chore/<short-desc>`。
2. **一个 PR 一个逻辑变更** —— 不相关的多个修复要拆 PR。方便评审,方便回滚。
3. **更新 CHANGELOG.md** —— 在 `## [Unreleased]` 段落按现有格式(`### Added` /
   `### Changed` / `### Fixed` / `### Removed`)补条目。**用户可见的变更必须**有 CHANGELOG。
4. **本地跑完整 gate 后再请求评审**:
   ```bash
   npm run lint && npm run typecheck && npm test
   ```
   三项必须全部通过。
5. **推送并开 PR**,目标 `main`。填好 PR 模板 —— 改了什么、为什么、怎么测、UI/日志变更截图或 curl。
6. **CI 必须绿**才能合并。我们在 Node 18 / 20 / 22 × Linux / macOS / Windows 上跑 lint + typecheck + test。
7. **Squash 合并**,subject 用 Conventional Commit(见下)。Squash 后的 commit 作为历史规范条目。

---

## Commit Message 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/):

```
<type>(<scope>): <简短摘要>

<body —— 72 字符换行,解释 *为什么* 而不是 *做了什么*

<footer>
```

**type**:`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`perf`、`ci`。

**scope**:`client`、`tasks`、`agents`、`kernel`、`chat`、`intent`、`handshake`、
`ucp`、`mcp`、`wau`、`bot`、`pkg`、`deps`、`examples`、`tests`。

**示例**:

```
feat(tasks): add submitAsync() with retry-after-202 response

Returns Promise<SubmitResponse> for fire-and-forget dispatch.
Bumps SubmitResponse to include accepted_at timestamp.

Closes D92.4
```

```
fix(pkg): auto-add .js to relative imports on emit
```

破坏性变更在 type/scope 后加 `!`,并在 footer 写 `BREAKING CHANGE:`:

```
feat(client)!: rename SubmitRequest.timeout to SubmitRequest.timeoutMs

BREAKING CHANGE: SubmitRequest.timeout (ms) → SubmitRequest.timeoutMs.
Same value, clearer name. Coordinate with wau-go-sdk rename.
```

---

## 版本同步策略

本 SDK 与 [wau-core-kernel](https://github.com/xplorealpha/WAU-core-kernel) 以及
WAU 19 仓联合版本化。具体来说:

- 发布时,SDK 的 patch 版本**必须等于**内核 patch 版本。
- 如果改了 wire format,**先改内核**,然后在后续 commit 里 bump SDK,并把两个仓一起打 tag。
- 纯 SDK 改动(比如新 `UCPClient` 方法、新 bot 平台)可以作为 SDK minor bump **单独发布**,只要 wire format 不变。

版本 bump 实操清单:

1. 编辑 `package.json` → `version`。
2. 在 `CHANGELOG.md` 顶部加一段 `## [X.Y.Z]`,按 `### Added` / `### Changed` / `### Fixed` 子节写。
3. 确认 `dist/` 已经重新构建(`npm run build`)—— `files` 字段发布的是预编译产物,不是源码。
4. 开一个标题为 `chore(pkg): bump to vX.Y.Z — <一句话总结>` 的 PR。
5. 合并后,维护者打 `vX.Y.Z` tag 并执行 `npm publish`。

**不要**在功能 PR 里 bump 版本 —— 版本 bump 单独一个 commit,diff 越简单越好。

---

感谢你的贡献,有问题先开 issue 讨论再发 PR!