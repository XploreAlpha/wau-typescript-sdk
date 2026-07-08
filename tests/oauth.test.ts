/**
 * OAuth Client Credentials test(2026-07-10 M2 OAuth Day 4)
 *
 * 0 改动既有 client.ts / transport.ts / auth.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OAuthClient, RefreshableTokenStore } from "../src/oauth";

interface CallRecord {
  url: string;
  body: string;
}

/** 创建 mock fetch(每次返 {prefix}-{n}) */
function makeMockFetch(tokenPrefix: string, expiresIn: number) {
  let count = 0;
  const calls: CallRecord[] = [];
  const fetchImpl: typeof fetch = async (url: any, init?: any) => {
    count += 1;
    calls.push({ url: String(url), body: String(init?.body || "") });
    const body = JSON.stringify({
      access_token: `${tokenPrefix}-${count}`,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: `refresh-${tokenPrefix}-${count}`,
      scope: "read:agents",
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, get count() { return count; }, calls };
}

describe("OAuthClient", () => {
  it("validates required fields", () => {
    expect(() => new OAuthClient({ endpoint: "x", clientId: "", clientSecret: "y" } as any))
      .toThrowError(/clientId/);
    expect(() => new OAuthClient({ endpoint: "x", clientId: "x", clientSecret: "" } as any))
      .toThrowError(/clientSecret/);
    expect(() => new OAuthClient({ endpoint: "", clientId: "x", clientSecret: "y" } as any))
      .toThrowError(/endpoint/);
  });

  it("clientCredentials() succeeds and returns access_token", async () => {
    const m = makeMockFetch("ts-tok", 3600);
    const oc = new OAuthClient({
      endpoint: "http://test/oauth/token",
      clientId: "cid",
      clientSecret: "sec",
      scope: "read:agents",
      fetchImpl: m.fetchImpl,
    });
    const store = await oc.clientCredentials();
    expect(store).toBeInstanceOf(RefreshableTokenStore);
    expect(await store.token()).toBe("ts-tok-1");
    expect(m.count).toBe(1);
    // 校验请求体
    expect(m.calls[0].body).toContain("grant_type=client_credentials");
    expect(m.calls[0].body).toContain("client_id=cid");
  });

  it("authorizationHeader() returns 'Bearer {token}'", async () => {
    const m = makeMockFetch("hdr-tok", 3600);
    const oc = new OAuthClient({
      endpoint: "http://x", clientId: "c", clientSecret: "s", fetchImpl: m.fetchImpl,
    });
    const store = await oc.clientCredentials();
    expect(await store.authorizationHeader()).toBe("Bearer hdr-tok-1");
  });

  it("auto-refresh on expiry", async () => {
    const m = makeMockFetch("refresh-tok", 2); // 2s
    const oc = new OAuthClient({
      endpoint: "http://x", clientId: "c", clientSecret: "s",
      refreshSkewSeconds: 1, fetchImpl: m.fetchImpl,
    });
    const store = await oc.clientCredentials();
    const t1 = await store.token();
    expect(t1).toBe("refresh-tok-1");
    await new Promise((r) => setTimeout(r, 2500)); // wait expiry
    const t2 = await store.token();
    expect(t2).not.toBe("refresh-tok-1");
    expect(m.count).toBeGreaterThanOrEqual(2);
  });

  it("no refresh before expiry", async () => {
    const m = makeMockFetch("long-tok", 3600);
    const oc = new OAuthClient({
      endpoint: "http://x", clientId: "c", clientSecret: "s", fetchImpl: m.fetchImpl,
    });
    const store = await oc.clientCredentials();
    for (let i = 0; i < 5; i++) {
      await store.token();
    }
    expect(m.count).toBe(1);
  });

  it("concurrent token() calls do not trigger multi-refresh", async () => {
    const m = makeMockFetch("concurrent-tok", 3600);
    const oc = new OAuthClient({
      endpoint: "http://x", clientId: "c", clientSecret: "s", fetchImpl: m.fetchImpl,
    });
    const store = await oc.clientCredentials();
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => store.token()),
    );
    expect(tokens).toHaveLength(10);
    // 不应 panic,所有 token 都合法
    tokens.forEach((t) => expect(t).toMatch(/^concurrent-tok-\d+$/));
    expect(m.count).toBe(1);
  });
});

describe("0-impact on existing SDK", () => {
  it("can still import existing modules", async () => {
    const { Client } = await import("../src/client");
    const { Signer } = await import("../src/auth");
    const { Transport } = await import("../src/transport");
    expect(Client).toBeDefined();
    expect(Signer).toBeDefined();
    expect(Transport).toBeDefined();
  });
});