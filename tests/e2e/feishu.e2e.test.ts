/**
 * W7.2 e2e — FeishuBot postMessage mock e2e (D60 additive, 2026-07-09)
 *
 * 3 cases 镜像 wau-channel/internal/adapter/feishu/feishu_real_test.go:
 *   1. success: nock 拦截 POST /open-apis/im/v1/messages → 200 {code:0, data:{message_id}}
 *   2. APIErr:  nock 拦截 → 200 {code:230001, msg:'chat not found'} (Feishu 业务错误码)
 *   3. auth_fail: nock 拦截 tenant_access_token → 401 (Feishu auth 错误)
 *
 * 关键设计:
 *   - 跳过 start() 的 WS 握手(LarkChannel.connect),直接注入 channel 字段
 *     (TypeScript private 仅编译期,RUNTIME 仍可写),避免真连 wss://open.feishu.cn
 *   - nock.disableNetConnect() 防止 axios 漏到真网络
 *   - fake channel.send 走 axios 调真实 endpoint,nock 拦截底层 HTTP
 *   - 业务错误(Feishu code != 0)由 fake channel 主动 throw,模拟 SDK 行为
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import nock from "nock";
import axios from "axios";
import { FeishuBot } from "../../src/bot/feishu/feishu";
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
 * 构造 FeishuBot 并注入一个内部走 axios 的 fake channel(skip start() 的 WS 握手)。
 * fake channel.send 用 axios 调真实 endpoint,nock 拦截底层 HTTP。
 * 业务错误(Feishu code != 0)时 throw,模拟 SDK 行为。
 */
function makeFeishuBot(
  appId = "cli_test_fake",
  appSecret = "secret_test_fake",
  verificationToken = "verify_test_fake",
): FeishuBot {
  const bot = new FeishuBot(appId, appSecret, verificationToken, newBuilder());

  // fake channel — 用 axios 调真实 endpoint,这样 nock 能拦截
  const fakeChannel: any = {
    send: async (chatId: string, input: { text: string }) => {
      // 先 mock 拉 tenant_access_token(per Feishu auth flow)
      const tokenResp = await axios.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        { app_id: appId, app_secret: appSecret }
      );
      const accessToken = tokenResp.data?.tenant_access_token ?? "mock-tenant-token";
      // 然后发消息
      const resp = await axios.post(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
        {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: input.text }),
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // 业务错误:code != 0 → throw
      if (resp.data?.code && resp.data.code !== 0) {
        throw new Error(
          `feishu: send failed code=${resp.data.code} msg=${resp.data.msg ?? "unknown"}`
        );
      }
      return { messageId: resp.data?.data?.message_id ?? "" };
    },
    editMessage: async (messageId: string, newText: string) => {
      const resp = await axios.patch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
        {
          msg_type: "text",
          content: JSON.stringify({ text: newText }),
        }
      );
      if (resp.data?.code && resp.data.code !== 0) {
        throw new Error(`feishu: editMessage failed code=${resp.data.code}`);
      }
      return resp.data;
    },
    on: (_event: string, _handler: any) => () => {},
    connect: async () => {},
    disconnect: async () => {},
  };
  (bot as any).channel = fakeChannel;
  return bot;
}

describe("feishu e2e (D60)", () => {
  // -------- Case 1: success --------
  it("feishu success", async () => {
    // nock tenant_access_token
    nock("https://open.feishu.cn")
      .post("/open-apis/auth/v3/tenant_access_token/internal")
      .reply(200, {
        code: 0,
        msg: "success",
        tenant_access_token: "t-mock-token-001",
        expire: 7200,
      });

    // nock send message
    let capturedBody: unknown = null;
    let requestCount = 0;
    const scope = nock("https://open.feishu.cn")
      .post("/open-apis/im/v1/messages", (body) => {
        requestCount++;
        capturedBody = body;
        return true;
      })
      .query((q) => q.receive_id_type === "chat_id")
      .reply(200, {
        code: 0,
        msg: "success",
        data: { message_id: "om_msg_001" },
      });

    const bot = makeFeishuBot();
    const msgId = await bot.postMessage("oc_chat001", "hello feishu");

    expect(msgId).toBe("om_msg_001");
    expect(scope.isDone()).toBe(true);
    expect(requestCount).toBe(1);
    // 验证 body
    const body = capturedBody as Record<string, unknown>;
    expect(body.receive_id).toBe("oc_chat001");
    expect(body.msg_type).toBe("text");
  });

  // -------- Case 2: APIErr --------
  it("feishu APIErr", async () => {
    nock("https://open.feishu.cn")
      .post("/open-apis/auth/v3/tenant_access_token/internal")
      .reply(200, {
        code: 0,
        msg: "success",
        tenant_access_token: "t-mock-token-002",
        expire: 7200,
      });

    let requestCount = 0;
    const scope = nock("https://open.feishu.cn")
      .post("/open-apis/im/v1/messages", () => {
        requestCount++;
        return true;
      })
      .query((q) => q.receive_id_type === "chat_id")
      .reply(200, {
        code: 230001, // Feishu 业务错误码:invalid chat_id
        msg: "chat not found",
        data: {},
      });

    const bot = makeFeishuBot();
    let caught: Error | null = null;
    try {
      await bot.postMessage("oc_bad", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/230001|chat not found|send failed/);
    expect(scope.isDone()).toBe(true);
    // 验证 no retry — 只发了一次请求
    expect(requestCount).toBe(1);
  });

  // -------- Case 3: auth_fail --------
  it("feishu auth_fail", async () => {
    // tenant_access_token 返 401
    nock("https://open.feishu.cn")
      .post("/open-apis/auth/v3/tenant_access_token/internal")
      .reply(401, {
        code: 99991663,
        msg: "invalid app_id or app_secret",
      });

    const bot = makeFeishuBot();
    let caught: Error | null = null;
    try {
      await bot.postMessage("oc_chat003", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/401|invalid app_id/);
  });
});
