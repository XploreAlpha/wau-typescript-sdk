/**
 * W7.2 e2e — DingtalkBot postMessage mock e2e (D60 additive, 2026-07-09)
 *
 * 3 cases 镜像 wau-channel/internal/adapter/dingtalk/dingtalk_real_test.go:
 *   1. success: fetch mock → 200 OK
 *   2. APIErr:  fetch mock → 500 (webhook server error)
 *   3. auth_fail: fetch mock → 401 (DingTalk webhook auth 错误)
 *
 * 关键设计:
 *   - 跳过 start() 的 DWClient.connect()(Stream Mode WS 握手),直接注入 client + webhooks 缓存
 *     (TypeScript private 仅编译期,RUNTIME 仍可写)
 *   - 钉钉 chatbot 模型:PostMessage 必须先收到 incoming 事件才能发(per SDK 设计),
 *     测试用 cacheWebhook() 预填 sessionWebhook
 *   - DingTalk 用原生 fetch(undici),nock 13.5 不支持拦截 fetch(仅 beta 支持),
 *     改用 vi.spyOn(global, 'fetch') 拦截,per chat.test.ts SSE 测试的既有 pattern
 *   - nock.disableNetConnect() 仍保留以防 SDK 内部走 axios
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import nock from "nock";
import { DingtalkBot } from "../../src/bot/dingtalk/dingtalk";
import { newBuilder } from "../../src/bot/common";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
  vi.restoreAllMocks();
});

/**
 * 钉钉 sessionWebhook URL(per 钉钉 OpenAPI)。
 * 真实场景下,此 URL 由 incoming chatbot callback 推送过来;测试用 fake URL 让 fetch spy 拦截。
 */
const MOCK_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=mock-token-001";
const MOCK_CONVERSATION_ID = "conv-dingtalk-001";

/**
 * 构造 DingtalkBot 并注入 fake client + 预填 webhooks 缓存(skip start() 的 WS 握手)。
 */
function makeDingtalkBot(
  appKey = "ding_appkey_fake",
  appSecret = "ding_appsecret_fake",
  robotCode = "ding_robot_fake"
): DingtalkBot {
  const bot = new DingtalkBot(appKey, appSecret, robotCode, newBuilder());
  // fake client(避免 start() 调 DWClient.connect())
  (bot as any).client = {
    connect: async () => {},
    disconnect: () => {},
    registerAllEventListener: (_fn: any) => {},
  };
  // 预填 webhooks 缓存(per 钉钉 chatbot 模型,必须先收到 incoming)
  (bot as any).webhooks.set(MOCK_CONVERSATION_ID, MOCK_WEBHOOK);
  return bot;
}

/**
 * 创建 fetch mock(per chat.test.ts SSE pattern)。
 * status: HTTP status code;body: response body(JSON object)
 */
function mockFetch(status: number, body: object): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("dingtalk e2e (D60)", () => {
  // -------- Case 1: success --------
  it("dingtalk success", async () => {
    let capturedBody: unknown = null;
    const spy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async (_url: any, init: any) => {
        // 解析 fetch 的 body
        try {
          capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        } catch {
          capturedBody = init?.body;
        }
        return new Response(
          JSON.stringify({ errcode: 0, errmsg: "ok" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

    try {
      const bot = makeDingtalkBot();
      const result = await bot.postMessage(MOCK_CONVERSATION_ID, "hello dingtalk");

      expect(result).toBe(MOCK_CONVERSATION_ID); // 钉钉 Stream Mode 返 conversationID
      // fetch 被调 1 次,URL 正确
      expect(spy).toHaveBeenCalledTimes(1);
      const calledUrl = spy.mock.calls[0][0] as string;
      expect(calledUrl).toBe(MOCK_WEBHOOK);
      // body 形状正确
      const body = capturedBody as Record<string, unknown>;
      expect(body.msgtype).toBe("text");
      expect((body.text as Record<string, unknown>).content).toBe("hello dingtalk");
    } finally {
      spy.mockRestore();
    }
  });

  // -------- Case 2: APIErr --------
  it("dingtalk APIErr", async () => {
    const spy = mockFetch(500, { errcode: -1, errmsg: "system error" });

    try {
      const bot = makeDingtalkBot();
      let caught: Error | null = null;
      try {
        await bot.postMessage(MOCK_CONVERSATION_ID, "hi");
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/500|status|webhook POST/);
      // 验证 no retry — 只调了一次 fetch
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  // -------- Case 3: auth_fail --------
  it("dingtalk auth_fail", async () => {
    const spy = mockFetch(401, { errcode: 310000, errmsg: "invalid access_token" });

    try {
      const bot = makeDingtalkBot();
      let caught: Error | null = null;
      try {
        await bot.postMessage(MOCK_CONVERSATION_ID, "hi");
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/401|invalid access_token|status/);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
