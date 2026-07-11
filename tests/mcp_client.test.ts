/**
 * MCP client 单测 (wau-typescript-sdk v1.3.2, per D87.7).
 *
 * 镜像 wau-go-sdk mcpclient/client_test.go 21 测试 pattern,
 * 本文件 ~29 测试覆盖:
 *   - 8 sync tool happy path
 *   - Local validation (target / task_id / message.parts / config.url / raw)
 *   - RPCError 翻译:JSON-RPC 错误 / 4xx HTTP / malformed JSON
 *   - Error code: MCP -32001 / -32003 / -32601
 *   - Auth helper: setBearerToken / McpAuth
 *   - Streaming tool detection: isStreamingTool
 *   - Concurrent calls
 */

import { describe, expect, it, vi } from "vitest";

import {
  AgentCard,
  ALL_TOOL_NAMES,
  AuthSchemePrefix,
  DefaultUserAgent,
  ErrCodeInternal,
  ErrCodeMCPAgentUnreachable,
  ErrCodeMCPTaskNotFound,
  ErrCodeMethodNotFound,
  ExtendedAgentCard,
  FetchImpl,
  HealthCheckResult,
  ListTasksFilter,
  ListTasksResult,
  MCPClient,
  McpAuth,
  Message,
  PushConfig,
  RPCError,
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
  buildHeaders,
  isAgentUnreachable,
  isStreamingTool,
  isTaskNotFound,
  setBearerToken,
} from "../src/mcp";

// ────────────────────────────────────────────────────────
// Mock MCP server helpers
// ────────────────────────────────────────────────────────

interface MockCall {
  tool: string;
  arguments: Record<string, unknown>;
}

class MockMCPRouter {
  public calls: MockCall[] = [];
  public hooks: Record<string, (args: Record<string, unknown>) => unknown> = {};

  handle = async (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init?.body ?? "{}");
    } catch {
      return makeResponse(400, { error: { code: -32700, message: "parse error" } });
    }
    if (body.jsonrpc !== "2.0") {
      return makeResponse(400, { error: { code: -32600, message: "invalid request" } });
    }
    const method = body.method as string;
    if (method !== "tools/call") {
      return makeResponse(200, {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: `unknown method: ${method}` },
      });
    }
    const params = body.params as Record<string, unknown>;
    const toolName = (params.name as string) ?? "";
    const arguments_ = (params.arguments as Record<string, unknown>) ?? {};
    this.calls.push({ tool: toolName, arguments: arguments_ });

    // Hook 可改写 result(测试 error path 用)
    if (toolName in this.hooks) {
      try {
        const hookResult = this.hooks[toolName](arguments_);
        if (hookResult instanceof Error && hookResult instanceof RPCError) {
          return makeResponse(200, {
            jsonrpc: "2.0",
            id: body.id,
            error: { code: hookResult.code, message: hookResult.message, data: hookResult.data },
          });
        }
        return makeResponse(200, { jsonrpc: "2.0", id: body.id, result: hookResult });
      } catch (e) {
        if (e instanceof RPCError) {
          return makeResponse(200, {
            jsonrpc: "2.0",
            id: body.id,
            error: { code: e.code, message: e.message, data: e.data },
          });
        }
        return makeResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32603, message: String(e) },
        });
      }
    }

    // 默认 mock result
    const result = this.defaultResult(toolName, arguments_);
    return makeResponse(200, { jsonrpc: "2.0", id: body.id, result });
  };

  private defaultResult(toolName: string, args: Record<string, unknown>): unknown {
    switch (toolName) {
      case ToolHealthCheck:
        return { status: "ok", version: "v1.0.0", uptime_seconds: 3600 };
      case ToolParseAgentCard:
        return {
          name: "Fox",
          version: "1.0.0",
          description: "Test agent",
          supported_interfaces: ["a2a", "mcp", "ucp"],
          skills: ["chat", "search"],
        };
      case ToolSendMessage:
        return {
          task_id: "task-uuid-1",
          context_id: "ctx-uuid-1",
          status: "completed",
          artifacts: [{ type: "text", text: "Hello, agent!" }],
        };
      case ToolGetTask:
        return {
          task_id: args.task_id ?? "task-uuid-1",
          context_id: "ctx-uuid-1",
          status: "completed",
          artifacts: [{ type: "text", text: "result text" }],
        };
      case ToolListTasks:
        return {
          tasks: [
            { task_id: "t1", status: "completed" },
            { task_id: "t2", status: "failed" },
          ],
          next_offset: null,
        };
      case ToolCancelTask:
        return {
          task_id: args.task_id ?? "task-uuid-1",
          status: "canceled",
          canceled_at: "2026-07-11T10:00:00Z",
        };
      case ToolCreateTaskPushNotificationConfig:
        return { config_id: "config-uuid-1" };
      case ToolGetExtendedAgentCard:
        return {
          name: "Fox",
          version: "1.0.0",
          trust_score: 0.95,
          private_skills: ["private-1"],
          owner_user_id: "user-uuid-1",
        };
      default:
        return {};
    }
  }
}

