/**
 * Wau client — WauClient class with full v1.3.2 RPC implementation
 *
 * ⭐ v1.3.2 — full RPC unlock (per WAU-develop/develop-log/wau-homerail/homerail-end.md §三.1)
 *
 * 4 方法(per #14 + #15 + #19 + SDK Consumer Contract §二.3):
 *   1. registerAgent(config):  POST {registry_url}/v1/agents (wau-registry alias)
 *   2. heartbeat():           POST {registry_url}/v1/agents/heartbeat
 *   3. recommendWorkflow(q):  POST {edge_url}/v1/recommend
 *   4. matchWauPattern(q):    POST {edge_url}/v1/patterns/match (stub 501 等 wau-dag-patterns 仓)
 *
 * 设计原则(跟 UCP/MCP client.ts 1:1):
 *   - 0 依赖外部 HTTP client lib;fetch 由 caller 注入(fetchImpl option,生产用全局 fetch)
 *   - JWT 4-claim bearer (per D66=B + #21): Authorization: Bearer ${config.auth_token}
 *   - 超时: AbortController 默认 30s (config.timeout_ms 覆盖)
 *   - 错误分层:
 *       401/403 → WauWorkflowError('AUTH_FAILED', retryable: true)
 *       400     → WauWorkflowError('AUTH_FAILED' or 'INVALID_WORKFLOW_TYPE', retryable: false)
 *       404     → WauWorkflowError('SERVER_ERROR', retryable: false)
 *       5xx     → WauWorkflowError('SERVER_ERROR', retryable: true)
 *       timeout → WauWorkflowError('TIMEOUT', retryable: true)
 *       network → WauWorkflowError('NETWORK_ERROR', retryable: true)
 *
 * 协议合规:
 *   - D60 additive: 0 改老 SDK,只新增 fetch 实装 + 替换 throw
 *   - D78 byte-equal: WauWorkflow 19 字段 snake_case per #14 A
 *   - D66=B: registerAgent 带 JWT 4-claim (sub/aud/exp/scope)
 *   - #14 A: snake_case field name (per SDK v1.3.1 决策)
 *   - #15 B: recommendWorkflow/matchWauPattern 走 wau-edge
 *   - #17 B: harness 校验在 homerail PR-E handler,SDK 端不重复
 *   - #18 b: registerAgent retryable=false,其他 retryable=true
 *   - #21 JWT 4-claim 通过 config.auth_token 注入
 *   - #22 失败回退:retryable flag 由 caller (homerail executeWauIntent) 决定
 */

import type { WauClientConfig, WauWorkflow } from "./types";
import {
  WauWorkflowError,
  WauErrCodeAuthFailed,
  WauErrCodeInvalidWorkflowType,
  WauErrCodeNetworkError,
  WauErrCodeServerError,
  WauErrCodeTimeout,
} from "./errors";

/**
 * fetch 的最小子集(便于注入 — 测试用 mock fetchImpl,生产用全局 fetch)。
 *
 * fetch 签名跟 UCPClient 一致(per src/ucp/client.ts FetchImpl)。
 */
export type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** 默认 user agent(per D78 byte-equal anchor)。 */
export const WAU_DEFAULT_USER_AGENT = "wau-typescript-sdk/wau/v1.3.2";

/** 默认 4 方法超时(per SDK Consumer Contract §二.1 timeout_ms) */
export const WAU_DEFAULT_TIMEOUT_MS = 30000;

/** 默认 heartbeat 周期(per SDK Consumer Contract §二.1 heartbeat_interval_ms) */
export const WAU_DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;

/**
 * WauClientOptions(跟 UCPClientOptions / MCPClientOptions pattern 1:1):
 * caller 注入 fetchImpl + auth_token(默认从 config.auth_token 读)+ timeout
 */
export interface WauClientOptions {
  /** 自定义 fetch impl(test 注入,生产用全局 fetch) */
  fetchImpl?: FetchImpl;
  /** 自定义 user agent(默认 WAU_DEFAULT_USER_AGENT) */
  userAgent?: string;
  /** 自定义 timeout 覆盖 config.timeout_ms(per WauClientConfig.timeout_ms?) */
  timeoutMs?: number;
}

/**
 * WauClient class — 4 method full RPC (per SDK Consumer Contract §二.3)
 *
 *   1. registerAgent(config) — POST {registry_url}/v1/agents
 *   2. heartbeat()           — POST {registry_url}/v1/agents/heartbeat
 *   3. recommendWorkflow(q)  — POST {edge_url}/v1/recommend
 *   4. matchWauPattern(q)    — POST {edge_url}/v1/patterns/match (wau-edge stub 501)
 *
 * 协议合规:D60 additive / D78 byte-equal / #14 A / #15 B / #17 B / #18 b / #19 A / #21 DAG-aware / #22 失败回退
 */
