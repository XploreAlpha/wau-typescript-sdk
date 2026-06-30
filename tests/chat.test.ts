/**
 * v0.9.0 M3 §3.7 — ChatService 单测(nock mock wau-edge OpenAI 兼容层)
 *
 * 5 case(per plan §B.7):
 *   1. happy path(POST → OpenAI 响应解析)
 *   2. empty model → Error 客户端校验
 *   3. empty messages → Error 客户端校验
 *   4. server 4xx(InvalidRequest -32600) → APIError
 *   5. universe 透传
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import {
  Client,
  ChatMessage,
  ChatCompletionRequest,
  APIError,
} from "../src";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

// ============== Case 1:happy path ==============

describe("ChatService.completions", () => {
  it("happy path: 解析 OpenAI 字节级 JSON", async () => {
    nock("http://mock:18402")
      .post("/v1/chat/completions")
      .reply(200, {
        id: "chatcmpl-mock-001",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "echo: hello" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        reason: "static:tenant=acme model=gpt-4o-mini",
      });

    const c = new Client("http://mock:18402");
    const resp = await c.chat.completions(
      new ChatCompletionRequest(
        "gpt-4o-mini",
        [new ChatMessage("user", "hello")],
        false,
        "default"
      )
    );
    expect(resp.id).toBe("chatcmpl-mock-001");
    expect(resp.choices.length).toBe(1);
    expect(resp.choices[0].message.content).toBe("echo: hello");
    expect(resp.reason).toContain("static:tenant=acme");
  });

  // ============== Case 2:empty model ==============

  it("empty model → 客户端校验抛错(不发请求)", async () => {
    const c = new Client("http://mock:18402");
    await expect(
      c.chat.completions(
        new ChatCompletionRequest("", [new ChatMessage("user", "hi")])
      )
    ).rejects.toThrow(/model is required/);
  });

  // ============== Case 3:empty messages ==============

  it("empty messages → 客户端校验抛错", async () => {
    const c = new Client("http://mock:18402");
    await expect(
      c.chat.completions(new ChatCompletionRequest("gpt-4o-mini", []))
    ).rejects.toThrow(/messages must not be empty/);
  });

  // ============== Case 4:server 4xx ==============

  it("server 4xx → APIError 透传 status_code", async () => {
    nock("http://mock:18402")
      .post("/v1/chat/completions")
      .reply(400, {
        error: { code: -32600, message: "InvalidRequest: empty messages" },
      });

    const c = new Client("http://mock:18402");
    await expect(
      c.chat.completions(
        new ChatCompletionRequest("gpt-4o-mini", [new ChatMessage("user", "hi")])
      )
    ).rejects.toBeInstanceOf(APIError);
  });

  // ============== Case 5:universe 透传 ==============

  it("universe 字段透传到 server", async () => {
    let capturedBody: unknown = null;
    nock("http://mock:18402")
      .post("/v1/chat/completions", (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200, {
        id: "x",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

    const c = new Client("http://mock:18402");
    await c.chat.completions(
      new ChatCompletionRequest(
        "gpt-4o-mini",
        [new ChatMessage("user", "hi")],
        false,
        "us-prod" // universe
      )
    );
    expect(capturedBody).toMatchObject({ universe: "us-prod" });
  });
});
