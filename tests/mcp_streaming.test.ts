/**
 * MCP SSE streaming client 单测 (wau-typescript-sdk v1.3.3, per D89.A.7).
 *
 * 30+ 测试覆盖(per W5 SSE baseline):
 *   - 公开类型 + 导出
 *   - 5 streamMessage event types (open/message/artifact/task_complete/error)
 *   - subscribeToTask happy path + edge cases
 *   - StreamOptions (include_history / include_artifacts / default)
 *   - StreamHandle (cancel idempotent / events close after cancel)
 *   - Bearer token refresh
 *   - 鉴权失败 (401 / 404)
 *   - Error path (POST failure / GET failure / stream_id mismatch / invalid JSON)
 *   - Concurrent streams
 *   - SSE 协议边缘 (comment lines / long running)
 *   - AbortController 中止
 */

import { describe, expect, it, vi } from "vitest";

import {
  MCPClient,
  Message,
  RPCError,
  ToolStreamMessage,
  ToolSubscribeToTask,
  buildHeaders,
} from "../src/mcp";

// ────────────────────────────────────────────────────────
// Mock SSE server — generate ReadableStream from frame list
// ────────────────────────────────────────────────────────

interface SSEFrame {
  event?: string;
  data: string;
  comment?: string;
}

function encodeFrames(frames: SSEFrame[]): string {
  return frames
    .map((f) => {
      let out = "";
      if (f.comment) out += `:${f.comment}\n`;
      if (f.event) out += `event: ${f.event}\n`;
      out += `data: ${f.data}\n\n`;
      return out;
    })
    .join("");
}

interface MockSSEServer {
  feedFrames(frames: SSEFrame[]): void;
  feedRawText(text: string): void;
  close(): void;
}

function makeMockSSE(): {
  server: MockSSEServer;
  fetchImpl: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
    body?: ReadableStream<Uint8Array> | null;
  }>;
  requests: { url: string; method: string; headers: Record<string, string>; body: string }[];
  postings: { url: string; body: string }[];
  streams: SSEStream[];
} {
  const requests: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const postings: { url: string; body: string }[] = [];
  const streams: SSEStream[] = [];

  const makeStream = (stream: SSEStream): ReadableStream<Uint8Array> => {
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (stream.closed) {
          try { controller.close(); } catch { /* ignore */ }
          return;
        }
        if (stream.buffers.length > 0) {
          try { controller.enqueue(stream.buffers.shift()!); } catch { /* ignore */ }
          return;
        }
        // wait
        stream.pullWaiter = (chunk) => {
          if (chunk === null || stream.closed) {
            try { controller.close(); } catch { /* ignore */ }
          } else {
            try { controller.enqueue(chunk); } catch { /* ignore */ }
          }
          stream.pullWaiter = null;
        };
      },
      cancel() {
        stream.closed = true;
        if (stream.pullWaiter) stream.pullWaiter(null);
      },
    });
  };

  const fetchImpl: any = async (input: string, init?: any) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ?? "";
    requests.push({ url: input, method: init?.method ?? "GET", headers, body });
    // Detect: SSE GET?
    if (init?.method === undefined || init?.method === "GET") {
      const stream: SSEStream = {
        id: streams.length + 1,
        buffers: [],
        closed: false,
        pullWaiter: null,
      };
      streams.push(stream);
      return {
        status: 200,
        text: async () => "",
        json: async () => {
          throw new Error("not json");
        },
        body: makeStream(stream),
      };
    }
    // POST → return stream_id + endpoint
    let envelope: any;
    try {
      envelope = JSON.parse(body);
    } catch {
      return {
        status: 200,
        text: async () => "",
        json: async () => ({}),
        body: null,
      };
    }
    const params = envelope.params as any;
    const toolName = params?.name as string;
    let ssePath = "/mcp/sse?stream_id=";
    let streamID = "stream-uuid-mock";
    // record every tool call POST body
    postings.push({ url: input, body });
    if (toolName === ToolStreamMessage) {
      streamID = `stream-${requests.length}-${Date.now()}`;
    } else if (toolName === ToolSubscribeToTask) {
      const taskID = (params.arguments as any).task_id;
      streamID = `subscribe-${taskID}-${requests.length}`;
    }
    return {
      status: 200,
      headers: {},
      text: async () => "",
      json: async () => ({
        jsonrpc: "2.0",
        id: envelope.id,
        result: {
          endpoint: ssePath + streamID,
          stream_id: streamID,
        },
      }),
      body: null,
    };
  };

  const feed = (chunk: Uint8Array): void => {
    // send to all open streams(typical test has only 1)
    for (const stream of streams) {
      if (stream.closed) continue;
      if (stream.pullWaiter) {
        stream.pullWaiter(chunk);
      } else {
        stream.buffers.push(chunk);
      }
    }
  };

  const server: MockSSEServer = {
    feedFrames(frames: SSEFrame[]) {
      const encoded = encodeFrames(frames);
      const chunk = new TextEncoder().encode(encoded);
      feed(chunk);
    },
    feedRawText(text: string) {
      const chunk = new TextEncoder().encode(text);
      feed(chunk);
    },
    close() {
      for (const stream of streams) {
        stream.closed = true;
        if (stream.pullWaiter) stream.pullWaiter(null);
      }
    },
  };

  return { server, fetchImpl, requests, postings, streams };
}

