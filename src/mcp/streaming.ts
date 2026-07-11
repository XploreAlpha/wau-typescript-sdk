/**
 * MCP SSE streaming client (wau-typescript-sdk v1.3.3, per D89.A.7).
 *
 * 实现 kernel SSE 流式消费:
 *   - Phase 1: POST /mcp 调 stream_message / subscribe_to_task,server 返 stream_id
 *   - Phase 2: GET /mcp/sse?stream_id=<id>,server 返回 event-stream frame
 *
 * SSE 帧格式(per WHATWG HTML spec + kernel server.go `handleSSE`):
 *   - `event: open\ndata: {"stream_id":"<id>","timestamp":"..."}\n\n`
 *   - `event: <type>\ndata: <json>\n\n` where type = message | artifact | task_status | task_complete
 *   - `event: close\ndata: {"reason":"..."}\n\n`
 *   - `event: error\ndata: {"code":-32003,"message":"..."}\n\n`
 *   - 以空行分隔(双 \n);":…" 行是 comment,忽略
 *
 * 设计原则:
 *   - 0 依赖外部 SSE lib(参考 transport.ts streamChat pattern)
 *   - AbortController 控制 fetch abort
 *   - async iterator pattern (events() 返回 AsyncIterableIterator<StreamEvent>)
 *   - fetchImpl 注入便于测试(可 mock ReadableStream)
 *   - DO NOT auto-reconnect(caller 自己决定)
 *
 * 协议合规:
 *   - D60 additive: 8 sync tool 代码不动,新增独立 streaming.ts
 *   - D13 byte-equal: JSON wire format 跟 kernel server.go 一致
 *   - D78/D79/D80: bearer token 注入 GET /mcp/sse Authorization header
 *   - D89.A.7: 实装 2 SSE stream wrapper (streamMessage / subscribeToTask)
 */

import { buildHeaders } from "./auth";
import {
  ErrCodeInternal,
  ErrCodeParse,
  RPCError,
  RPCErrorPayload,
} from "./errors";
import {
  Message,
} from "./types";
import {
  ToolStreamMessage,
  ToolSubscribeToTask,
} from "./tools";

// ────────────────────────────────────────────────────────
// 公开类型
// ────────────────────────────────────────────────────────

/** StreamEvent 类型(per kernel SSE wire format)。*/
export type StreamEventType =
  | "open"
  | "message"
  | "artifact"
  | "task_status"
  | "task_complete"
  | "close"
  | "error";

/** SSE event payload。*/
export interface StreamEvent {
  type: StreamEventType;
  streamId: string;
  timestamp: string; // ISO 8601(从 server 拿到;open 可能 server 不给,fallback 用本地时间)
  data: Record<string, unknown>;
}

/** stream_message / subscribe_to_task stream options。*/
export interface StreamOptions {
  includeHistory?: boolean;
  includeArtifacts?: boolean;
}

/** 内部分 phase-1 POST 响应(kernel server.go 返回的 Result shape)。*/
interface StreamStartResult {
  endpoint?: string;
  stream_id?: string;
}

/** SSE fetch 返回的响应类型(跟 client.ts FetchImpl 区分:这里需要 body.getReader)。*/
export interface StreamFetchResponse {
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** ReadableStream<Uint8Array>(WHATWG fetch spec)。*/
  body?: ReadableStream<Uint8Array> | null;
}

/** fetch impl for SSE(扩展 FetchImpl,支持 ReadableStream response body)。*/
export type StreamFetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<StreamFetchResponse>;

/** StreamHandle = 公开 stream 控制 + 事件消费。*/
export interface StreamHandle {
  readonly streamId: string;
  events(): AsyncIterableIterator<StreamEvent>;
  cancel(): Promise<void>;
}

// ────────────────────────────────────────────────────────
// MCPClient.streamMessage / subscribeToTask 共享 open-stream helper
// ────────────────────────────────────────────────────────

/**
 * phase-1 启动 stream(POST /mcp with stream_message / subscribe_to_task)。
 *
 * 返回 stream_id + phase-2 GET endpoint;caller 用 phase-2 fetch 启 SSE 消费。
 */