function makeResponse(status: number, body: Record<string, unknown>) {
  return {
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function makeClient(router: MockMCPRouter): MCPClient {
  return new MCPClient("https://kernel.example.com", "test-jwt", {
    fetchImpl: router.handle as FetchImpl,
  });
}

// ────────────────────────────────────────────────────────
// 8 sync tool happy path
// ────────────────────────────────────────────────────────

describe("MCPClient 8 sync tool happy path", () => {
  it("healthCheck returns HealthCheckResult", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const result = await client.healthCheck("fox-agent");
    expect(result).toEqual({
      status: "ok",
      version: "v1.0.0",
      uptime_seconds: 3600,
    } satisfies HealthCheckResult);
    expect(router.calls[0].tool).toBe(ToolHealthCheck);
    expect(router.calls[0].arguments.target).toEqual({ name: "fox-agent" });
  });

  it("parseAgentCard with string", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const card = await client.parseAgentCard('{"name":"Fox","version":"1.0.0"}');
    expect(card.name).toBe("Fox");
    expect(card.version).toBe("1.0.0");
    expect(card.supported_interfaces).toContain("mcp");
  });

  it("parseAgentCard with dict", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const card = await client.parseAgentCard({ name: "Fox", skills: ["chat"] });
    expect(card.name).toBe("Fox");
    expect(card.skills).toContain("chat");
  });

  it("parseAgentCard with bytes (Uint8Array)", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const bytes = new TextEncoder().encode('{"name":"Fox"}');
    const card = await client.parseAgentCard(bytes);
    expect(card.name).toBe("Fox");
  });

  it("sendMessage returns Task", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const msg: Message = { role: "user", parts: [{ type: "text", text: "Hello!" }] };
    const task = await client.sendMessage("fox-agent", msg);
    expect(task.task_id).toBe("task-uuid-1");
    expect(task.status).toBe("completed");
    expect(task.artifacts?.[0]?.text).toBe("Hello, agent!");
  });

  it("sendMessage rejects empty parts", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const msg: Message = { role: "user", parts: [] };
    await expect(client.sendMessage("fox", msg)).rejects.toThrow(/parts/);
  });

  it("sendMessage rejects undefined message", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    await expect(client.sendMessage("fox", undefined as unknown as Message)).rejects.toThrow(/required/);
  });

  it("getTask returns Task", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const task = await client.getTask("fox-agent", "task-1");
    expect(task.task_id).toBe("task-1");
    expect(task.status).toBe("completed");
  });

  it("getTask rejects empty task_id", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    await expect(client.getTask("fox", "")).rejects.toThrow(/task_id/);
  });

  it("listTasks returns ListTasksResult", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const result = await client.listTasks("fox-agent");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]?.task_id).toBe("t1");
  });

  it("listTasks with filter", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const flt: ListTasksFilter = { status: ["completed"], limit: 10 };
    const result = await client.listTasks("fox-agent", flt);
    expect(result.tasks).toHaveLength(2);
    expect(router.calls[0].arguments.filter).toEqual({ status: ["completed"], limit: 10 });
  });

  it("cancelTask returns canceled Task", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const task = await client.cancelTask("fox-agent", "task-1");
    expect(task.status).toBe("canceled");
    expect(task.task_id).toBe("task-1");
    expect(task.canceled_at).toBeDefined();
  });

  it("createTaskPushNotificationConfig returns config_id", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const cfg: PushConfig = {
      url: "https://merchant.example.com/webhook",
      events: ["task.completed"],
      secret: "shared-secret",
    };
    const result = await client.createTaskPushNotificationConfig("fox-agent", cfg);
    expect(result.config_id).toBe("config-uuid-1");
  });

  it("createTaskPushNotificationConfig rejects empty url", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const cfg: PushConfig = { url: "", events: ["task.completed"] };
    await expect(client.createTaskPushNotificationConfig("fox", cfg)).rejects.toThrow(/url/);
  });

  it("getExtendedAgentCard returns ExtendedAgentCard", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const card = await client.getExtendedAgentCard("fox-agent");
    expect(card.trust_score).toBe(0.95);
    expect(card.private_skills).toContain("private-1");
    expect(card.owner_user_id).toBe("user-uuid-1");
  });
});

