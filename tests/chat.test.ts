/**
 * v0.9.0 M3 §3.7 — ChatService 单测(nock mock wau-edge OpenAI 兼容层)
 *
 * 5 case(per plan §B.7):
 *   1. happy path(POST → OpenAI 响应解析)
 *   2. empty model → Error 客户端校验
 *   3. empty messages → Error 客户端校验
 *   4. server 4xx(InvalidRequest -32600) → APIError
 *   5. universe 透传
 *
 * Stage 3.1 #10 (2026-07-02) 新增 6 SSE 单测(per Go SDK TestChat_Stream_* 镜像)。
 * Total: 5 + 6 = 11 tests。
 *
 * SSE 测试设计:
 *   - happy: 6 chunks (role + "1+1=2") + [DONE]
 *   - empty: 立即 [DONE],0 chunks
 *   - auth error: HTTP 401 → APIError
 *   - bad json: role chunk + 坏 JSON → Error
 *   - empty model: 客户端校验,不发请求
 *   - empty messages: 客户端校验,不发请求
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
        // Stage 3.1 #11 (2026-07-03):Provider 透传 mock
        provider: "deepseek-v4-flash",
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
    // Stage 3.1 #11:Provider 透传验证
    expect(resp.provider).toBe("deepseek-v4-flash");
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

  // ============== Case 5:Provider 透传 (Stage 3.1 #11, 2026-07-03) ==============
  //
  // 验证:wau-edge /v1/chat/completions 响应里带 provider 字段(per LLMDecision.Provider 透传),
  //      wau-typescript-sdk ChatCompletionResponse.provider 字段能正确解析并暴露。
  // 兼容:老 server 不带 provider 字段 → SDK 解析为 ""(空串兜底,TypeScript 类构造默认参数)。

  it("provider 字段透传 (Stage 3.1 #11)", async () => {
    nock("http://mock:18402")
      .post("/v1/chat/completions")
      .reply(200, {
        id: "chatcmpl-provider-001",
        object: "chat.completion",
        created: 1700000002,
        model: "claude-haiku-4-5",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        provider: "claude-haiku-4-5",
      });

    const c = new Client("http://mock:18402");
    const resp = await c.chat.completions(
      new ChatCompletionRequest("claude-haiku-4-5", [new ChatMessage("user", "hi")])
    );
    expect(resp.provider).toBe("claude-haiku-4-5");
  });

  // ============== Case 6:universe 透传 ==============

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

// ============== Stage 3.1 #10 SSE Streaming 单测 ==============
//
// Transport.streamChat 走原生 fetch(不是 axios),nock 不能拦截 fetch,
// 所以这里用 vi.spyOn(global, 'fetch') 拦截并返回 SSE 流式响应。
// 协议:Content-Type: text/event-stream + data: {json}\n\n + data: [DONE]\n\n 终止

function makeSSEBody(chunks: string[] | null): string {
  let body = "";
  if (chunks) {
    for (const c of chunks) {
      body += `data: ${c}\n\n`;
    }
  }
  body += `data: [DONE]\n\n`;
  return body;
}

function makeSSEResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

function makeJsonErrorResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ChatService.stream (SSE)", () => {
  // ----- Case 6: stream happy path -----

  it("happy: 6 chunks + 累加 content='1+1=2' + finishReason='stop'", async () => {
    const sseBody = makeSSEBody([
      '{"id":"chatcmpl-ts-1","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
      '{"id":"chatcmpl-ts-1","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"1"}}]}',
      '{"id":"chatcmpl-ts-1","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"+"}}]}',
      '{"id":"chatcmpl-ts-1","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"1"}}]}',
      '{"id":"chatcmpl-ts-1","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"="}}]}',
      '{"id":"chatcmpl-ts-1","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"2"},"finish_reason":"stop"}]}',
    ]);
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(makeSSEResponse(200, sseBody));

    try {
      const c = new Client("http://mock:18402");
      let full = "";
      let lastId = "";
      let count = 0;
      for await (const chunk of c.chat.stream(
        new ChatCompletionRequest("deepseek-v4-flash", [new ChatMessage("user", "1+1=?")])
      )) {
        count++;
        lastId = chunk.id;
        if (chunk.choices.length > 0) {
          if (chunk.choices[0].delta.content) {
            full += chunk.choices[0].delta.content;
          }
          if (chunk.choices[0].finishReason === "stop") break;
        }
      }
      expect(lastId).toBe("chatcmpl-ts-1");
      expect(count).toBe(6);
      expect(full).toBe("1+1=2");
    } finally {
      spy.mockRestore();
    }
  });

  // ----- Case 7: stream empty -----

  it("empty: 立即 [DONE],0 chunks", async () => {
    const sseBody = makeSSEBody([]); // 只发 [DONE]
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(makeSSEResponse(200, sseBody));

    try {
      const c = new Client("http://mock:18402");
      let count = 0;
      for await (const _chunk of c.chat.stream(
        new ChatCompletionRequest("deepseek-v4-flash", [new ChatMessage("user", "anything")])
      )) {
        count++;
      }
      expect(count).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  // ----- Case 8: stream auth error -----

  it("auth error: HTTP 401 → APIError 抛出", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      makeJsonErrorResponse(401, { error: { code: -32001, message: "InsufficientTrust" } })
    );

    try {
      const c = new Client("http://mock:18402");
      await expect(async () => {
        for await (const _chunk of c.chat.stream(
          new ChatCompletionRequest("deepseek-v4-flash", [new ChatMessage("user", "hi")])
        )) {
          /* consume */
        }
      }).rejects.toBeInstanceOf(APIError);
    } finally {
      spy.mockRestore();
    }
  });

  // ----- Case 9: stream bad json -----

  it("bad json: role chunk + 坏 JSON 解析 → Error", async () => {
    const sseBody =
      `data: {"id":"chatcmpl-bad","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n` +
      `data: this-is-not-json{{{\n\n` +
      `data: [DONE]\n\n`;
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(makeSSEResponse(200, sseBody));

    try {
      const c = new Client("http://mock:18402");
      await expect(async () => {
        for await (const _chunk of c.chat.stream(
          new ChatCompletionRequest("deepseek-v4-flash", [new ChatMessage("user", "hi")])
        )) {
          /* consume */
        }
      }).rejects.toThrow(/parse SSE chunk/);
    } finally {
      spy.mockRestore();
    }
  });

  // ----- Case 10: stream empty model (客户端校验) -----

  it("empty model → 客户端校验抛错(不发请求)", async () => {
    const spy = vi.spyOn(global, "fetch");
    expect(spy).not.toHaveBeenCalled();

    const c = new Client("http://mock:18402");
    await expect(async () => {
      for await (const _chunk of c.chat.stream(
        new ChatCompletionRequest("", [new ChatMessage("user", "hi")])
      )) {
        /* consume */
      }
    }).rejects.toThrow(/model is required/);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // ----- Case 11: stream empty messages (客户端校验) -----

  it("empty messages → 客户端校验抛错", async () => {
    const spy = vi.spyOn(global, "fetch");
    expect(spy).not.toHaveBeenCalled();

    const c = new Client("http://mock:18402");
    await expect(async () => {
      for await (const _chunk of c.chat.stream(
        new ChatCompletionRequest("deepseek-v4-flash", [])
      )) {
        /* consume */
      }
    }).rejects.toThrow(/messages must not be empty/);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
