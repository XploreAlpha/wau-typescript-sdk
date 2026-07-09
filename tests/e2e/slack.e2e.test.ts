/**
 * W7.2 e2e — SlackBot postMessage mock e2e (D60 additive, 2026-07-09)
 *
 * 3 cases 镜像 wau-channel/internal/adapter/slack/slack_real_test.go:
 *   1. success: nock 拦截 POST https://slack.com/api/chat.postMessage → 200 {ok:true, ts}
 *   2. APIErr:  nock 拦截 → 200 {ok:false, error:'channel_not_found'} (Slack 语义)
 *   3. auth_fail: nock 拦截 → 200 {ok:false, error:'invalid_auth'} (Slack auth 语义)
 *
 * 关键设计:
 *   - 跳过 start() 的 WS 握手(Socket Mode 长连接),直接注入 webClient 字段
 *     (TypeScript private 仅编译期,RUNTIME 仍可写),避免真连 wss://app.slack.com
 *   - nock.disableNetConnect() 防止 axios 漏到真网络
 *   - Slack WebClient 内置 retries(默认 10 retries / 30 min backoff),把 retryConfig 改成 0 retries
 *     避免 error case 等 30 分钟
 *   - Slack chat.postMessage 用 application/x-www-form-urlencoded(body 是 querystring)
 *   - 用 nock body matcher 回调捕获 body(per chat.test.ts 既有 pattern)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { WebClient } from "@slack/web-api";
import { SlackBot } from "../../src/bot/slack/slack";
import { newBuilder } from "../../src/bot/common";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
});

/**
 * 构造 SlackBot 并注入 webClient(skip start() 的 WS 握手,避免连 wss://app.slack.com)。
 * 同时把 WebClient 的 retryConfig 改成 0 retries,避免 30-min backoff 阻塞测试。
 */
function makeSlackBot(botToken = "xoxb-test-fake", appToken = "xapp-test-fake"): SlackBot {
  const bot = new SlackBot(botToken, appToken, newBuilder());
  // 注入一个关闭 retries 的 WebClient(0 retries 让 error case 立即抛出)
  const webClient = new WebClient(botToken, {
    retryConfig: 0,
    timeout: 2_000,
  } as ConstructorParameters<typeof WebClient>[1]);
  (bot as any).webClient = webClient;
  return bot;
}

describe("slack e2e (D60)", () => {
  // -------- Case 1: success --------
  it("slack success", async () => {
    let capturedBody: unknown = null;
    let requestCount = 0;
    const scope = nock("https://slack.com")
      .post("/api/chat.postMessage", (body) => {
        requestCount++;
        capturedBody = body;
        return true;
      })
      .reply(200, {
        ok: true,
        channel: "C-CHAN-001",
        ts: "1700000001.000100",
        message: { text: "hello slack" },
      });

    const bot = makeSlackBot();
    const ts = await bot.postMessage("C-CHAN-001", "hello slack");

    expect(ts).toBe("1700000001.000100");
    expect(scope.isDone()).toBe(true);
    expect(requestCount).toBe(1);
    // 验证 request body 包含 channel + text(nock body matcher 收到的 body 是 parsed object
    // 或 querystring,做归一化)
    const bodyStr =
      typeof capturedBody === "string"
        ? capturedBody
        : new URLSearchParams(capturedBody as Record<string, string>).toString();
    expect(bodyStr).toMatch(/channel=C-CHAN-001/);
    expect(bodyStr).toMatch(/text=hello(\+|%20)slack/);
  });

  // -------- Case 2: APIErr --------
  it("slack APIErr", async () => {
    let requestCount = 0;
    const scope = nock("https://slack.com")
      .post("/api/chat.postMessage", () => {
        requestCount++;
        return true;
      })
      .reply(200, {
        ok: false,
        error: "channel_not_found",
      });

    const bot = makeSlackBot();
    let caught: Error | null = null;
    try {
      await bot.postMessage("C-BAD", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/channel_not_found|chat\.postMessage/);
    expect(scope.isDone()).toBe(true);
    // 验证 no retry — 只发了一次请求(0 retries 下)
    expect(requestCount).toBe(1);
  });

  // -------- Case 3: auth_fail --------
  it("slack auth_fail", async () => {
    let requestCount = 0;
    const scope = nock("https://slack.com")
      .post("/api/chat.postMessage", () => {
        requestCount++;
        return true;
      })
      .reply(200, {
        ok: false,
        error: "invalid_auth",
      });

    const bot = makeSlackBot();
    let caught: Error | null = null;
    try {
      await bot.postMessage("C-CHAN", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/invalid_auth/);
    expect(scope.isDone()).toBe(true);
    // 验证 no retry — 只发了一次请求
    expect(requestCount).toBe(1);
  });
});