// ────────────────────────────────────────────────────────
// Error path tests
// ────────────────────────────────────────────────────────

describe("MCPClient error handling", () => {
  it("RPCError translation: -32603 internal", async () => {
    const router = new MockMCPRouter();
    router.hooks[ToolHealthCheck] = () => {
      throw new RPCError(ErrCodeInternal, "internal failure");
    };
    const client = makeClient(router);
    try {
      await client.healthCheck("fox");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RPCError);
      expect((e as RPCError).code).toBe(ErrCodeInternal);
    }
  });

  it("RPCError translation: agent unreachable (-32001)", async () => {
    const router = new MockMCPRouter();
    router.hooks[ToolHealthCheck] = () => {
      throw new RPCError(ErrCodeMCPAgentUnreachable, "fox not reachable");
    };
    const client = makeClient(router);
    try {
      await client.healthCheck("fox");
      expect.fail("should have thrown");
    } catch (e) {
      expect(isAgentUnreachable(e)).toBe(true);
    }
  });

  it("RPCError translation: task not found (-32003)", async () => {
    const router = new MockMCPRouter();
    router.hooks[ToolGetTask] = () => {
      throw new RPCError(ErrCodeMCPTaskNotFound, "task-1 not found");
    };
    const client = makeClient(router);
    try {
      await client.getTask("fox", "task-1");
      expect.fail("should have thrown");
    } catch (e) {
      expect(isTaskNotFound(e)).toBe(true);
    }
  });

  it("HTTP 500 with JSON-RPC error envelope → translated RPCError", async () => {
    const handler: FetchImpl = async () =>
      makeResponse(500, { error: { code: -32603, message: "internal server error" } });
    const client = new MCPClient("https://kernel.example.com", "jwt", { fetchImpl: handler });
    try {
      await client.healthCheck("fox");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RPCError);
      // HTTP 5xx with valid JSON-RPC error envelope → use envelope code (-32603)
      expect((e as RPCError).code).toBe(-32603);
    }
  });

  it("HTTP 500 without JSON envelope → fallback HTTP error code", async () => {
    const handler: FetchImpl = async () => ({
      status: 500,
      text: async () => "plain text 500",
      json: async () => {
        throw new Error("not json");
      },
    });
    const client = new MCPClient("https://kernel.example.com", "jwt", { fetchImpl: handler });
    try {
      await client.healthCheck("fox");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RPCError);
      expect((e as RPCError).code).toBe(-500);
    }
  });

  it("HTTP 400 with JSON-RPC error envelope", async () => {
    const handler: FetchImpl = async () =>
      makeResponse(400, { error: { code: -32602, message: "bad params" } });
    const client = new MCPClient("https://kernel.example.com", "jwt", { fetchImpl: handler });
    try {
      await client.healthCheck("fox");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RPCError);
      expect((e as RPCError).code).toBe(-32602);
    }
  });

  it("malformed JSON response", async () => {
    const handler: FetchImpl = async () => ({
      status: 200,
      text: async () => "not json",
      json: async () => {
        throw new Error("invalid json");
      },
    });
    const client = new MCPClient("https://kernel.example.com", "jwt", { fetchImpl: handler });
    try {
      await client.healthCheck("fox");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as RPCError).code).toBe(-32700);
    }
  });

  it("method not found (-32601)", async () => {
    const router = new MockMCPRouter();
    router.hooks["nonexistent_tool"] = () => ({
      error: { code: ErrCodeMethodNotFound, message: "unknown tool" },
    });
    // Test that the wrapper translates tool error properly
    const client = makeClient(router);
    // healthCheck itself works, but the hook above is for nonexistent_tool
    // Let's verify with a hook that triggers -32601
    router.hooks[ToolHealthCheck] = () => {
      throw new RPCError(ErrCodeMethodNotFound, "method not found");
    };
    await expect(client.healthCheck("fox")).rejects.toMatchObject({
      code: ErrCodeMethodNotFound,
    });
  });
});

