/**
 * Wau client 单测 (wau-typescript-sdk v1.3.1, per v1.0.1 Phase 0 拍板 + SDK Consumer Contract §二).
 *
 * 镜像 wau-go-sdk / wau-python-sdk / wau-rust-sdk / wau-java-sdk 5 SDK byte-equal 测试模式 (per D78).
 *
 * 覆盖矩阵 (8 测试):
 *   1. constructor: default fetch (Node 18+)
 *   2. constructor: missing fetch → throw WauWorkflowError
 *   3. constructor: custom fetchImpl 注入
 *   4. registerAgent: throw WauWorkflowError('SERVER_ERROR', retryable=false) — caller 不 retry
 *   5. heartbeat: throw WauWorkflowError('SERVER_ERROR', retryable=true) — caller 可 retry
 *   6. recommendWorkflow: throw WauWorkflowError('SERVER_ERROR', retryable=true)
 *   7. matchWauPattern: throw WauWorkflowError('SERVER_ERROR', retryable=true)
 *   8. WauWorkflowError: retryable flag by code (per #22 失败回退)
 *
 * 镜像 src/ucp/tests 模式:fetchImpl 注入做 in-process mock, 不依赖 nock.
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
  WauErrCodeNetworkError,
  WAU_DEFAULT_USER_AGENT,
  WAU_DEFAULT_TIMEOUT_MS,
  WAU_DEFAULT_HEARTBEAT_INTERVAL_MS,
  type WauClientConfig,
  type WauClientOptions,
  type WauWorkflow,
  type WauWorkflowErrorCode,
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
    ],
    trust_exempt: true,
  },
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
  // 9 optional / metadata / auth fields per SDK Consumer Contract §二.2
  original_query: "find me aspirin",
  server_version: "1.3.1",
  trace_id: "t-1",
  ttl_ms: 60000,
  auth_user_id: "u-1",
  auth_claim_set: ["sub", "aud", "exp", "scope"],
};

/** Mock fetchImpl (测试用, 不发真实 HTTP) */
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
});

// ────────────────────────────────────────────────────────
// Test 1: constructor default fetch (Node 18+)
// ────────────────────────────────────────────────────────

describe("WauClient constructor", () => {
  it("uses default fetchImpl (Node 18+ global fetch)", () => {
    const client = new WauClient(sampleConfig);
    expect(client).toBeInstanceOf(WauClient);
  });

  // ────────────────────────────────────────────────────────
  // Test 2: constructor: missing fetch → throw WauWorkflowError
  // ────────────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────
  // Test 3: constructor: custom fetchImpl 注入
  // ────────────────────────────────────────────────────────

  it("accepts custom fetchImpl injection", () => {
    const options: WauClientOptions = {
      fetchImpl: mockFetch as unknown as WauClientOptions["fetchImpl"],
    };
    const client = new WauClient(sampleConfig, options);
    expect(client).toBeInstanceOf(WauClient);
  });
});

// ────────────────────────────────────────────────────────
// Test 4-7: 4 method skeleton throws
// ────────────────────────────────────────────────────────

describe("WauClient 4 method skeleton (v1.3.1 stub)", () => {
  const client = new WauClient(sampleConfig, {
    fetchImpl: mockFetch as unknown as WauClientOptions["fetchImpl"],
  });

  // Test 4: registerAgent — retryable=false (per #22 失败回退, caller 不 retry)
  it("registerAgent rejects with WauWorkflowError(retryable=false)", async () => {
    await expect(client.registerAgent()).rejects.toThrow(WauWorkflowError);
    await expect(client.registerAgent()).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: false,
    });
  });

  // Test 5: heartbeat — retryable=true
  it("heartbeat rejects with WauWorkflowError(retryable=true)", async () => {
    await expect(client.heartbeat()).rejects.toThrow(WauWorkflowError);
    await expect(client.heartbeat()).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: true,
    });
  });

  // Test 6: recommendWorkflow — retryable=true
  it("recommendWorkflow rejects with WauWorkflowError(retryable=true)", async () => {
    await expect(
      client.recommendWorkflow("find me aspirin"),
    ).rejects.toThrow(WauWorkflowError);
    await expect(
      client.recommendWorkflow("find me aspirin"),
    ).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: true,
    });
  });

  // Test 7: matchWauPattern — retryable=true
  it("matchWauPattern rejects with WauWorkflowError(retryable=true)", async () => {
    await expect(
      client.matchWauPattern("find me aspirin"),
    ).rejects.toThrow(WauWorkflowError);
    await expect(
      client.matchWauPattern("find me aspirin"),
    ).rejects.toMatchObject({
      code: WauErrCodeServerError,
      retryable: true,
    });
  });
});

// ────────────────────────────────────────────────────────
// Test 8: WauWorkflowError retryable flag (per #22)
// ────────────────────────────────────────────────────────

describe("WauWorkflowError retryable (per #22 失败回退)", () => {
  it("TIMEOUT is retryable=true", () => {
    const err = new WauWorkflowError("timeout", WauErrCodeTimeout);
    expect(err.retryable).toBe(true);
    expect(isWauRetryable(err)).toBe(true);
  });

  it("AUTH_FAILED is retryable=false", () => {
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
// Sample workflow sanity (per SDK Consumer Contract §二.2 type shape)
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
    expect(sampleWorkflow.server_version).toBe("1.3.1");
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
// Default constants
// ────────────────────────────────────────────────────────

describe("Wau default constants", () => {
  it("WAU_DEFAULT_USER_AGENT is v1.3.1", () => {
    expect(WAU_DEFAULT_USER_AGENT).toBe("wau-typescript-sdk/wau/v1.3.1");
  });

  it("WAU_DEFAULT_TIMEOUT_MS is 30000", () => {
    expect(WAU_DEFAULT_TIMEOUT_MS).toBe(30000);
  });

  it("WAU_DEFAULT_HEARTBEAT_INTERVAL_MS is 30000", () => {
    expect(WAU_DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30000);
  });
});