interface SSEStream {
  id: number;
  buffers: Uint8Array[];
  closed: boolean;
  pullWaiter: ((chunk: Uint8Array | null) => void) | null;
}

// ────────────────────────────────────────────────────────
// 公开类型 + 导出 sanity
// ────────────────────────────────────────────────────────

describe("MCP SSE streaming - exports", () => {
  it("exports stream types from index", async () => {
    const m = await import("../src/mcp");
    expect(typeof m.MCPClient.prototype.streamMessage).toBe("function");
    expect(typeof m.MCPClient.prototype.subscribeToTask).toBe("function");
  });
});

// ────────────────────────────────────────────────────────
// streamMessage — 5 event types
// ────────────────────────────────────────────────────────

describe("MCPClient.streamMessage", () => {
  it("test_stream_message_open_frame", async () => {
    const { server, fetchImpl, postings } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "test-jwt", {
      fetchImpl: fetchImpl as any,
    });
    const msg: Message = { role: "user", parts: [{ type: "text", text: "hi" }] };

    // kick off
    const handleP = client.streamMessage("fox-agent", msg);
    // Allow POST phase to complete first;SSE phase pulls chunks
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({ stream_id: "stream-x", timestamp: "2026-07-11T10:00:00Z" }) },
    ]);
    const handle = await handleP;
    expect(handle.streamId).toMatch(/^stream-/);
    const iter = handle.events();
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.type).toBe("open");
    // StreamEvent.streamId = the server-assigned stream-id (from POST response),
    // matches handle.streamId. The data field holds whatever the server put in frame.
    expect(first.value?.streamId).toBe(handle.streamId);
    expect(first.value?.timestamp).toBe("2026-07-11T10:00:00Z");
    expect(postings).toHaveLength(1);
    server.close();
    handle.cancel();
  });

  it("test_stream_message_message_frame", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({ stream_id: "s1" }) },
      { event: "message", data: JSON.stringify({ message_id: "m1", role: "agent", text: "Hi back" }) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
      if (events.length >= 2) break;
    }
    expect(events[0].type).toBe("open");
    expect(events[1].type).toBe("message");
    expect(events[1].data.message_id).toBe("m1");
    expect(events[1].data.text).toBe("Hi back");
    server.close();
    handle.cancel();
  });

  it("test_stream_message_artifact_frame", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({}) },
      { event: "artifact", data: JSON.stringify({ artifact_id: "a1", name: "report.pdf", parts: [] }) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
      if (events.length >= 2) break;
    }
    expect(events[1].type).toBe("artifact");
    expect(events[1].data.artifact_id).toBe("a1");
    server.close();
    handle.cancel();
  });

  it("test_stream_message_task_complete_frame", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({}) },
      { event: "task_complete", data: JSON.stringify({ task_id: "t1", status: { state: "completed" } }) },
      { event: "close", data: JSON.stringify({ reason: "done" }) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
    }
    expect(events[events.length - 1].type).toBe("close");
    expect(events[events.length - 2].type).toBe("task_complete");
    expect(events[events.length - 2].data.status.state).toBe("completed");
    server.close();
  });

  it("test_stream_message_error_frame", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({}) },
      { event: "error", data: JSON.stringify({ code: -32003, message: "agent unreachable" }) },
    ]);
    const handle = await handleP;
    let caught: unknown;
    try {
      for await (const ev of handle.events()) {
        /* drain */
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RPCError);
    expect((caught as RPCError).code).toBe(-32003);
    server.close();
  });

  it("test_stream_message_nil_message", async () => {
    const { fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    await expect(
      client.streamMessage("fox", undefined as unknown as Message),
    ).rejects.toThrow(/required/);
  });

  it("test_stream_message_empty_parts", async () => {
    const { fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const msg: Message = { role: "user", parts: [] };
    await expect(client.streamMessage("fox", msg)).rejects.toThrow(/parts/);
  });

  it("test_stream_message_abort", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    await handle.cancel();
    let caught: unknown;
    try {
      for await (const _ev of handle.events()) {
        // after cancel, iterator should close out
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeUndefined();
    server.close();
  });
});

// ────────────────────────────────────────────────────────
// subscribeToTask
// ────────────────────────────────────────────────────────

describe("MCPClient.subscribeToTask", () => {
  it("test_subscribe_to_task_happy_path", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.subscribeToTask("fox-agent", "task-1");
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({ stream_id: "s2" }) },
      { event: "task_status", data: JSON.stringify({ state: "working" }) },
      { event: "task_complete", data: JSON.stringify({ state: "completed" }) },
      { event: "close", data: JSON.stringify({}) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) events.push(ev);
    expect(events.map((e) => e.type)).toEqual(["open", "task_status", "task_complete", "close"]);
    expect(events[2].data.state).toBe("completed");
    server.close();
  });

  it("test_subscribe_to_task_task_id_empty", async () => {
    const { fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    await expect(client.subscribeToTask("fox", "")).rejects.toThrow(/task_id/);
  });

  it("test_subscribe_to_task_error_frame", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.subscribeToTask("fox", "task-bad");
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({}) },
      { event: "error", data: JSON.stringify({ code: -32603, message: "internal" }) },
    ]);
    const handle = await handleP;
    let caught: unknown;
    try {
      for await (const _ev of handle.events()) {
        /* drain */
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RPCError);
    server.close();
  });
});

