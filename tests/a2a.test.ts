/**
 * ★ 2026-11-19 新增:A2A v1.0 客户端测试。
 *
 * 线格式依据 kernel `internal/protocol/a2a/`(A2A v1.0):
 *  - 方法名 `SendMessage`(首字母大写;v0.3.0 是 `message/send`)
 *  - **每次请求必须带 `A2A-Version: 1.0` 头**(缺失或值不匹配服务端直接拒)
 *  - Part 没有 `kind` 字段 —— `text` / `raw` / `url` / `data` 本身是判别器
 *  - 响应三种形状:task 分支 / message 分支 / legacy v0.3.0 顶层分支
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { Client, A2A_PROTOCOL_VERSION, METHOD_SEND_MESSAGE } from "../src";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

// 实测抓到的响应体(2026-11-19,hermes-shop01:9901)
const REAL_TASK_RESPONSE = {
  jsonrpc: "2.0",
  id: "probe-1",
  result: {
    task: {
      id: "task-281b4d78ec544907",
      contextId: "ctx-e68fad6cada24e31",
      status: {
        state: "TASK_STATE_COMPLETED",
        timestamp: "2026-11-19T12:15:22.356Z",
        message: {
          role: "ROLE_AGENT",
          parts: [{ text: "通了", mediaType: "text/plain" }],
          messageId: "5552e974436e48e39fbe3cc2f4121d95",
          contextId: "ctx-e68fad6cada24e31",
        },
      },
      artifacts: [
        {
          artifactId: "b63889df32b04c06969bdf98583c2",
          parts: [{ text: "通了", mediaType: "text/plain" }],
        },
      ],
    },
  },
};

describe("A2A v1.0 客户端", () => {
  it("带 A2A-Version: 1.0 头", async () => {
    let gotHeader = "";
    let gotAuth = "";
    let gotBody: Record<string, unknown> = {};

    nock("http://agent.test:9901")
      .post("/", (body: unknown) => {
        gotBody = body as Record<string, unknown>;
        return true;
      })
      .reply(function () {
        gotHeader = this.req.headers["a2a-version"] as string;
        gotAuth = this.req.headers.authorization as string;
        return [200, REAL_TASK_RESPONSE];
      });

    const c = new Client("http://mock-kernel:18400");
    await c.a2a.sendMessage("http://agent.test:9901/", "你好", "peer-tok");

    expect(gotHeader).toBe(A2A_PROTOCOL_VERSION);
    expect(A2A_PROTOCOL_VERSION).toBe("1.0");
    expect(gotAuth).toBe("Bearer peer-tok");

    expect(gotBody.method).toBe(METHOD_SEND_MESSAGE);
    expect(METHOD_SEND_MESSAGE).toBe("SendMessage");
    expect(gotBody.jsonrpc).toBe("2.0");

    const params = gotBody.params as { message: Record<string, unknown> };
    expect(params.message.role).toBe("user");
    expect(params.message.messageId).toBeTruthy();
    expect(params.message.parts).toEqual([{ text: "你好" }]);
  });

  it("提取 task 分支文本", async () => {
    nock("http://agent.test:9901").post("/").reply(200, REAL_TASK_RESPONSE);
    const c = new Client("http://mock-kernel:18400");
    const text = await c.a2a.sendText("http://agent.test:9901/", "你好");
    expect(text).toContain("通了");
  });

  it("提取 message 分支文本", async () => {
    nock("http://agent.test:9901").post("/").reply(200, {
      jsonrpc: "2.0",
      id: "1",
      result: {
        message: {
          messageId: "m-1",
          role: "ROLE_AGENT",
          parts: [{ text: "message 分支" }],
        },
      },
    });
    const c = new Client("http://mock-kernel:18400");
    const text = await c.a2a.sendText("http://agent.test:9901/", "你好");
    expect(text).toContain("message 分支");
  });

  it("提取 legacy v0.3.0 文本", async () => {
    nock("http://agent.test:9901").post("/").reply(200, {
      jsonrpc: "2.0",
      id: "1",
      result: {
        kind: "task",
        id: "t-1",
        artifacts: [{ parts: [{ kind: "text", text: "legacy 文本" }] }],
      },
    });
    const c = new Client("http://mock-kernel:18400");
    const text = await c.a2a.sendText("http://agent.test:9901/", "你好");
    expect(text).toContain("legacy 文本");
  });

  it("JSON-RPC 业务错要抛异常", async () => {
    nock("http://agent.test:9901").post("/").reply(200, {
      jsonrpc: "2.0",
      id: "1",
      error: { code: -32050, message: "unauthorized" },
    });
    const c = new Client("http://mock-kernel:18400");
    await expect(c.a2a.sendMessage("http://agent.test:9901/", "你好")).rejects.toThrow();
  });
});