export class WauClient {
  private readonly config: WauClientConfig;
  private readonly fetchImpl: FetchImpl;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(config: WauClientConfig, options?: WauClientOptions) {
    this.config = config;

    // Resolve fetchImpl (优先 caller 注入,其次全局 fetch)
    const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchImpl | undefined);
    if (fetchImpl === undefined) {
      throw new WauWorkflowError(
        "No fetchImpl provided and global fetch is unavailable. " +
          "Provide options.fetchImpl or run on Node 18+ / browser.",
        WauErrCodeServerError,
        false,
      );
    }
    this.fetchImpl = fetchImpl;

    // Resolve timeoutMs
    this.timeoutMs =
      options?.timeoutMs ??
      config.timeout_ms ??
      WAU_DEFAULT_TIMEOUT_MS;

    this.userAgent = options?.userAgent ?? WAU_DEFAULT_USER_AGENT;
  }

  // ────────────────────────────────────────────────────────
  // 1. registerAgent(per SDK Consumer Contract §二.3)
  //    POST {registry_url}/v1/agents (wau-registry alias)
  //    per #1c: 严格 category=USER_ENTRY + trustExempt=true (在 system_capability 校验)
  //    失败抛 WauWorkflowError, caller 决定 retry (per #18, retryable=false 一次性)
  // ────────────────────────────────────────────────────────

  /**
   * 调 wau-registry 注册 homerail-voice 为 system_ui agent
   * @returns Promise<void> 成功 resolve (204 No Content)
   * @throws WauWorkflowError 失败时(per SDK Consumer Contract §二.4 retryable flag)
   */
  async registerAgent(_config?: WauClientConfig): Promise<void> {
    const url = this.getEndpointUrl("register");
    const headers = this.buildAuthHeader();
    headers["Content-Type"] = "application/json";

    // body schema = RegistryAgentCard(per wau-registry v1.0.1 /v1 alias)
    const card = {
      name: this.config.system_capability.category === "USER_ENTRY"
        ? "homerail-voice"
        : "homerail-agent",
      description: "HomeRail voice agent registered via wau-sdk v1.3.2",
      url: "http://localhost:18400",
      skills: this.config.system_capability.sub_capabilities.map((s) => s.name),
      version: this.userAgent,
    };

    const resp = await this.doFetch(url, headers, JSON.stringify(card), "registerAgent");
    // wau-registry v1.0.1: 204 No Content on success
    if (resp.status === 204 || resp.status === 200) {
      return;
    }
    throw await mapHttpToWauWorkflowError(resp, "registerAgent", false);
  }

  // ────────────────────────────────────────────────────────
  // 2. heartbeat(per SDK Consumer Contract §二.3)
  //    POST {registry_url}/v1/agents/heartbeat (wau-registry alias)
  //    caller 控制 schedule (SDK 不内置 timer, 避免 side-effect)
  // ────────────────────────────────────────────────────────

  /**
   * 周期心跳发到 wau-registry(走 wau-edge)
   * 默认按 config.heartbeat_interval_ms 周期, caller 控制 schedule
   * @returns Promise<void> 成功 resolve (204 No Content)
   * @throws WauWorkflowError 失败时 (retryable=true)
   */
  async heartbeat(): Promise<void> {
    const url = this.getEndpointUrl("heartbeat");
    const headers = this.buildAuthHeader();
    headers["Content-Type"] = "application/json";

    // body schema = minimal RegistryAgentCard (per wau-registry v1.0.1 heartbeat handler)
    const card = {
      name: "homerail-voice",
      url: "http://localhost:18400",
      version: this.userAgent,
    };

    const resp = await this.doFetch(url, headers, JSON.stringify(card), "heartbeat");
    if (resp.status === 204 || resp.status === 200) {
      return;
    }
    throw await mapHttpToWauWorkflowError(resp, "heartbeat", true);
  }

  // ────────────────────────────────────────────────────────
  // 3. recommendWorkflow(per SDK Consumer Contract §二.3)
  //    POST {edge_url}/v1/recommend (wau-edge HTTP handler)
  //    内部转发到 wau-intent gRPC IntentService.RecommendAgent
  // ────────────────────────────────────────────────────────

  /**
   * 调 wau-intent(经 wau-edge)推荐 workflow
   * @param query 自然语言 query(用户原始 input)
   * @returns Promise<WauWorkflow> 19 字段全 wire (per SDK Consumer Contract §二.2)
   * @throws WauWorkflowError 失败时 (retryable=true)
   */
  async recommendWorkflow(query: string): Promise<WauWorkflow> {
    const url = this.getEndpointUrl("recommend");
    const headers = this.buildAuthHeader();
    headers["Content-Type"] = "application/json";

    const body = {
      query,
      top_k: 3,
      online_only: false,
    };

    const resp = await this.doFetch(url, headers, JSON.stringify(body), "recommendWorkflow");
    if (resp.status === 200) {
      const wf = await resp.json();
      return wf as WauWorkflow;
    }
    throw await mapHttpToWauWorkflowError(resp, "recommendWorkflow", true);
  }

  // ────────────────────────────────────────────────────────
  // 4. matchWauPattern(per SDK Consumer Contract §二.3)
  //    POST {edge_url}/v1/patterns/match (wau-edge STUB 501 等 wau-dag-patterns 仓)
  // ────────────────────────────────────────────────────────

  /**
   * 推 wau-dag-patterns(per #4 抽象 consumer-side)
   * @param query 自然语言 query
   * @returns Promise<WauWorkflow> 19 字段全 wire (等 wau-dag-patterns 仓 + SDK v1.3.3 才返)
   * @throws WauWorkflowError(SERVER_ERROR, retryable=false) — 当前永远抛(直到 wau-dag-patterns 仓 + v1.3.3 stub 替换)
   */
  async matchWauPattern(_query: string): Promise<WauWorkflow> {
    const url = this.getEndpointUrl("match");
    const headers = this.buildAuthHeader();
    headers["Content-Type"] = "application/json";

    const body = { query: _query };
    const resp = await this.doFetch(url, headers, JSON.stringify(body), "matchWauPattern");

    if (resp.status === 501) {
      // wau-edge stub 501: wau-dag-patterns 仓未建仓
      // per homerail-end.md §十 ask 1 拍板 A: stub 拍板 + v1.3.2 RPC unlock 不等 patterns
      throw new WauWorkflowError(
        `WauClient.matchWauPattern returned 501 Not Implemented from wau-edge. ` +
          `wau-dag-patterns backend service not yet shipped. ` +
          `See WAU-develop/develop-log/wau-homerail/homerail-end.md §十 ask 1.`,
        WauErrCodeServerError,
        false,
      );
    }
    if (resp.status === 200) {
      const wf = await resp.json();
      return wf as WauWorkflow;
    }
    throw await mapHttpToWauWorkflowError(resp, "matchWauPattern", false);
  }

  // ────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────

  /**
   * doFetch: 调 fetch + 加超时(AbortController) + 网络错误映射
   *
   * 错误处理:
   *   - network error (fetch reject)        → throw WauWorkflowError('NETWORK_ERROR', retryable: <paramref name="retryable"/>)
   *   - timeout (AbortController abort)     → throw WauWorkflowError('TIMEOUT', retryable=true)
   *   - HTTP non-2xx                        → 返回 response, 让 caller 调 mapHttpToWauWorkflowError
   */
  private async doFetch(
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    methodLabel: string,
  ): Promise<{
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const init: Parameters<FetchImpl>[1] = {
        method: "POST",
        headers,
        signal: ac.signal,
      };
      if (body !== undefined) {
        init.body = body;
      }
      return await this.fetchImpl(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new WauWorkflowError(
          `WauClient.${methodLabel} timeout after ${this.timeoutMs}ms`,
          WauErrCodeTimeout,
          true,
        );
      }
      throw new WauWorkflowError(
        `WauClient.${methodLabel} network error: ${err instanceof Error ? err.message : String(err)}`,
        WauErrCodeNetworkError,
        true,
        err instanceof Error ? err : undefined,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * buildAuthHeader: 返回 JWT 4-claim bearer header(per D66=B + #21)
   * @internal
   */
  protected buildAuthHeader(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
    };
    if (this.config.auth_token !== undefined) {
      headers["Authorization"] = `Bearer ${this.config.auth_token}`;
    }
    return headers;
  }

  /**
   * getEndpointUrl: 拼 endpoint URL(per #15 走 wau-edge for recommend/match, #1c + #21 wau-registry alias)
   * @internal
   */
  protected getEndpointUrl(method: "register" | "heartbeat" | "recommend" | "match"): string {
    switch (method) {
      case "register":
        return `${this.config.registry_url}/v1/agents`;
      case "heartbeat":
        return `${this.config.registry_url}/v1/agents/heartbeat`;
      case "recommend":
        return `${this.config.edge_url}/v1/recommend`;
      case "match":
        return `${this.config.edge_url}/v1/patterns/match`;
    }
  }
}

// ────────────────────────────────────────────────────────
// Internal HTTP error mapper
// ────────────────────────────────────────────────────────

interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
}

