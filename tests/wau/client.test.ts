/**
 * Wau client 单测 (wau-typescript-sdk v1.3.2, per WAU-develop log wau-homerail/homerail-end.md §三.1).
 *
 * ⭐ v1.3.2 — full RPC unlock (per wau-edge Phase 2/3 + wau-registry Phase 1 /v1 alias)
 * 4 method endpoint paths:
 *   - registerAgent   POST {registry_url}/v1/agents
 *   - heartbeat       POST {registry_url}/v1/agents/heartbeat
 *   - recommendWorkflow POST {edge_url}/v1/recommend
 *   - matchWauPattern   POST {edge_url}/v1/patterns/match (stub 501 等 wau-dag-patterns 仓)
 *
 * 覆盖矩阵 (16 测试):
 *   - 3 constructor: default fetch / no fetch throw / custom fetchImpl
 *   - 4 method happy path: status 200/204 → 返 WauWorkflow / void
 *   - 4 method error mapping: 401/400/404/501/5xx → 返 WauWorkflowError(retryable)
 *   - 1 method network/timeout → WauWorkflowError(NETWORK_ERROR / TIMEOUT, retryable=true)
 *   - 1 endpoint URL 验证(拼接各 method URL 正确)
 *   - 1 WAU_DEFAULT_USER_AGENT 是 v1.3.2
 *   - 2 default constants check
 *   - 4 sample workflow fixture sanity
 *
 * Mock fetchImpl (in-process),不依赖 nock 跟 global fetch。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WauClient,
  WauWorkflowError,
  isWauRetryable,
  asWauWorkflowError,
  WauErrCodeServerError,
  WauErrCodeTimeout,
  WauErrCodeAuthFailed,
  WauErrCodeInvalidWorkflowType,
  WauErrCodeNetworkError,
  WAU_DEFAULT_USER_AGENT,
  WAU_DEFAULT_TIMEOUT_MS,
  WAU_DEFAULT_HEARTBEAT_INTERVAL_MS,
  type WauClientConfig,
  type WauClientOptions,
  type WauWorkflow,
  type FetchImpl,
} from "../../src/wau";

// ────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────

const sampleConfig: WauClientConfig = {
  registry_url: "http://localhost:18401",
  intent_url: "http://localhost:18402",
  edge_url: "http://localhost:18403",
  heartbeat_interval_ms: 30000,
  dag_patterns_path: "assets/orchestrations/wau-dag-patterns/",
  system_capability: {
    category: "USER_ENTRY",
    sub_capabilities: [
      { name: "voice-asr", version: "1.0", description: "ASR" },
      { name: "voice-tts", version: "1.0", description: "TTS" },
      { name: "dag-orchestration", version: "1.0", description: "DAG plan" },
    ],
    trust_exempt: true,
  },
  auth_token: "test-jwt-4-claims", // per D66=B + #21 (snake_case #14 A)
};

const sampleWorkflow: WauWorkflow = {
  agents: [
    { name: "medical-classifier", url: "http://a", skills: [], confidence: 0.9 },
    { name: "aspirin-routing", url: "http://b", skills: [], confidence: 0.8 },
  ],
  dependency_graph: {
    dependencies: {
      "aspirin-routing": { upstream_agents: ["medical-classifier"] },
    },
  },
  confidence: 0.85,
  workflow_type: "WORKFLOW_TYPE_CHAIN",
  harness: "codex-appserver",
  workflow_id: "wf-1",
  created_at: 0,
  user_id: "u-1",
  original_query: "find me aspirin",
  server_version: "1.3.2",
  trace_id: "t-1",
  ttl_ms: 60000,
  auth_user_id: "u-1",
  auth_claim_set: ["sub", "aud", "exp", "scope"],
};

/**
 * 工厂:mock response 工厂函数
 */
function makeResponse(status: number, body?: unknown): {
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
} {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    text: async () => text,
    json: async () => body,
  };
}

/** Mock fetchImpl (test 用 mock function, 不发真实 HTTP) */
const mockFetch = vi.fn() as unknown as FetchImpl;

beforeEach(() => {
  (mockFetch as unknown as ReturnType<typeof vi.fn>).mockReset();
});

