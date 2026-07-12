/**
 * Wau client — WauClient class with 4 method stubs (per v1.0.1 Phase 0 拍板, B1 决策).
 *
 * ⭐ v1.3.1 WauClient skeleton (per SDK Consumer Contract §二.3, 2026-07-12).
 *
 * 4 方法(per #14 + #15 + #19):
 *   1. registerAgent(config): 调 wau-registry 注册 homerail-voice 为 system_ui agent
 *   2. heartbeat(): 周期心跳发到 wau-registry (走 wau-edge per #15)
 *   3. recommendWorkflow(query): 调 wau-intent(经 wau-edge)推荐 workflow
 *   4. matchWauPattern(query): 推 wau-dag-patterns(per #4 抽象)
 *
 * 设计原则(跟 UCP/MCP client.ts 1:1):
 *   - 0 依赖外部 HTTP client lib;fetch 由 caller 注入(fetchImpl option)
 *   - W3 stub 阶段:4 方法都 throw WauWorkflowError('SERVER_ERROR', retryable: false) + 友好 "v1.3.1 stub" 消息
 *     → homerail PR-E + PR-B 可以编译 + 跑通 test type check
 *     → 真实 RPC 等 wau-edge / wau-intent / wau-registry endpoint schema 落地后实装(v1.3.2+)
 *
 * 协议合规:
 *   - D60 additive: 0 改老 SDK,独立子包(跟 src/ucp/ src/mcp/ 1:1 pattern)
 *   - D78 byte-equal: 5 SDK 必须 WauClientConfig / WauWorkflow / WauWorkflowError 字段名 + 类型 1:1
 *   - D66=B RBAC: registerAgent 默认带 owner_user_id (string, 从 systemCapability.user 取)
 *   - #14 A: npm scope = wau-sdk (本 PR 不改 scope,per A1 决策)
 *   - #15 B: recommendWorkflow / matchWauPattern 走 wau-edge(URL 从 config.edge_url 读)
 *   - #17 B: voice harness 必须 'codex-appserver'(homerail PR-E handler 强校验,SDK 端不重复)
 *   - #18 b: SDK 抛 WauWorkflowError(retryable flag),homerail 端 executeWauIntent retry 2x
 *   - #19 A: 4 方法全 wire,本 stub 阶段 throw + 友好消息
 *   - #21 DAG-aware RPC schema: JWT 4-claim 通过 config.auth_token 注入(per D66=B)
 *   - #22 失败回退:retryable flag 由 caller 决定(per SDK Consumer Contract §二.4)
 */

