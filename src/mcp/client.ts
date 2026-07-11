/**
 * MCP client — MCPClient class with 8 sync tool wrappers + JSON-RPC 2.0 dispatch.
 *
 * ⭐ v1.0.0 D87.7 W3 + W4-W5 实装(2026-07-11)。
 *
 * 5 SDK 共享 wire format:JSON-RPC 2.0 over HTTP at POST {baseURL}/mcp
 * (跟 WAU-core-kernel internal/protocol/mcp/server.go handleMCP 对齐)。
 *
 * 本文件 = 8 sync tool wrapper (healthCheck / parseAgentCard / sendMessage /
 * getTask / listTasks / cancelTask / createTaskPushNotificationConfig /
 * getExtendedAgentCard) + JSON-RPC envelope + error handling。
 *
 * 2 SSE streaming tool (streamMessage / subscribeToTask) deferred to W5+.
 *
 * 协议合规:
 *   - D60 additive: 0 改老 SDK, 独立子包(chat.ts / bot/ / ucp/ 已有, v1.3.1 → v1.3.2 additive)
 *   - D13 byte-equal: JSON wire format 5 SDK 一致 (per design doc §二)
 *   - D78/D79/D80: MCP OAuth 2.0 identity_linking bearer token, 跟 UCP JWT 走同一通道
 *   - D87 ⭐⭐: 本子包 = D87.7 TypeScript SDK MCP client 实装 (W3-launch-SOP §3.3 拍板)
 *
 * 设计原则(跟 ucp/ 1:1):
 *   - 0 依赖外部 HTTP client lib;fetch 由 caller 注入(便于 test mocking)
 *   - W3 stub 友好:不感知 W5+ streaming 接入
 */

import {
  AgentCard,
  ExtendedAgentCard,
  HealthCheckResult,
  ListTasksFilter,
  ListTasksResult,
  Message,
  PushConfig,
  PushConfigResult,
  Task,
} from "./types";
import {
  asRPCError,
  ErrCodeInternal,
  ErrCodeParse,
  RPCError,
  RPCErrorPayload,
} from "./errors";
import { McpAuth, buildHeaders } from "./auth";
import {
  ALL_TOOL_NAMES,
  ToolCancelTask,
  ToolCreateTaskPushNotificationConfig,
  ToolGetExtendedAgentCard,
  ToolGetTask,
  ToolHealthCheck,
  ToolListTasks,
  ToolParseAgentCard,
  ToolSendMessage,
  ToolStreamMessage,
  ToolSubscribeToTask,
  isStreamingTool,
} from "./tools";
import {
  openStream,
  startSSE,
  StreamFetchImpl,
  StreamHandle,
  StreamOptions,
} from "./streaming";

/**
 * fetch 的最小子集(便于注入 — 测试用 mock fetch, 生产用全局 fetch)。
 *
 * fetch 签名跟标准 Fetch API 一致。
 */
export type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

// ────────────────────────────────────────────────────────
// ID generator(per JSON-RPC 2.0 spec, id 可为 string|number|null)
// ────────────────────────────────────────────────────────

let _idCounter = 0;
function generateID(): number {
  _idCounter += 1;
  return _idCounter;
}

// ────────────────────────────────────────────────────────
// MCPClient — 主类
// ────────────────────────────────────────────────────────

export interface MCPClientOptions {
  /** Optional override default endpoint ("/mcp"). */
  endpoint?: string;
  /** Optional override default User-Agent. */
  userAgent?: string;
  /** Optional injected fetch impl (测试用 mock). */
  fetchImpl?: FetchImpl;
}

/**
 * MCP client(发 JSON-RPC 2.0 请求到 kernel /mcp 端点)。
 *
 * 用法::
 *
 *     const cli = new MCPClient("https://kernel.example.com", "oauth-jwt");
 *     const card = await cli.parseAgentCard('{"name":"Fox"}');
 */
export class MCPClient {
  private readonly _baseURL: string;
  private readonly _endpoint: string;
  private readonly _userAgent: string;
  private readonly _auth: McpAuth;
  private readonly _fetch: FetchImpl;

  constructor(baseURL: string, bearerToken = "", options: MCPClientOptions = {}) {
    if (!baseURL) {
      throw new Error("mcpclient: baseURL is required");
    }
    this._baseURL = baseURL.replace(/\/+$/, "");
    this._endpoint = options.endpoint ?? "/mcp";
    this._userAgent = options.userAgent ?? "wau-typescript-sdk/mcpclient/v1.3.2";
    this._auth = new McpAuth(bearerToken);
    // caller 不传 → 用全局 fetch(浏览器/Node 18+ 都有)
    this._fetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  }