// ────────────────────────────────────────────────────────
// Constructor tests
// ────────────────────────────────────────────────────────

describe("WauClient constructor", () => {
  it("uses default fetchImpl (Node 18+ global fetch)", () => {
    const client = new WauClient(sampleConfig);
    expect(client).toBeInstanceOf(WauClient);
  });

  it("throws WauWorkflowError if no fetchImpl and no global fetch", () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error - intentionally delete global fetch to simulate Node <18
    delete globalThis.fetch;
    try {
      expect(() => new WauClient(sampleConfig)).toThrow(WauWorkflowError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts custom fetchImpl injection", () => {
    const options: WauClientOptions = {
      fetchImpl: mockFetch,
    };
    const client = new WauClient(sampleConfig, options);
    expect(client).toBeInstanceOf(WauClient);
  });
});

// ────────────────────────────────────────────────────────
// 4 method happy path
// ────────────────────────────────────────────────────────

describe("WauClient 4 method happy path (v1.3.2 RPC)", () => {
  const client = new WauClient(sampleConfig, {
    fetchImpl: mockFetch,
  });

  it("registerAgent POSTs to /v1/agents with 204 → resolves void", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(204),
    );

    await expect(client.registerAgent()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:18401/v1/agents");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer test-jwt-4-claims");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body).name).toBe("homerail-voice");
    expect(JSON.parse(init.body).skills).toEqual([
      "voice-asr",
      "voice-tts",
      "dag-orchestration",
    ]);
  });

  it("heartbeat POSTs to /v1/agents/heartbeat with 204 → resolves void", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(204),
    );

    await expect(client.heartbeat()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:18401/v1/agents/heartbeat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).name).toBe("homerail-voice");
  });

  it("recommendWorkflow POSTs to /v1/recommend with 200 → returns WauWorkflow", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(200, sampleWorkflow),
    );

    const wf = await client.recommendWorkflow("find me aspirin");
    expect(wf).toEqual(sampleWorkflow);

    const [url, init] = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:18403/v1/recommend");
    expect(JSON.parse(init.body)).toEqual({
      query: "find me aspirin",
      top_k: 3,
      online_only: false,
    });
  });

  it("matchWauPattern POSTs to /v1/patterns/match; 200 returns WauWorkflow, 501 throws WauWorkflowError(SERVER_ERROR, retryable=false)", async () => {
    // 200 path: future when wau-dag-patterns ships
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(200, sampleWorkflow),
    );
    const wf = await client.matchWauPattern("find me aspirin");
    expect(wf).toEqual(sampleWorkflow);

    // 501 path: current stub
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(501, {
        error: "patterns/match not implemented",
        reason: "wau-dag-patterns repo TBD",
      }),
    );
    await expect(client.matchWauPattern("find me aspirin")).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: false,
    });

    // verify endpoint URL once
    const calls = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("http://localhost:18403/v1/patterns/match");
    expect(calls[1][0]).toBe("http://localhost:18403/v1/patterns/match");
  });
});

// ────────────────────────────────────────────────────────
// Error mapping (per #22 失败回退 + D78 byte-equal)
// ────────────────────────────────────────────────────────

describe("WauClient HTTP error mapping (v1.3.2)", () => {
  const client = new WauClient(sampleConfig, { fetchImpl: mockFetch });

  it("401 → WauWorkflowError(AUTH_FAILED, retryable=true)", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(401, { error: "unauthorized" }),
    );
    await expect(client.recommendWorkflow("q")).rejects.toMatchObject({
      code: WauErrCodeAuthFailed,
      retryable: true,
    });
  });

  it("400 → WauWorkflowError(INVALID_WORKFLOW_TYPE, retryable=false)", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(400, { error: "bad request" }),
    );
    await expect(client.recommendWorkflow("q")).rejects.toMatchObject({
      code: WauErrCodeInvalidWorkflowType,
      retryable: false,
    });
  });

  it("404 → WauWorkflowError(SERVER_ERROR, retryable=false)", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(404, { error: "not found" }),
    );
    await expect(client.recommendWorkflow("q")).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: false,
    });
  });

  it("500 → WauWorkflowError(SERVER_ERROR, retryable=true)", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(500, { error: "internal" }),
    );
    await expect(client.recommendWorkflow("q")).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: true,
    });
  });

  it("503 → WauWorkflowError(SERVER_ERROR, retryable=true)", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(503, { error: "service unavailable" }),
    );
    await expect(client.recommendWorkflow("q")).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: true,
    });
  });

  it("network error → WauWorkflowError(NETWORK_ERROR, retryable=true)", async () => {
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    await expect(client.recommendWorkflow("q")).rejects.toMatchObject({
      code: WauErrCodeNetworkError,
      retryable: true,
    });
  });
});

