/**
 * W7.2 e2e — QQBot postMessage mock e2e (D60 additive, 2026-07-09)
 *
 * 3 cases 镜像 wau-channel/internal/adapter/qq/qq_real_test.go:
 *   1. success: nock 拦截 POST api.sgroup.qq.com/v2/channels/{id}/messages → 200 {message_id}
 *   2. APIErr:  nock 拦截 → 500 (QQ Bot server error)
 *   3. auth_fail: nock 拦截 → 401 (QQ Bot auth error,access_token 失效)
 *
 * 关键设计:
 *   - 跳过 start() 的 WS 拨号 + token 拉取,直接注入 accessToken + tokenExpiresAt
 *     (TypeScript private 仅编译期,RUNTIME 仍可写)
 *   - nock.disableNetConnect() 防止 axios 漏到真网络
 *   - QQBot 用 axios.create + baseURL=https://api.sgroup.qq.com,直接 nock 该 host
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { QQBot } from "../../src/bot/qq/qq";
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
 * 构造 QQBot 并注入 fake accessToken(skip start() 的 WS 拨号 + token 拉取)。
 * tokenExpiresAt 设到 2099,避免 isTokenExpired 触发 refreshAccessToken。
 */
function makeQQBot(appId = "qqapp_test_fake", appSecret = "qqsecret_test_fake"): QQBot {
  const bot = new QQBot(appId, appSecret, newBuilder());
  (bot as any).accessToken = "qq-mock-access-token-001";
  // 设到 2099 — 远超 isTokenExpired 检查
  (bot as any).tokenExpiresAt = Math.floor(new Date("2099-12-31").getTime() / 1000);
  return bot;
}

describe("qq e2e (D60)", () => {
  // -------- Case 1: success --------
  it("qq success", async () => {
    let capturedBody: unknown = null;
    let requestCount = 0;
    const scope = nock("https://api.sgroup.qq.com")
      .post(/\/v2\/channels\/.+\/messages/, (body) => {
        requestCount++;
        capturedBody = body;
        return true;
      })
      .reply(200, {
        message_id: "qq_msg_001",
        id: "qq_id_001",
      });

    const bot = makeQQBot();
    const msgId = await bot.postMessage("C-QQ-CHAN-001", "hello qq");

    expect(msgId).toBe("qq_msg_001");
    expect(scope.isDone()).toBe(true);
    expect(requestCount).toBe(1);
    // 验证 request body shape
    const body = capturedBody as Record<string, unknown>;
    expect(body.content).toBe("hello qq");
    expect(body.msg_type).toBe(0); // text
  });

  // -------- Case 2: APIErr --------
  it("qq APIErr", async () => {
    let requestCount = 0;
    const scope = nock("https://api.sgroup.qq.com")
      .post(/\/v2\/channels\/.+\/messages/, () => {
        requestCount++;
        return true;
      })
      .reply(500, {
        ret: 500,
        message: "internal server error",
      });

    const bot = makeQQBot();
    let caught: Error | null = null;
    try {
      await bot.postMessage("C-QQ-CHAN-002", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/500|Request failed|server error/);
    expect(scope.isDone()).toBe(true);
    // 验证 no retry — 只发了一次请求(axios 默认 0 retries)
    expect(requestCount).toBe(1);
  });

  // -------- Case 3: auth_fail --------
  it("qq auth_fail", async () => {
    let requestCount = 0;
    const scope = nock("https://api.sgroup.qq.com")
      .post(/\/v2\/channels\/.+\/messages/, () => {
        requestCount++;
        return true;
      })
      .reply(401, {
        ret: 401,
        message: "invalid access_token",
      });

    const bot = makeQQBot();
    let caught: Error | null = null;
    try {
      await bot.postMessage("C-QQ-CHAN-003", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/401|invalid access_token|Unauthorized/);
    expect(scope.isDone()).toBe(true);
    expect(requestCount).toBe(1);
  });
});
