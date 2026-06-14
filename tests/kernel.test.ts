/**
 * KernelService + 装饰器层(auth / retry / transport) 单测
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import * as jwt from "jsonwebtoken";
import { Client, AuthConfig, Role, RetryConfig, CircuitConfig, APIError, UnauthorizedError } from "../src";
import { Transport } from "../src/transport";
import { Signer } from "../src/auth";
import { Retrier, isRetryable } from "../src/retry";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

const TEST_SECRET = "test-secret-32-bytes-long-xxxxx";

describe("KernelService", () => {
  it("info", async () => {
    nock("http://mock:18400")
      .get("/kernel/info")
      .reply(200, {
        version: "v0.6.0", startTime: "2026-06-14T00:00:00Z",
        uptime: 60, agentsCount: 3, tasksCount: 5,
      });

    const c = new Client("http://mock:18400");
    const info = await c.kernel.info();
    expect(info.version).toBe("v0.6.0");
    expect(info.agentsCount).toBe(3);
  });

  it("health", async () => {
    nock("http://mock:18400")
      .get("/health")
      .reply(200, { status: "ok", version: "v0.6.0", uptime: 1.0, redis: "connected" });

    const c = new Client("http://mock:18400");
    const h = await c.kernel.health();
    expect(h.status).toBe("ok");
  });
});

describe("Auth (HS256 + Bearer)", () => {
  it("empty secret throws", () => {
    expect(() => new Signer({ agentName: "x", sharedSecret: "", role: Role.EXTERNAL_AGENT })).toThrow();
  });

  it("empty agentName throws", () => {
    expect(() => new Signer({ agentName: "", sharedSecret: TEST_SECRET, role: Role.EXTERNAL_AGENT })).toThrow();
  });

  it("sign returns 3-segment JWT", () => {
    const s = new Signer({ agentName: "x", sharedSecret: TEST_SECRET, role: Role.EXTERNAL_AGENT });
    const tok = s.sign();
    expect(tok.split(".")).toHaveLength(3);
  });

  it("JWT 5 min expiry + jti uniqueness", () => {
    const s = new Signer({ agentName: "x", sharedSecret: TEST_SECRET, role: Role.EXTERNAL_AGENT });
    const tok = s.sign();
    const decoded = jwt.verify(tok, TEST_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(300);

    // jti uniqueness (10 tokens)
    const jtis = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const t = s.sign();
      const d = jwt.verify(t, TEST_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
      jtis.add(d.jti ?? "");
    }
    expect(jtis.size).toBe(10);
  });

  it("Client WithAuth 注入 Authorization header", async () => {
    let capturedAuth = "";
    nock("http://mock:18400")
      .get("/health")
      .reply(function () {
        capturedAuth = this.req.headers.authorization as string ?? "";
        return [200, { status: "ok", version: "v0.6.0", uptime: 1.0, redis: "connected" }];
      });

    const c = new Client("http://mock:18400", {
      auth: { agentName: "test", sharedSecret: TEST_SECRET, role: Role.TRUSTED_AGENT },
    });
    await c.kernel.health();

    expect(capturedAuth.startsWith("Bearer ")).toBe(true);
  });

  it("Client 无 auth 时 Authorization header 为空", async () => {
    let capturedAuth = "";
    nock("http://mock:18400")
      .get("/health")
      .reply(function () {
        capturedAuth = (this.req.headers.authorization as string) ?? "";
        return [200, { status: "ok", version: "v0.6.0", uptime: 1.0, redis: "connected" }];
      });

    const c = new Client("http://mock:18400");
    await c.kernel.health();
    expect(capturedAuth).toBe("");
  });
});

describe("Retry (isRetryable)", () => {
  it("5xx returns true", () => {
    expect(isRetryable(new APIError(500))).toBe(true);
    expect(isRetryable(new APIError(503))).toBe(true);
  });
  it("429 returns true", () => {
    expect(isRetryable(new APIError(429))).toBe(true);
  });
  it("4xx returns false", () => {
    expect(isRetryable(new APIError(404))).toBe(false);
    expect(isRetryable(new APIError(400))).toBe(false);
  });
  it("network error returns true", () => {
    expect(isRetryable(new Error("dial tcp: connection refused"))).toBe(true);
  });
});

describe("Retry (Retrier)", () => {
  it("MaxRetries=0 只调 1 次", async () => {
    const r = new Retrier({ maxRetries: 0, initialBackoffMs: 1, maxBackoffMs: 1, jitter: 0, retryOn: [500] });
    let calls = 0;
    await expect(r.do(async () => {
      calls++;
      throw new APIError(500);
    })).rejects.toThrow(APIError);
    expect(calls).toBe(1);
  });

  it("4xx 不重试", async () => {
    const r = new Retrier({ maxRetries: 3, initialBackoffMs: 1, maxBackoffMs: 1, jitter: 0, retryOn: [500] });
    let calls = 0;
    await expect(r.do(async () => {
      calls++;
      throw new APIError(404);
    })).rejects.toThrow(APIError);
    expect(calls).toBe(1);
  });

  it("5xx 重试 + 成功", async () => {
    const r = new Retrier({ maxRetries: 3, initialBackoffMs: 1, maxBackoffMs: 1, jitter: 0, retryOn: [500] });
    let calls = 0;
    const result = await r.do(async () => {
      calls++;
      if (calls < 3) throw new APIError(502);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });
});

describe("Transport", () => {
  it("Transport 4xx 翻译为 APIError 子类", async () => {
    nock("http://mock:18400")
      .get("/registry/agents/ghost/status")
      .reply(404, { error: "agent not found", code: "not_found" });

    const t = new Transport("http://mock:18400", {});
    await expect(
      t.request("GET", "/registry/agents/ghost/status")
    ).rejects.toMatchObject({ statusCode: 404, code: "not_found" });
  });

  it("Transport 401 → UnauthorizedError", async () => {
    nock("http://mock:18400")
      .get("/kernel/info")
      .reply(401, { error: "invalid token", code: "unauthorized" });

    const t = new Transport("http://mock:18400", {});
    await expect(t.request("GET", "/kernel/info")).rejects.toThrow(UnauthorizedError);
  });

  it("User-Agent 含 SDK 版本", async () => {
    let capturedUA = "";
    nock("http://mock:18400")
      .get("/health")
      .reply(function () {
        capturedUA = (this.req.headers["user-agent"] as string) ?? "";
        return [200, { status: "ok", version: "v0.6.0", uptime: 1.0, redis: "connected" }];
      });

    const t = new Transport("http://mock:18400", {});
    await t.request("GET", "/health");
    expect(capturedUA).toContain("wau-typescript-sdk");
    expect(capturedUA).toContain("0.6.0-preview.1");
  });
});