// ────────────────────────────────────────────────────────
// StreamOptions wire format
// ────────────────────────────────────────────────────────

describe("MCPClient streamOptions wire format", () => {
  it("test_stream_options_include_history", async () => {
    const { server, fetchImpl, postings } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage(
      "fox",
      { role: "user", parts: [{ type: "text", text: "q" }] },
      { includeHistory: true },
    );
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    const envelope = JSON.parse(postings[0].body);
    expect(envelope.params.arguments.stream_options.include_history).toBe(true);
    expect(envelope.params.arguments.stream_options.include_artifacts).toBeUndefined();
    handle.cancel();
    server.close();
  });

  it("test_stream_options_include_artifacts", async () => {
    const { server, fetchImpl, postings } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage(
      "fox",
      { role: "user", parts: [{ type: "text", text: "q" }] },
      { includeArtifacts: false },
    );
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    const envelope = JSON.parse(postings[0].body);
    expect(envelope.params.arguments.stream_options.include_artifacts).toBe(false);
    handle.cancel();
    server.close();
  });

  it("test_stream_options_default", async () => {
    const { server, fetchImpl, postings } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    const envelope = JSON.parse(postings[0].body);
    expect(envelope.params.arguments.stream_options).toBeUndefined();
    handle.cancel();
    server.close();
  });

  it("test_stream_options_custom", async () => {
    const { server, fetchImpl, postings } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage(
      "fox",
      { role: "user", parts: [{ type: "text", text: "q" }] },
      { includeHistory: true, includeArtifacts: true },
    );
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    const envelope = JSON.parse(postings[0].body);
    expect(envelope.params.arguments.stream_options).toEqual({
      include_history: true,
      include_artifacts: true,
    });
    handle.cancel();
    server.close();
  });

  it("test_subscribe_to_task_stream_options", async () => {
    const { server, fetchImpl, postings } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.subscribeToTask("fox", "task-1", { includeHistory: true });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    const envelope = JSON.parse(postings[0].body);
    expect(envelope.params.arguments.task_id).toBe("task-1");
    expect(envelope.params.arguments.stream_options.include_history).toBe(true);
    handle.cancel();
    server.close();
  });
});