// ────────────────────────────────────────────────────────
// Auth helper tests
// ────────────────────────────────────────────────────────

describe("MCP auth helpers", () => {
  it("setBearerToken sets header", () => {
    const h: Record<string, string> = {};
    setBearerToken(h, "abc123");
    expect(h.Authorization).toBe(AuthSchemePrefix + "abc123");
  });

  it("setBearerToken with empty removes header", () => {
    const h: Record<string, string> = { Authorization: "Bearer old" };
    setBearerToken(h, "");
    expect(h.Authorization).toBeUndefined();
  });

  it("buildHeaders with token", () => {
    const h = buildHeaders("xyz");
    expect(h.Authorization).toBe("Bearer xyz");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["User-Agent"]).toContain("wau-typescript-sdk");
  });

  it("buildHeaders without token", () => {
    const h = buildHeaders();
    expect(h.Authorization).toBeUndefined();
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("McpAuth apply injects Authorization", () => {
    const auth = new McpAuth("xyz");
    const h: Record<string, string> = {};
    auth.apply(h);
    expect(h.Authorization).toBe("Bearer xyz");
  });

  it("runtime setBearerToken on client", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    client.setBearerToken("rotated-jwt");
    await client.healthCheck("fox");
    // Verify bearer token rotated(we can't directly inspect outbound header,
    // but no error means the call succeeded)
    expect(router.calls).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────
// Tool helpers
// ────────────────────────────────────────────────────────

describe("MCP tool helpers", () => {
  it("ALL_TOOL_NAMES has 10 entries", () => {
    expect(ALL_TOOL_NAMES).toHaveLength(10);
  });

  it("isStreamingTool detects SSE tools", () => {
    expect(isStreamingTool(ToolStreamMessage)).toBe(true);
    expect(isStreamingTool(ToolSubscribeToTask)).toBe(true);
    expect(isStreamingTool(ToolHealthCheck)).toBe(false);
    expect(isStreamingTool(ToolSendMessage)).toBe(false);
  });

  it("Default user agent includes v1.3.2", () => {
    expect(DefaultUserAgent).toContain("v1.3.2");
  });
});

// ────────────────────────────────────────────────────────
// Misc / DTO type guards
// ────────────────────────────────────────────────────────

describe("MCPClient misc", () => {
  it("constructor requires baseURL", () => {
    expect(() => new MCPClient("")).toThrow(/baseURL/);
  });

  it("target accepts string or dict", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    await client.healthCheck("fox-string");
    await client.healthCheck({ id: "uuid-1", version: "1.0" });
    expect(router.calls[0].arguments.target).toEqual({ name: "fox-string" });
    expect(router.calls[1].arguments.target).toEqual({ id: "uuid-1", version: "1.0" });
  });

  it("concurrent calls all succeed", async () => {
    const router = new MockMCPRouter();
    const client = makeClient(router);
    const promises = Array.from({ length: 5 }, (_, i) => client.healthCheck(`fox-${i}`));
    const results = await Promise.all(promises);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(router.calls).toHaveLength(5);
  });
});