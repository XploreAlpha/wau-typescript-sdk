/**
 * UCP client 单测 (wau-typescript-sdk v1.3.3, per D88.7)。
 *
 * 镜像 wau-go-sdk ucpclient/client_test.go 28 测试 + wau-python-sdk tests/test_ucp_client.py 25 测试,
 * 本文件 ~25-28 测试,覆盖 11 commerce tool + W3 stub + error path + auth + stripe helper + JSON-RPC envelope。
 *
 * 用 fetchImpl 注入做 in-process mock(对齐 kernel handleUCP dispatcher 行为),
 * 不依赖 nock(避免 axios 与 fetch 转换问题)。
 *
 * 覆盖矩阵:
 *   - 11 commerce tool happy path
 *   - create_checkout_session + confirm_payment W3 stub → "W5" 错误
 *   - ListProducts + ListOrders with filter
 *   - 本地校验(product_id / cart_id / line_item_id / query / user_id / order_id 必填)
 *   - RPCError 翻译:JSON-RPC error / 4xx HTTP / malformed JSON
 *   - Error code:UCP -32101 / -32103 / -32601
 *   - Auth helper: setBearerToken + setTenantID
 *   - Stripe helper: isStripePath
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  UCPClient,
  UCPClientOptions,
  FetchImpl,
  RPCError,
  ErrCodeInternal,
  ErrCodeMethodNotFound,
  ErrCodeUCPProductNotFound,
  ErrCodeUCPPaymentFailed,
  ErrCodeUCPStripeError,
  isNotFound,
  isStripeError,
  setBearerToken,
  setTenantID,
  isStripePath,
  ToolListProducts,
  ToolGetProduct,
  ToolSearchProducts,
  ToolAddToCart,
  ToolGetCart,
  ToolRemoveFromCart,
  ToolCreateCheckoutSession,
  ToolConfirmPayment,
  ToolGetOrder,
  ToolListOrders,
  ToolCancelOrder,
  ToolAddToCart as TOOL_ADD_TO_CART,
} from "../../src/ucp";

// ────────────────────────────────────────────────────────
// Mock UCP server helpers(duck-typed fetchImpl)
// ────────────────────────────────────────────────────────

interface ToolResult {
  result?: unknown;
  error?: { code: number; message: string };
}

interface CallRecord {
  body: string;
  headers: Record<string, string>;
}

class MockUCPRouter {
  toolResults: Map<string, ToolResult> = new Map();
  notImplementedTools: Set<string> = new Set();
  forceMalformed = false;
  forceStatus4xx = 0;
  calls: CallRecord[] = [];

  addResult(tool: string, result: unknown): void {
    this.toolResults.set(tool, { result });
  }

  addError(tool: string, code: number, message: string): void {
    this.toolResults.set(tool, { error: { code, message } });
  }

  stubNotImplemented(tool: string): void {
    this.notImplementedTools.add(tool);
  }

  handle: FetchImpl = async (url, init) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        headers[k] = v;
      }
    }
    this.calls.push({ body: init?.body ?? "", headers });

    if (this.forceStatus4xx !== 0) {
      return {
        status: this.forceStatus4xx,
        text: async () => "mock 4xx body",
        json: async () => ({}),
      };
    }

    if (this.forceMalformed) {
      return {
        status: 200,
        text: async () => "{not valid json",
        json: async () => {
          throw new Error("invalid json");
        },
      };
    }

    let parsed: {
      jsonrpc: string;
      method?: string;
      params?: { name?: string; arguments?: unknown };
      id?: number;
    };
    try {
      parsed = JSON.parse(init?.body ?? "{}");
    } catch {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "parse error" },
            id: 0,
          }),
        json: async () => ({
          jsonrpc: "2.0",
          error: { code: -32700, message: "parse error" },
          id: 0,
        }),
      };
    }

    if (parsed.jsonrpc !== "2.0") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32600, message: "jsonrpc must be 2.0" },
            id: parsed.id ?? 0,
          }),
        json: async () => ({
          jsonrpc: "2.0",
          error: { code: -32600, message: "jsonrpc must be 2.0" },
          id: parsed.id ?? 0,
        }),
      };
    }

    if (parsed.method !== "tools/call") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32601, message: `method: ${parsed.method}` },
            id: parsed.id ?? 0,
          }),
        json: async () => ({
          jsonrpc: "2.0",
          error: { code: -32601, message: `method: ${parsed.method}` },
          id: parsed.id ?? 0,
        }),
      };
    }

    const toolName = parsed.params?.name ?? "";

    if (!toolName) {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32602, message: "missing 'name' in params" },
            id: parsed.id ?? 0,
          }),
        json: async () => ({
          jsonrpc: "2.0",
          error: { code: -32602, message: "missing 'name' in params" },
          id: parsed.id ?? 0,
        }),
      };
    }

    // W3 stub
    if (this.notImplementedTools.has(toolName)) {
      const resp = {
        jsonrpc: "2.0",
        error: {
          code: ErrCodeInternal,
          message: "W5 Stripe 集成中,当前 stub (D88.1)",
        },
        id: parsed.id ?? 0,
      };
      return {
        status: 200,
        text: async () => JSON.stringify(resp),
        json: async () => resp,
      };
    }

    const tr = this.toolResults.get(toolName);
    if (tr) {
      if (tr.error) {
        const resp = {
          jsonrpc: "2.0",
          error: tr.error,
          id: parsed.id ?? 0,
        };
        return {
          status: 200,
          text: async () => JSON.stringify(resp),
          json: async () => resp,
        };
      }
      const resp = { jsonrpc: "2.0", result: tr.result, id: parsed.id ?? 0 };
      return {
        status: 200,
        text: async () => JSON.stringify(resp),
        json: async () => resp,
      };
    }

    const resp = {
      jsonrpc: "2.0",
      error: {
        code: ErrCodeMethodNotFound,
        message: `no mock result for: ${toolName}`,
      },
      id: parsed.id ?? 0,
    };
    return {
      status: 200,
      text: async () => JSON.stringify(resp),
      json: async () => resp,
    };
  };
}

let mockRouter: MockUCPRouter;
let client: UCPClient;

beforeEach(() => {
  mockRouter = new MockUCPRouter();
  const opts: UCPClientOptions = {
    bearerToken: "oauth-jwt-test",
    fetchImpl: mockRouter.handle,
  };
  client = new UCPClient("https://kernel.example.com", opts);
});

// ────────────────────────────────────────────────────────
// 11 tool happy path
// ────────────────────────────────────────────────────────

describe("UCPClient 11 commerce tools", () => {
  it("listProducts happy path", async () => {
    mockRouter.addResult(ToolListProducts, {
      products: [
        { product_id: "p-1", name: "Hat", price_cents: 9950, currency: "CNY" },
        { product_id: "p-2", name: "Pin", price_cents: 1990, currency: "CNY" },
      ],
      total: 2,
      page: 1,
      page_size: 20,
    });
    const res = await client.listProducts();
    expect(res.total).toBe(2);
    expect(res.products).toHaveLength(2);
    expect(res.products[0].product_id).toBe("p-1");
    expect(res.products[0].price_cents).toBe(9950);
  });

  it("listProducts with filter", async () => {
    mockRouter.addResult(ToolListProducts, {
      products: [{ product_id: "p-3" }],
      total: 1,
      page: 1,
      page_size: 10,
    });
    const res = await client.listProducts({
      category: "apparel",
      page_size: 10,
    });
    expect(res.total).toBe(1);
    const lastCall = mockRouter.calls[mockRouter.calls.length - 1];
    const parsed = JSON.parse(lastCall.body);
    expect(parsed.params.arguments.category).toBe("apparel");
    expect(parsed.params.arguments.page_size).toBe(10);
  });

  it("getProduct happy path", async () => {
    mockRouter.addResult(ToolGetProduct, {
      product_id: "p-9",
      name: "Beanie",
      price_cents: 4900,
      currency: "CNY",
    });
    const p = await client.getProduct("p-9");
    expect(p.product_id).toBe("p-9");
    expect(p.name).toBe("Beanie");
  });

  it("getProduct empty product_id raises", async () => {
    await expect(client.getProduct("")).rejects.toThrow(/product_id is required/);
  });

  it("searchProducts happy path", async () => {
    mockRouter.addResult(ToolSearchProducts, {
      products: [{ product_id: "p-7", name: "Coffee Beans" }],
      total: 1,
      query: "coffee",
    });
    const res = await client.searchProducts("coffee", 10);
    expect(res.total).toBe(1);
    expect(res.products[0].name).toBe("Coffee Beans");
  });

  it("searchProducts empty query raises", async () => {
    await expect(client.searchProducts("")).rejects.toThrow(/query is required/);
  });

  it("addToCart happy path", async () => {
    mockRouter.addResult(ToolAddToCart, {
      cart_id: "cart-1",
      user_id: "u-1",
      line_items: [
        {
          line_item_id: "li-1",
          product_id: "p-1",
          quantity: 2,
          unit_price_cents: 9950,
          subtotal_cents: 19900,
        },
      ],
      total_cents: 19900,
      currency: "CNY",
    });
    const cart = await client.addToCart("p-1", 2);
    expect(cart.cart_id).toBe("cart-1");
    expect(cart.total_cents).toBe(19900);
    expect(cart.line_items).toHaveLength(1);
    expect(cart.line_items![0].quantity).toBe(2);
  });

  it("addToCart quantity 0 defaults to 1", async () => {
    mockRouter.addResult(ToolAddToCart, { cart_id: "cart-1", total_cents: 9950 });
    await client.addToCart("p-1", 0);
    const lastCall = mockRouter.calls[mockRouter.calls.length - 1];
    const parsed = JSON.parse(lastCall.body);
    expect(parsed.params.arguments.quantity).toBe(1);
  });

  it("getCart happy path", async () => {
    mockRouter.addResult(ToolGetCart, {
      cart_id: "cart-99",
      total_cents: 5000,
    });
    const cart = await client.getCart("cart-99");
    expect(cart.cart_id).toBe("cart-99");
    expect(cart.total_cents).toBe(5000);
  });

  it("removeFromCart happy path", async () => {
    mockRouter.addResult(ToolRemoveFromCart, {
      cart_id: "cart-1",
      removed: true,
      line_items: [],
    });
    const cart = await client.removeFromCart("cart-1", "li-1");
    expect(cart.removed).toBe(true);
    expect(cart.line_items).toEqual([]);
  });

  it("removeFromCart empty ids raise", async () => {
    await expect(client.removeFromCart("", "li-1")).rejects.toThrow(/cart_id is required/);
    await expect(client.removeFromCart("cart-1", "")).rejects.toThrow(/line_item_id is required/);
  });

  it("createCheckoutSession W3 stub raises 'W5 Stripe'", async () => {
    mockRouter.stubNotImplemented(ToolCreateCheckoutSession);
    await expect(client.createCheckoutSession("cart-1")).rejects.toThrow(/W5 Stripe/);
  });

  it("confirmPayment W3 stub raises 'W5 Stripe'", async () => {
    mockRouter.stubNotImplemented(ToolConfirmPayment);
    await expect(client.confirmPayment("cs_xyz")).rejects.toThrow(/W5 Stripe/);
  });

  it("getOrder happy path", async () => {
    mockRouter.addResult(ToolGetOrder, {
      order_id: "ord-9",
      user_id: "u-1",
      tenant_id: "tenant-A",
      status: "paid",
      total_cents: 9950,
      currency: "CNY",
    });
    const order = await client.getOrder("ord-9");
    expect(order.tenant_id).toBe("tenant-A");
    expect(order.status).toBe("paid");
  });

  it("listOrders happy path", async () => {
    mockRouter.addResult(ToolListOrders, {
      orders: [{ order_id: "ord-1", status: "paid" }],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const res = await client.listOrders("u-1", { page_size: 20 });
    expect(res.total).toBe(1);
    expect(res.orders[0].order_id).toBe("ord-1");
  });

  it("cancelOrder happy path", async () => {
    mockRouter.addResult(ToolCancelOrder, {
      order_id: "ord-1",
      status: "canceled",
      refund_id: "re_xyz",
      refund_status: "pending",
      canceled_at: "2026-07-11T10:00:00Z",
    });
    const res = await client.cancelOrder("ord-1");
    expect(res.refund_id).toBe("re_xyz");
    expect(res.refund_status).toBe("pending");
  });
});

// ────────────────────────────────────────────────────────
// Error path tests
// ────────────────────────────────────────────────────────

describe("UCPClient error paths", () => {
  it("product not found → RPCError(ErrCodeUCPProductNotFound)", async () => {
    mockRouter.addError(ToolGetProduct, ErrCodeUCPProductNotFound, "no product: missing-id");
    let captured: unknown;
    try {
      await client.getProduct("missing-id");
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(RPCError);
    expect((captured as RPCError).code).toBe(ErrCodeUCPProductNotFound);
    expect(isNotFound(captured)).toBe(true);
  });

  it("stripe error (non-W3) → RPCError, not 'W5' wrapped", async () => {
    mockRouter.addError(ToolCreateCheckoutSession, ErrCodeUCPPaymentFailed, "card declined");
    let captured: unknown;
    try {
      await client.createCheckoutSession("cart-1");
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(RPCError);
    expect(isStripeError(captured)).toBe(true);
    // 验证不是 "W5 Stripe" 包装的 — W5 只捕获 code == ErrCodeInternal
    expect((captured as Error).message).not.toMatch(/W5 Stripe/);
  });

  it("invalid JSON response → JSON parse error", async () => {
    mockRouter.forceMalformed = true;
    await expect(client.getProduct("p-1")).rejects.toThrow();
  });

  it("method not found (no mock result) → RPCError(ErrCodeMethodNotFound)", async () => {
    let captured: unknown;
    try {
      // 调一个 mock 没注册的 tool — 用 callTool 内部的兜底
      await client.getProduct("never-mocked-product-id");
      // 不应该到这里
      throw new Error("expected error");
    } catch (e) {
      captured = e;
    }
    // 该 tool 上没 addResult,会走 tool_not_found
    expect(captured).toBeInstanceOf(RPCError);
    expect((captured as RPCError).code).toBe(ErrCodeMethodNotFound);
  });

  it("HTTP 4xx → RPCError 负 code", async () => {
    mockRouter.forceStatus4xx = 500;
    let captured: unknown;
    try {
      await client.getProduct("p-1");
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(RPCError);
    // 500 * -1
    expect((captured as RPCError).code).toBe(-500);
  });
});

// ────────────────────────────────────────────────────────
// Auth + Stripe helpers
// ────────────────────────────────────────────────────────

describe("UCP auth helpers", () => {
  it("setBearerToken adds 'Authorization: Bearer ...' header", () => {
    const h = new Headers();
    setBearerToken(h, "tok-1");
    expect(h.get("Authorization")).toBe("Bearer tok-1");
  });

  it("setBearerToken empty token omits header", () => {
    const h = new Headers();
    setBearerToken(h, "");
    expect(h.has("Authorization")).toBe(false);
  });

  it("setTenantID adds X-WAU-Tenant-ID header", () => {
    const h = new Headers();
    setTenantID(h, "tenant-A");
    expect(h.get("X-WAU-Tenant-ID")).toBe("tenant-A");
  });

  it("UCPClient applies Authorization header on each call", async () => {
    mockRouter.addResult(ToolGetProduct, { product_id: "p-9", name: "X" });
    await client.getProduct("p-9");
    const last = mockRouter.calls[mockRouter.calls.length - 1];
    expect(last.headers["Authorization"]).toBe("Bearer oauth-jwt-test");
    expect(last.headers["User-Agent"]).toMatch(/ucp\/v1\.3\.3/);
  });

  it("UCPClient without bearer token omits Authorization", async () => {
    const cli = new UCPClient("https://kernel.example.com", {
      fetchImpl: mockRouter.handle,
    });
    mockRouter.addResult(ToolGetProduct, { product_id: "p-9" });
    await cli.getProduct("p-9");
    const last = mockRouter.calls[mockRouter.calls.length - 1];
    expect(last.headers["Authorization"]).toBeUndefined();
  });
});

describe("UCP stripe helpers", () => {
  it("isStripePath recognizes 3 Stripe tools", () => {
    expect(isStripePath("create_checkout_session")).toBe(true);
    expect(isStripePath("confirm_payment")).toBe(true);
    expect(isStripePath("cancel_order")).toBe(true);
  });

  it("isStripePath rejects non-Stripe tools", () => {
    expect(isStripePath("list_products")).toBe(false);
    expect(isStripePath("add_to_cart")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// JSON-RPC envelope sanity
// ────────────────────────────────────────────────────────

describe("JSON-RPC envelope", () => {
  it("envelope shape matches spec 2.0 + method=tools/call + params.name + incremental id", async () => {
    mockRouter.addResult(ToolGetProduct, { product_id: "p-1" });
    mockRouter.addResult(ToolGetProduct, { product_id: "p-2" });
    await client.getProduct("p-1");
    await client.getProduct("p-2");
    const call1 = JSON.parse(mockRouter.calls[0].body);
    const call2 = JSON.parse(mockRouter.calls[1].body);
    expect(call1.jsonrpc).toBe("2.0");
    expect(call1.method).toBe("tools/call");
    expect(call1.params.name).toBe("get_product");
    expect(call2.id).toBeGreaterThan(call1.id);
  });
});