  /** 运行时更新 bearer token (W5+ refresh flow 用). */
  setBearerToken(token: string): void {
    this._auth.setBearerToken(token);
  }

  // ── 8 sync tool wrappers ─────────────────────────────
  /** tool 1: health_check */
  async healthCheck(target: string | Record<string, unknown>): Promise<HealthCheckResult> {
    const params = buildToolParams(ToolHealthCheck, {
      target: normalizeTarget(target),
    });
    return this.callTool<HealthCheckResult>(params);
  }

  /** tool 2: parse_agent_card */
  async parseAgentCard(raw: string | Uint8Array | Record<string, unknown>): Promise<AgentCard> {
    const params = buildParseAgentCardParams(raw);
    return this.callTool<AgentCard>(params);
  }

  /** tool 3: send_message */
  async sendMessage(
    target: string | Record<string, unknown>,
    message: Message,
  ): Promise<Task> {
    if (!message) {
      throw new Error("mcpclient: message is required");
    }
    if (!message.parts || message.parts.length === 0) {
      throw new Error("mcpclient: message.parts must have at least 1 item");
    }
    const params = buildToolParams(ToolSendMessage, {
      target: normalizeTarget(target),
      message,
    });
    return this.callTool<Task>(params);
  }

  /** tool 5: get_task */
  async getTask(target: string | Record<string, unknown>, taskID: string): Promise<Task> {
    if (!taskID) {
      throw new Error("mcpclient: task_id is required");
    }
    const params = buildToolParams(ToolGetTask, {
      target: normalizeTarget(target),
      task_id: taskID,
    });
    return this.callTool<Task>(params);
  }

  /** tool 6: list_tasks */
  async listTasks(
    target: string | Record<string, unknown>,
    filter?: ListTasksFilter,
  ): Promise<ListTasksResult> {
    const args: Record<string, unknown> = {
      target: normalizeTarget(target),
    };
    if (filter) {
      args.filter = filter;
    }
    const params = buildToolParams(ToolListTasks, args);
    return this.callTool<ListTasksResult>(params);
  }

  /** tool 7: cancel_task */
  async cancelTask(target: string | Record<string, unknown>, taskID: string): Promise<Task> {
    if (!taskID) {
      throw new Error("mcpclient: task_id is required");
    }
    const params = buildToolParams(ToolCancelTask, {
      target: normalizeTarget(target),
      task_id: taskID,
    });
    return this.callTool<Task>(params);
  }

  /** tool 9: create_task_push_notification_config */
  async createTaskPushNotificationConfig(
    target: string | Record<string, unknown>,
    config: PushConfig,
  ): Promise<PushConfigResult> {
    if (!config || !config.url) {
      throw new Error("mcpclient: config.url is required");
    }
    const params = buildToolParams(ToolCreateTaskPushNotificationConfig, {
      target: normalizeTarget(target),
      config,
    });
    return this.callTool<PushConfigResult>(params);
  }

  /** tool 10: get_extended_agent_card */
  async getExtendedAgentCard(
    target: string | Record<string, unknown>,
  ): Promise<ExtendedAgentCard> {
    const params = buildToolParams(ToolGetExtendedAgentCard, {
      target: normalizeTarget(target),
    });
    return this.callTool<ExtendedAgentCard>(params);
  }

  // ── 2 SSE streaming wrappers (W5 D89.A.7) ────────────
  /**
   * Stream a message to the target agent via SSE.
   *
   * 流程(per D87.3 + kernel server.go handleStreamMessage):
   *   1. POST /mcp {tools/call: stream_message, target, message, stream_options}
   *   2. kernel 返 {stream_id, endpoint}
   *   3. GET endpoint SSE → StreamHandle.events() 异步消费
   */
  async streamMessage(
    target: string | Record<string, unknown>,
    message: Message,
    opts?: StreamOptions,
  ): Promise<StreamHandle> {
    if (!message) {
      throw new Error("mcpclient: message is required");
    }
    if (!message.parts || message.parts.length === 0) {
      throw new Error("mcpclient: message.parts must have at least 1 item");
    }
    const streamOpts: Record<string, unknown> = {};
    if (opts) {
      if (opts.includeHistory !== undefined) streamOpts.include_history = opts.includeHistory;
      if (opts.includeArtifacts !== undefined) streamOpts.include_artifacts = opts.includeArtifacts;
    }
    return this.openStreamHandle(ToolStreamMessage, normalizeTarget(target), {
      message,
      ...(Object.keys(streamOpts).length > 0 ? { stream_options: streamOpts } : {}),
    });
  }