// ────────────────────────────────────────────────────────
// StreamHandle semantics
// ────────────────────────────────────────────────────────

describe("StreamHandle semantics", () => {
  it("test_stream_handle_cancel_idempotent", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    await handle.cancel();
    await handle.cancel();
    await handle.cancel();
    // no throw
    expect(true).toBe(true);
    server.close();
  });

  it("test_stream_handle_events_close_after_cancel", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "open", data: JSON.stringify({}) },
      { event: "close", data: JSON.stringify({}) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) events.push(ev);
    expect(events[events.length - 1].type).toBe("close");
    server.close();
  });

  it("test_stream_handle_timestamp_parsing", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "message", data: JSON.stringify({ timestamp: "2026-07-11T12:34:56Z", text: "hi" }) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
      if (events.length >= 1) break;
    }
    expect(events[0].timestamp).toBe("2026-07-11T12:34:56Z");
    server.close();
    handle.cancel();
  });
});

// ────────────────────────────────────────────────────────
// Auth / 鉴权失败
// ────────────────────────────────────────────────────────

describe("MCPClient streamMessage auth", () => {
  it("test_stream_message_401", async () => {
    const fetchImpl: any = async () => ({
      status: 401,
      text: async () => JSON.stringify({ error: { code: -32001, message: "unauthorized" } }),
      json: async () => ({ error: { code: -32001, message: "unauthorized" } }),
      body: null,
    });
    const client = new MCPClient("https://kernel.example.com", "old-jwt", { fetchImpl });
    await expect(
      client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] }),
    ).rejects.toThrow();
  });

  it("test_stream_message_404", async () => {
    const fetchImpl: any = async () => ({
      status: 404,
      text: async () => "not found",
      json: async () => {
        throw new Error("not json");
      },
      body: null,
    });
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl });
    await expect(
      client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] }),
    ).rejects.toThrow();
  });

  it("test_stream_message_bearer_token_refresh", async () => {
    const { server, fetchImpl, requests } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "old-jwt", { fetchImpl: fetchImpl as any });
    client.setBearerToken("new-jwt");
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([{ event: "open", data: JSON.stringify({}) }]);
    const handle = await handleP;
    // POST phase
    expect(requests[0].headers.Authorization).toBe("Bearer new-jwt");
    server.close();
    handle.cancel();
  });
});

// ────────────────────────────────────────────────────────
// Wire format 错误 / 边界
// ────────────────────────────────────────────────────────