/**
 * mapHttpToWauWorkflowError: HTTP status → WauWorkflowError
 *
 * 400 → AUTH_FAILED(agent calling with wrong body shape) or INVALID_WORKFLOW_TYPE (per status body)
 * 401/403 → AUTH_FAILED, retryable=true
 * 404 → SERVER_ERROR, retryable=false
 * 5xx → SERVER_ERROR, retryable=true (default) or false (per retryable param)
 * 其他 → SERVER_ERROR, retryable=param
 */
async function mapHttpToWauWorkflowError(
  resp: FetchResponseLike,
  methodLabel: string,
  retryable: boolean,
): Promise<WauWorkflowError> {
  const body = await resp.text().catch(() => "");
  const msg = `WauClient.${methodLabel} HTTP ${resp.status}: ${body}`.slice(0, 500);

  if (resp.status === 401 || resp.status === 403) {
    return new WauWorkflowError(msg, WauErrCodeAuthFailed, true);
  }
  if (resp.status === 400) {
    return new WauWorkflowError(msg, WauErrCodeInvalidWorkflowType, false);
  }
  if (resp.status === 404) {
    return new WauWorkflowError(msg, WauErrCodeServerError, false);
  }
  // 5xx / network 5xx: retryable default true
  return new WauWorkflowError(msg, WauErrCodeServerError, retryable);
}