/**
 * Client + IntentService 单测
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { Client, NotImplementedError, Role } from "../src";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

describe("Client 主类", () => {
  it("默认 base URL (空字符串 fallback)", () => {
    const c = new Client("");
    expect(c.baseURL).toBe("http://localhost:18400");
  });

  it("circuitState 默认 closed (无 circuit 配置)", () => {
    const c = new Client("http://mock");
    expect(c.circuitState()).toBe("closed");
  });

  it("circuitState enabled 初始化 closed", () => {
    const c = new Client("http://mock", {
      circuit: { failureThreshold: 5, openTimeoutMs: 30_000, halfOpenMax: 1, enabled: true },
    });
    expect(c.circuitState()).toBe("closed");
  });

  it("WithAuth 创建 client", () => {
    const c = new Client("http://mock", {
      auth: {
        agentName: "test",
        tenantId: "test-tenant", // Stage 3.1 #1:必填
        sharedSecret: "secret",
        role: Role.TRUSTED_AGENT,
      },
    });
    expect(c.baseURL).toBe("http://mock");
  });
});

describe("IntentService (2026-11-19:从 gRPC stub 改成实装 HTTP)", () => {
  // ★ 2026-11-19:intent 不再是 stub ⇒ 不再抛 NotImplementedError。
  // mock-kernel 不可达 ⇒ 抛的是连接/重试错误。

  it("recommend 不再抛 NotImplementedError", async () => {
    const c = new Client("http://mock");
    await expect(c.intent.recommend("test", 3)).rejects.not.toThrow(NotImplementedError);
  });

  it("parseIntent 不再抛 NotImplementedError", async () => {
    const c = new Client("http://mock");
    await expect(c.intent.parseIntent("test")).rejects.not.toThrow(NotImplementedError);
  });

  it("listAgents 不再抛 NotImplementedError", async () => {
    const c = new Client("http://mock");
    await expect(c.intent.listAgents(true)).rejects.not.toThrow(NotImplementedError);
  });
});