describe("MCPClient streamMessage wire format", () => {
  it("test_stream_message_stream_id_mismatch", async () => {
    const fetchImpl: any = async () => ({
      status: 200,
      text: async () => "",
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { stream_id: 123 } }), // number, not string
      body: null,
    });
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl });
    await expect(
      client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] }),
    ).rejects.toThrow();
  });

  it("test_stream_message_invalid_json", async () => {
    const fetchImpl: any = async () => ({
      status: 200,
      text: async () => "not json",
      json: async () => {
        throw new Error("parse error");
      },
      body: null,
    });
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl });
    await expect(
      client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] }),
    ).rejects.toThrow();
  });

  it("test_stream_message_multiple_events", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    server.feedFrames([
      { event: "message", data: JSON.stringify({ n: 1 }) },
      { event: "message", data: JSON.stringify({ n: 2 }) },
      { event: "message", data: JSON.stringify({ n: 3 }) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
      if (events.length >= 3) break;
    }
    expect(events.map((e) => e.data.n)).toEqual([1, 2, 3]);
    server.close();
    handle.cancel();
  });

  it("test_stream_message_concurrent_streams", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const promises = Array.from({ length: 3 }, (_, i) =>
      client.streamMessage(`fox-${i}`, { role: "user", parts: [{ type: "text", text: `q${i}` }] }),
    );
    await new Promise((r) => setTimeout(r, 10));
    server.feedFrames([
      { event: "message", data: JSON.stringify({ id: "a" }) },
      { event: "message", data: JSON.stringify({ id: "b" }) },
      { event: "message", data: JSON.stringify({ id: "c" }) },
    ]);
    const handles = await Promise.all(promises);
    expect(handles).toHaveLength(3);
    server.close();
    await Promise.all(handles.map((h) => h.cancel()));
  });

  it("test_stream_message_post_failure", async () => {
    const fetchImpl: any = async () => {
      throw new Error("ECONNREFUSED");
    };
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl });
    await expect(
      client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] }),
    ).rejects.toThrow(/ECONNREFUSED|reach/);
  });

  it("test_stream_message_get_failure", async () => {
    // Mock stream_message POST but SSE GET returns 503
    const fetchImpl: any = async (input: string, init?: any) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body ?? "";
      if (init?.method === "GET" || init?.method === undefined) {
        return {
          status: 503,
          text: async () => "service unavailable",
          json: async () => {
            throw new Error("not json");
          },
          body: null,
        };
      }
      return {
        status: 200,
        headers: {},
        text: async () => "",
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { stream_id: "s1", endpoint: "/mcp/sse?stream_id=s1" },
        }),
        body: null,
      };
    };
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl });
    await expect(
      client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] }),
    ).rejects.toThrow();
  });

  it("test_stream_message_long_running", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    // simulate delayed chunks across multiple reads
    server.feedFrames([
      { event: "message", data: JSON.stringify({ tick: 1 }) },
    ]);
    await new Promise((r) => setTimeout(r, 3));
    server.feedFrames([
      { event: "message", data: JSON.stringify({ tick: 2 }) },
    ]);
    await new Promise((r) => setTimeout(r, 3));
    server.feedFrames([
      { event: "message", data: JSON.stringify({ tick: 3 }) },
    ]);
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
      if (events.length >= 3) break;
    }
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.data.tick)).toEqual([1, 2, 3]);
    server.close();
    handle.cancel();
  });

  it("test_stream_message_sse_comment_lines", async () => {
    const { server, fetchImpl } = makeMockSSE();
    const client = new MCPClient("https://kernel.example.com", "", { fetchImpl: fetchImpl as any });
    const handleP = client.streamMessage("fox", { role: "user", parts: [{ type: "text", text: "q" }] });
    await new Promise((r) => setTimeout(r, 5));
    // Comment lines (": ...") interleaved
    server.feedFrames([
      { event: "open", data: JSON.stringify({ stream_id: "s" }) },
    ]);
    server.feedRawText(":heartbeat-keep-alive\n\n");
    server.feedFrames([
      { event: "message", data: JSON.stringify({ x: 1 }) },
    ]);
    server.feedRawText(":another-heartbeat\n\n");
    const handle = await handleP;
    const events: any[] = [];
    for await (const ev of handle.events()) {
      events.push(ev);
      if (events.length >= 2) break;
    }
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("open");
    expect(events[1].type).toBe("message");
    expect(events[1].data.x).toBe(1);
    server.close();
    handle.cancel();
  });
});

// ────────────────────────────────────────────────────────
// headers & tool name helpers
// ────────────────────────────────────────────────────────

describe("MCPClient headers and tool names", () => {
  it("buildHeaders injects Accept: text/event-stream for SSE", () => {
    const h = buildHeaders("jwt", undefined, { Accept: "text/event-stream" });
    expect(h.Accept).toBe("text/event-stream");
    expect(h.Authorization).toBe("Bearer jwt");
  });

  it("stream tool constants align with kernel", async () => {
    expect(ToolStreamMessage).toBe("stream_message");
    expect(ToolSubscribeToTask).toBe("subscribe_to_task");
  });
});