export async function openStream(
  baseURL: string,
  endpoint: string,
  bearerToken: string,
  userAgent: string,
  toolName: string,
  target: Record<string, unknown>,
  fetchImpl: StreamFetchImpl,
  extra: Record<string, unknown>,
  fetchSignal?: AbortSignal,
): Promise<{ streamId: string; endpoint: string }> {
  const envelope = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: toolName,
      arguments: {
        target,
        ...extra,
      },
    },
    id: generateID(),
  };
  const headers = buildHeaders(bearerToken, userAgent, {
    Accept: "application/json, text/event-stream",
  });
  const init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  } = {
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
  };
  if (fetchSignal) {
    init.signal = fetchSignal;
  }
  const resp = await fetchImpl(baseURL + endpoint, init);
  if (resp.status >= 400) {
    // 4xx/5xx 走跟 client.ts handleResponse 类似逻辑:RPCError envelope 优先
    try {
      const payload = (await resp.json()) as Record<string, unknown>;
      if (payload && typeof payload === "object" && "error" in payload) {
        throw RPCError.fromDict(payload.error as RPCErrorPayload);
      }
    } catch (e) {
      if (e instanceof RPCError) throw e;
    }
    const text = await resp.text();
    throw new RPCError(resp.status * -1, `http ${resp.status}: ${text.slice(0, 512)}`);
  }
  let payload: Record<string, unknown>;
  try {
    payload = (await resp.json()) as Record<string, unknown>;
  } catch (e) {
    throw new RPCError(ErrCodeParse, `malformed JSON: ${(e as Error).message}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new RPCError(ErrCodeParse, `invalid JSON-RPC envelope: ${typeof payload}`);
  }
  if ("error" in payload) {
    throw RPCError.fromDict(payload.error as RPCErrorPayload);
  }
  if (!("result" in payload)) {
    throw new RPCError(ErrCodeInternal, "missing 'result' in response envelope");
  }
  const result = payload.result as StreamStartResult;
  if (!result.stream_id || typeof result.stream_id !== "string") {
    throw new RPCError(ErrCodeInternal, "missing 'stream_id' in stream start result");
  }
  return {
    streamId: result.stream_id,
    endpoint: result.endpoint ?? `/mcp/sse?stream_id=${result.stream_id}`,
  };
}

// ────────────────────────────────────────────────────────
// StreamHandle 工厂 + AsyncIterableIterator
// ────────────────────────────────────────────────────────

/**
 * Start SSE consumption on `streamId` (phase-2 GET /mcp/sse?stream_id=...).
 *
 * @param sseURL 完整 GET URL(kernel 返回 endpoint,这里默认 baseURL + endpoint;
 *               test 可注入完整 httpbin-style URL)
 */
export async function startSSE(
  streamId: string,
  sseURL: string,
  bearerToken: string,
  userAgent: string,
  fetchImpl: StreamFetchImpl,
  abortController: AbortController,
): Promise<StreamHandle> {
  // 启 GET fetch;abort signal 让 cancel() 立刻 abort
  const headers = buildHeaders(bearerToken, userAgent, {
    Accept: "text/event-stream",
  });
  const resp = await fetchImpl(sseURL, {
    method: "GET",
    headers,
    signal: abortController.signal,
  });
  if (resp.status >= 400) {
    throw new RPCError(
      resp.status * -1,
      `sse get failed: http ${resp.status}`,
    );
  }
  if (!resp.body) {
    throw new RPCError(ErrCodeInternal, "sse response missing body");
  }

  const queue: StreamEvent[] = [];
  const errorQueue: unknown[] = [];
  let resolved = false;
  let rejected = false;
  let waiter: (() => void) | null = null;
  let closeReason: { reason: string } | null = null;

  const notify = (): void => {
    const w = waiter;
    waiter = null;
    if (w) w();
  };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // 后台 goroutine(read SSE frames → push 到 queue)。
  (async () => {
    let currentEvent = "message"; // default per WHATWG
    let dataLines: string[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // flush trailing frame
          if (dataLines.length > 0) {
            const ev = parseSSEFrame(
              streamId,
              currentEvent,
              dataLines.join("\n"),
              new Date().toISOString(),
            );
            queue.push(ev);
          }
          // close:server 走完整 close frame,否则 EOF 也当 close
          if (!resolved && !rejected) {
            closeReason = { reason: "eof" };
            resolved = true;
            notify();
          }
          return;
        }
        if (abortController.signal.aborted) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        // SSE 帧以 \n\n 分隔;split 后 last 是 partial(放回 buffer)
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          if (frame.length === 0) continue;
          const lines = frame.split("\n");
          for (const line of lines) {
            if (line.startsWith(":")) {
              // comment line,忽略
              continue;
            }
            const colonIdx = line.indexOf(":");
            if (colonIdx === -1) continue;
            const field = line.slice(0, colonIdx);
            // 跳过 leading space(per spec,": value" 而不是 ":value")
            let valueRaw = line.slice(colonIdx + 1);
            if (valueRaw.startsWith(" ")) valueRaw = valueRaw.slice(1);
            if (field === "event") {
              currentEvent = valueRaw;
            } else if (field === "data") {
              dataLines.push(valueRaw);
            }
            // "id" / "retry" 字段暂时忽略(W5+ 不需要 reconnect / last-event-id)
          }
          if (dataLines.length > 0) {
            const ev = parseSSEFrame(
              streamId,
              currentEvent,
              dataLines.join("\n"),
              new Date().toISOString(),
            );
            dataLines = [];
            currentEvent = "message";
            if (ev.type === "close") {
              closeReason = { reason: String(ev.data?.reason ?? "server_close") };
              queue.push(ev);
              resolved = true;
              notify();
              return;
            }
            if (ev.type === "error") {
              // error event 推到专用 queue 让 caller 拿到
              errorQueue.push(new RPCError(
                Number(ev.data.code ?? ErrCodeInternal),
                String(ev.data.message ?? "stream error"),
                ev.data,
              ));
              queue.push(ev);
              continue;
            }
            queue.push(ev);
            notify();
          }
        }
      }
    } catch (e) {
      if (!resolved && !rejected) {
        rejected = true;
        errorQueue.push(
          e instanceof RPCError
            ? e
            : new RPCError(ErrCodeInternal, (e as Error).message ?? String(e)),
        );
        notify();
      }
    }
  })().catch((e) => {
    if (!resolved && !rejected) {
      rejected = true;
      errorQueue.push(new RPCError(ErrCodeInternal, String(e)));
      notify();
    }
  });

  const handle: StreamHandle = {
    streamId,
    async *events(): AsyncIterableIterator<StreamEvent> {
      while (true) {
        if (queue.length > 0) {
          const ev = queue.shift()!;
          yield ev;
          if (ev.type === "close") return;
          continue;
        }
        if (errorQueue.length > 0) {
          const err = errorQueue.shift();
          throw err;
        }
        if (resolved && !closeReason) {
          return;
        }
        if (closeReason) {
          return;
        }
        // wait until next event
        await new Promise<void>((resolveWait) => {
          waiter = resolveWait;
        });
      }
    },
    async cancel(): Promise<void> {
      if (abortController.signal.aborted) return; // idempotent
      abortController.abort();
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    },
  };
  return handle;
}

/** 解析 SSE single frame 的 data 字段 → StreamEvent。*/
function parseSSEFrame(
  streamId: string,
  eventType: string,
  dataRaw: string,
  fallbackTimestamp: string,
): StreamEvent {
  let data: Record<string, unknown> = {};
  let timestamp = fallbackTimestamp;
  if (dataRaw.length > 0) {
    try {
      const parsed = JSON.parse(dataRaw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed;
        // 兼容:server 在 frame payload 里塞 timestamp
        if (typeof parsed.timestamp === "string") {
          timestamp = parsed.timestamp as string;
        }
      } else {
        data = { value: parsed };
      }
    } catch {
      data = { raw: dataRaw };
    }
  }
  let type: StreamEventType;
  switch (eventType) {
    case "open":
    case "message":
    case "artifact":
    case "task_status":
    case "task_complete":
    case "close":
    case "error":
      type = eventType;
      break;
    default:
      // 未知 event type 当 message 处理
      type = "message";
      break;
  }
  return { type, streamId, timestamp, data };
}

// ────────────────────────────────────────────────────────
// ID generator(sync tool 共享同一 counter)
// ────────────────────────────────────────────────────────

let _idCounter = 0;
function generateID(): number {
  _idCounter += 1;
  return _idCounter;
}

// Re-export tool constants for direct caller use
export { ToolStreamMessage, ToolSubscribeToTask };

/** Type-only re-export for caller convenience。*/
export type { Message };
