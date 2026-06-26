/**
 * v0.8.0 M5-1 B.1 — HandshakeService 单测(nock mock kernel)
 *
 * 6 case(per plan §B.3):
 *   1. happy path(createSession 返 reused=false)
 *   2. reuse hit(同 key 二次调 返 reused=true, sessionId 一致)
 *   3. agent not found(-32002 → HandshakeAgentNotFoundError)
 *   4. tenant mismatch(-32003 via getSession → HandshakeTenantMismatchError)
 *   5. invalid request(-32600 → HandshakeInvalidRequestError)
 *   6. stats endpoint(返回 total_sessions/reuses/hit_rate)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import {
  Client,
  HandshakeRequest,
  HandshakeAgentNotFoundError,
  HandshakeInvalidRequestError,
  HandshakeTenantMismatchError,
} from "../src";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

// ============== Case 1:happy path ==============

describe("HandshakeService.createSession", () => {
  it("happy path: 首次创建, reused=false", async () => {
    nock("http://mock:18400")
      .post("/v0.8.0/handshake/sessions")
      .reply(200, {
        session_id: "sess-ts-1",
        direct_endpoint: "http://benny.local:18800",
        protocol: "a2a",
        expires_at: "2026-06-26T20:00:00Z",
        ttl_seconds: 300,
        reused: false,
      });

    const c = new Client("http://mock:18400");
    const resp = await c.handshake.createSession(
      new HandshakeRequest("tenant-A", "Benny")
    );
    expect(resp.sessionId).toBe("sess-ts-1");
    expect(resp.directEndpoint).toBe("http://benny.local:18800");
    expect(resp.protocol).toBe("a2a");
    expect(resp.ttlSeconds).toBe(300);
    expect(resp.reused).toBe(false);
  });
});

// ============== Case 2:reuse hit ==============

describe("HandshakeService.reuse", () => {
  it("同 key 再调, 返 reused=true, sessionId 一致", async () => {
    nock("http://mock:18400")
      .post("/v0.8.0/handshake/sessions")
      .reply(200, {
        session_id: "sess-ts-reuse",
        direct_endpoint: "http://benny.local:18800",
        protocol: "a2a",
        expires_at: "2026-06-26T20:00:00Z",
        ttl_seconds: 300,
        reused: false,
      })
      .post("/v0.8.0/handshake/sessions")
      .reply(200, {
        session_id: "sess-ts-reuse",
        direct_endpoint: "http://benny.local:18800",
        protocol: "a2a",
        expires_at: "2026-06-26T20:00:00Z",
        ttl_seconds: 300,
        reused: true,
      });

    const c = new Client("http://mock:18400");
    const r1 = await c.handshake.createSession(new HandshakeRequest("tenant-A", "Benny"));
    const r2 = await c.handshake.createSession(new HandshakeRequest("tenant-A", "Benny"));
    expect(r1.sessionId).toBe(r2.sessionId);
    expect(r1.reused).toBe(false);
    expect(r2.reused).toBe(true);
  });
});

// ============== Case 3:agent not found ==============

describe("HandshakeService error mapping", () => {
  it("-32002 → HandshakeAgentNotFoundError", async () => {
    nock("http://mock:18400")
      .post("/v0.8.0/handshake/sessions")
      .reply(404, {
        error: { code: -32002, message: "agent not found in registry" },
      });

    const c = new Client("http://mock:18400");
    await expect(
      c.handshake.createSession(new HandshakeRequest("tenant-A", "GhostAgent"))
    ).rejects.toThrow(HandshakeAgentNotFoundError);
  });
});

// ============== Case 4:tenant mismatch (via getSession) ==============

describe("HandshakeService.getSession", () => {
  it("-32003 → HandshakeTenantMismatchError", async () => {
    nock("http://mock:18400")
      .get("/v0.8.0/handshake/sessions/wrong-tenant-sess")
      .query({ tenant_id: "tenant-B" })
      .reply(403, {
        error: { code: -32003, message: "tenant does not own this session" },
      });

    const c = new Client("http://mock:18400");
    await expect(
      c.handshake.getSession("wrong-tenant-sess", "tenant-B")
    ).rejects.toThrow(HandshakeTenantMismatchError);
  });
});

// ============== Case 5:invalid request ==============

describe("HandshakeService invalid request", () => {
  it("-32600 → HandshakeInvalidRequestError", async () => {
    nock("http://mock:18400")
      .post("/v0.8.0/handshake/sessions")
      .reply(400, {
        error: { code: -32600, message: "missing required fields" },
      });

    const c = new Client("http://mock:18400");
    await expect(
      c.handshake.createSession(new HandshakeRequest("tenant-A", ""))
    ).rejects.toThrow(HandshakeInvalidRequestError);
  });
});

// ============== Case 6:stats endpoint ==============

describe("HandshakeService.getStats", () => {
  it("返回 total_sessions/reuses/hit_rate", async () => {
    nock("http://mock:18400")
      .get("/admin/handshake/stats")
      .reply(200, {
        total_sessions: 1,
        total_reuses: 4,
        reuse_hit_rate: 0.8,
        active_sessions: 1,
      });

    const c = new Client("http://mock:18400");
    const stats = await c.handshake.getStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalReuses).toBe(4);
    expect(stats.reuseHitRate).toBeCloseTo(0.8);
    expect(stats.activeSessions).toBe(1);
  });
});