  /**
   * Subscribe to a task's progress via SSE.
   *
   * 流程(per D87.3 + kernel server.go handleSubscribeToTask):
   *   1. POST /mcp {tools/call: subscribe_to_task, target, task_id, stream_options}
   *   2. kernel 返 {stream_id, endpoint}
   *   3. GET endpoint SSE → StreamHandle.events() 异步消费
   */
  async subscribeToTask(
    target: string | Record<string, unknown>,
    taskID: string,
    opts?: StreamOptions,
  ): Promise<StreamHandle> {
    if (!taskID) {
      throw new Error("mcpclient: task_id is required");
    }
    const streamOpts: Record<string, unknown> = {};
    if (opts) {
      if (opts.includeHistory !== undefined) streamOpts.include_history = opts.includeHistory;
      if (opts.includeArtifacts !== undefined) streamOpts.include_artifacts = opts.includeArtifacts;
    }
    return this.openStreamHandle(ToolSubscribeToTask, normalizeTarget(target), {
      task_id: taskID,
      ...(Object.keys(streamOpts).length > 0 ? { stream_options: streamOpts } : {}),
    });
  }

  /**
   * Shared internal helper: open a stream (POST /mcp → SSE GET) and wrap into StreamHandle.
   */
  private async openStreamHandle(
    toolName: string,
    target: Record<string, unknown>,
    extra: Record<string, unknown>,
  ): Promise<StreamHandle> {
    const abortController = new AbortController();
    const streamFetch = (this._fetch as unknown as StreamFetchImpl);
    const streamStart = await openStream(
      this._baseURL,
      this._endpoint,
      this._auth.token,
      this._userAgent,
      toolName,
      target,
      streamFetch,
      extra,
      abortController.signal,
    );
    const sseURL = streamStart.endpoint.startsWith("http")
      ? streamStart.endpoint
      : this._baseURL + streamStart.endpoint;
    return startSSE(
      streamStart.streamId,
      sseURL,
      this._auth.token,
      this._userAgent,
      streamFetch,
      abortController,
    );
  }

  // ── JSON-RPC 2.0 dispatcher ──────────────────────────
  private async callTool<T>(params: Record<string, unknown>): Promise<T> {
    const envelope = {
      jsonrpc: "2.0",
      method: "tools/call",
      params,
      id: generateID(),
    };
    const headers = buildHeaders(this._auth.token, this._userAgent);
    const resp = await this._fetch(this._baseURL + this._endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    });
    return handleResponse<T>(resp);
  }
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function buildToolParams(name: string, arguments_: Record<string, unknown>): Record<string, unknown> {
  return { name, arguments: arguments_ };
}

function normalizeTarget(target: string | Record<string, unknown>): Record<string, unknown> {
  if (target === null || target === undefined) {
    throw new Error("mcpclient: target is required");
  }
  if (typeof target === "string") {
    return { name: target };
  }
  if (typeof target === "object") {
    return target as Record<string, unknown>;
  }
  throw new Error(`mcpclient: target must be str or dict, got ${typeof target}`);
}

function buildParseAgentCardParams(
  raw: string | Uint8Array | Record<string, unknown>,
): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    throw new Error("mcpclient: raw is required");
  }
  if (typeof raw === "string") {
    return buildToolParams(ToolParseAgentCard, { raw });
  }
  if (raw instanceof Uint8Array) {
    // bytes → base64 string(让 kernel 端可还原)
    return buildToolParams(ToolParseAgentCard, {
      raw: Buffer.from(raw).toString("base64"),
    });
  }
  if (typeof raw === "object") {
    return buildToolParams(ToolParseAgentCard, { raw });
  }
  throw new Error(`mcpclient: raw must be str|Uint8Array|dict, got ${typeof raw}`);
}

interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

async function handleResponse<T>(resp: FetchResponseLike): Promise<T> {
  // 4xx/5xx → 期望仍是 JSON-RPC envelope, 但 fallback HTTP error
  if (resp.status >= 400) {
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
    throw new RPCError(ErrCodeParse, `malformed JSON: ${asRPCError(e).message}`);
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
  return payload.result as T;
}