import type { WauClientConfig, WauWorkflow } from "./types";
import {
  WauWorkflowError,
  WauErrCodeServerError,
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
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** 默认 user agent(per D78 byte-equal anchor)。 */
export const WAU_DEFAULT_USER_AGENT = "wau-typescript-sdk/wau/v1.3.1";

/** 默认 4 方法超时(per SDK Consumer Contract §二.1 timeoutMs) */
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
 * WauClient class — 4 method skeleton (per SDK Consumer Contract §二.3):
 *
 *   1. registerAgent(config) — 调 wau-registry
 *   2. heartbeat() — 周期心跳到 wau-registry(走 wau-edge)
 *   3. recommendWorkflow(query) — 调 wau-intent(经 wau-edge)推荐 workflow
 *   4. matchWauPattern(query) — 推 wau-dag-patterns(经 wau-edge)
 *
 * 协议合规:D60 additive / D78 byte-equal / #14 A / #15 B / #17 B / #18 b / #19 A / #21 DAG-aware / #22 失败回退
 *
 * 设计:W3 stub 阶段 4 方法全 throw WauWorkflowError('SERVER_ERROR', retryable: false);
 *      真实 RPC 等 wau-edge / wau-intent / wau-registry endpoint schema 落地后实装(v1.3.2+)
 */
export class WauClient {
  private readonly config: WauClientConfig;
  // userAgent 用在 buildAuthHeader (v1.3.2+ RPC 实装时用)
  // fetchImpl / timeoutMs 字段在 v1.3.2+ RPC 实装时再加 (本 stub 阶段 0 使用)
  private readonly userAgent: string;

  constructor(config: WauClientConfig, options?: WauClientOptions) {
    this.config = config;
    // 优先用 caller 注入 fetchImpl,其次全局 fetch(浏览器/Node 18+)
    // 验证 fetchImpl 可用,如果都不可用 throw
    const hasFetchImpl =
      options?.fetchImpl !== undefined ||
      typeof globalThis.fetch === "function";
    if (!hasFetchImpl) {
      throw new WauWorkflowError(
        "No fetchImpl provided and global fetch is unavailable. " +
          "Provide options.fetchImpl or run on Node 18+ / browser.",
        WauErrCodeServerError,
        false,
      );
    }
    // Resolve timeoutMs (本 stub 0 使用,但 config 可能在 caller 配置了)
    const _resolvedTimeoutMs =
      options?.timeoutMs ??
      config.timeout_ms ??
      WAU_DEFAULT_TIMEOUT_MS;
    // v1.3.2+ RPC 实装时:const fetchImpl = options?.fetchImpl ?? globalThis.fetch as FetchImpl;
    void _resolvedTimeoutMs;

    this.userAgent = options?.userAgent ?? WAU_DEFAULT_USER_AGENT;
  }

  // ────────────────────────────────────────────────────────
  // 1. registerAgent(per SDK Consumer Contract §二.3)
  //    调 wau-registry 注册 homerail-voice 为 system_ui agent
  //    per #1c: 严格 category=USER_ENTRY + trustExempt=true
  //    失败抛 WauWorkflowError, caller 决定 retry (per #18)
  // ────────────────────────────────────────────────────────

  /**
   * 调 wau-registry 注册 homerail-voice 为 system_ui agent
   * @returns Promise<void> 成功 resolve
   * @throws WauWorkflowError 失败时(per SDK Consumer Contract §二.4 retryable flag)
   */
  registerAgent(_config?: WauClientConfig): Promise<void> {
    // Skeleton stage:throw WauWorkflowError('SERVER_ERROR', retryable: false)
    // 真实 RPC 等 wau-registry endpoint schema 落地后实装
    const msg =
      `WauClient.registerAgent is a v1.3.1 stub. ` +
      `Real RPC pending wau-registry endpoint schema (POST {registry_url}/v1/wau/agents). ` +
      `Caller (e.g. homerail) should treat this as "SDK not ready" and not retry.`;
    return Promise.reject(
      new WauWorkflowError(msg, WauErrCodeServerError, false),
    );
  }

  // ────────────────────────────────────────────────────────
  // 2. heartbeat(per SDK Consumer Contract §二.3)
  //    周期心跳发到 wau-registry(走 wau-edge 不直连 registry, per #15)
  //    caller 控制 schedule(SDK 不内置 timer, 避免 side-effect)
  // ────────────────────────────────────────────────────────

  /**
   * 周期心跳发到 wau-registry(走 wau-edge)
   * 默认按 config.heartbeat_interval_ms 周期, caller 控制 schedule
   * @returns Promise<void> 成功 resolve
   * @throws WauWorkflowError 失败时
   */
  heartbeat(): Promise<void> {
    const msg =
      `WauClient.heartbeat is a v1.3.1 stub. ` +
      `Real RPC pending wau-edge heartbeat schema.`;
    return Promise.reject(
      new WauWorkflowError(msg, WauErrCodeServerError, true),
    );
  }

  // ────────────────────────────────────────────────────────
  // 3. recommendWorkflow(per SDK Consumer Contract §二.3)
  //    调 wau-intent(经 wau-edge)推荐 workflow
  //    per #15: 走 wau-edge 不直连 wau-intent
  //    per #21: 鉴权走 JWT 4-claim (per D66=B)
  //    超时: 默认 30s (config.timeout_ms 覆盖)
  // ────────────────────────────────────────────────────────

  /**
   * 调 wau-intent(经 wau-edge)推荐 workflow
   * 语义: 接收自然语言 query, 返 candidate DAG agents list + dependency_graph
   * @param query 自然语言 query(用户原始 input)
   * @returns Promise<WauWorkflow> 19 字段全 wire (per SDK Consumer Contract §二.2)
   * @throws WauWorkflowError 失败时
   */
  recommendWorkflow(_query: string): Promise<WauWorkflow> {
    const msg =
      `WauClient.recommendWorkflow is a v1.3.1 stub. ` +
      `Real RPC pending wau-edge recommendWorkflow schema (POST {edge_url}/v1/wau/intent/recommend). ` +
      `Returns WauWorkflow with 19 fields per SDK Consumer Contract §二.2.`;
    return Promise.reject(
      new WauWorkflowError(msg, WauErrCodeServerError, true),
    );
  }

  // ────────────────────────────────────────────────────────
  // 4. matchWauPattern(per SDK Consumer Contract §二.3)
  //    推 wau-dag-patterns (per #4 抽象 consumer-side)
  //    接收 query, 返 pattern candidates (可复用 vs 实时生成)
  //    per #15: 走 wau-edge
  // ────────────────────────────────────────────────────────

  /**
   * 推 wau-dag-patterns(per #4 抽象 consumer-side)
   * @param query 自然语言 query
   * @returns Promise<WauWorkflow> 19 字段全 wire
   * @throws WauWorkflowError 失败时
   */
  matchWauPattern(_query: string): Promise<WauWorkflow> {
    const msg =
      `WauClient.matchWauPattern is a v1.3.1 stub. ` +
      `Real RPC pending wau-edge dag-patterns schema (POST {edge_url}/v1/wau/patterns/match).`;
    return Promise.reject(
      new WauWorkflowError(msg, WauErrCodeServerError, true),
    );
  }

  // ────────────────────────────────────────────────────────
  // Internal helpers(为 v1.3.2+ 实装预留,本 stub 阶段 0 使用)
  // ────────────────────────────────────────────────────────

  /**
   * buildAuthHeader: 返回 JWT 4-claim bearer header(per D66=B + #21)
   * @internal v1.3.2+ RPC 实装时用,本 stub 0 暴露
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
   * getEndpointUrl: 拼 endpoint URL(per #15 走 wau-edge)
   * @internal v1.3.2+ RPC 实装时用,本 stub 0 暴露
   */
  protected getEndpointUrl(method: "register" | "heartbeat" | "recommend" | "match"): string {
    // per #15: recommend / match 走 wau-edge,不直连 wau-intent
    // per #1c: register / heartbeat 走 wau-registry(也经 wau-edge? 拍板待定,本 stub 默认直连)
    if (method === "recommend" || method === "match") {
      return `${this.config.edge_url}/v1/wau/intent/${method}`;
    }
    return `${this.config.registry_url}/v1/wau/agents/${method}`;
  }
}