// ────────────────────────────────────────────────────────
// WauWorkflowError retryable flag (per #22)
// ────────────────────────────────────────────────────────

describe("WauWorkflowError retryable (per #22 失败回退)", () => {
  it("TIMEOUT is retryable=true", () => {
    const err = new WauWorkflowError("timeout", WauErrCodeTimeout);
    expect(err.retryable).toBe(true);
    expect(isWauRetryable(err)).toBe(true);
  });

  it("AUTH_FAILED is retryable=false (per caller policy)", () => {
    const err = new WauWorkflowError("auth", WauErrCodeAuthFailed);
    expect(err.retryable).toBe(false);
    expect(isWauRetryable(err)).toBe(false);
  });

  it("NETWORK_ERROR is retryable=true", () => {
    const err = new WauWorkflowError("network", WauErrCodeNetworkError);
    expect(err.retryable).toBe(true);
    expect(isWauRetryable(err)).toBe(true);
  });

  it("asWauWorkflowError returns null for non-WauWorkflowError", () => {
    expect(asWauWorkflowError(new Error("not wau"))).toBeNull();
    expect(asWauWorkflowError("string error")).toBeNull();
    expect(asWauWorkflowError(null)).toBeNull();
  });

  it("asWauWorkflowError returns the error for WauWorkflowError", () => {
    const err = new WauWorkflowError("test", WauErrCodeTimeout);
    expect(asWauWorkflowError(err)).toBe(err);
  });
});

// ────────────────────────────────────────────────────────
// Sample workflow fixture (per SDK Consumer Contract §二.2 type shape)
// ────────────────────────────────────────────────────────

describe("WauWorkflow sample fixture (19 fields shape)", () => {
  it("sample workflow has all 5 必填 fields", () => {
    expect(sampleWorkflow.agents).toHaveLength(2);
    expect(sampleWorkflow.dependency_graph.dependencies).toBeDefined();
    expect(sampleWorkflow.confidence).toBe(0.85);
    expect(sampleWorkflow.workflow_type).toBe("WORKFLOW_TYPE_CHAIN");
    expect(sampleWorkflow.harness).toBe("codex-appserver");
  });

  it("sample workflow has 3 标识 fields", () => {
    expect(sampleWorkflow.workflow_id).toBe("wf-1");
    expect(sampleWorkflow.created_at).toBe(0);
    expect(sampleWorkflow.user_id).toBe("u-1");
  });

  it("sample workflow has 6 metadata / auth fields", () => {
    expect(sampleWorkflow.original_query).toBe("find me aspirin");
    expect(sampleWorkflow.server_version).toBe("1.3.2");
    expect(sampleWorkflow.trace_id).toBe("t-1");
    expect(sampleWorkflow.ttl_ms).toBe(60000);
    expect(sampleWorkflow.auth_user_id).toBe("u-1");
    expect(sampleWorkflow.auth_claim_set).toEqual([
      "sub",
      "aud",
      "exp",
      "scope",
    ]);
  });
});

// ────────────────────────────────────────────────────────
// Default constants (per SDK Consumer Contract §二.1)
// ────────────────────────────────────────────────────────

describe("Wau default constants", () => {
  it("WAU_DEFAULT_USER_AGENT is v1.3.2", () => {
    expect(WAU_DEFAULT_USER_AGENT).toBe("wau-typescript-sdk/wau/v1.3.2");
  });

  it("WAU_DEFAULT_TIMEOUT_MS is 30000", () => {
    expect(WAU_DEFAULT_TIMEOUT_MS).toBe(30000);
  });

  it("WAU_DEFAULT_HEARTBEAT_INTERVAL_MS is 30000", () => {
    expect(WAU_DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30000);
  });
});