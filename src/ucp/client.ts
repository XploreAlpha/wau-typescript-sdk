/**
 * UCP client — UCPClient class with 11 commerce tool wrappers + JSON-RPC 2.0 dispatch.
 *
 * ⭐ v1.0.0 M11 P7 UCP client (per D88.7, 2026-07-11)。
 *
 * 5 SDK 共享 wire format:JSON-RPC 2.0 over HTTP at POST {baseURL}/ucp
 * (跟 WAU-core-kernel internal/protocol/ucp/server.go handleUCP 对齐)。
 *
 * 本文件 = 11 commerce tool wrapper (listProducts / getProduct /
 * searchProducts / addToCart / getCart / removeFromCart /
 * createCheckoutSession / confirmPayment / getOrder / listOrders /
 * cancelOrder) + JSON-RPC envelope + error handling。
 *
 * 协议合规:
 *   - D60 additive: 0 改老 SDK,独立子包(chat.ts / bot/ 已有,v1.3.2 → v1.3.3 additive)
 *   - D13 byte-equal: JSON wire format 5 SDK 一致(per design doc §三)
 *   - D65 (tenant_id): Order / Cart DTO 含 tenant_id 字段
 *   - D66=B RBAC: owner_user_id 维持 string
 *   - D78/D79/D80: UCP OAuth 2.0 identity_linking bearer token,跟 MCP JWT 走同一通道
 *   - D88 ⭐⭐: 本子包 = D88.7 TypeScript SDK UCP client 实装(W3-launch-SOP §3.3 拍板)
 *
 * 设计原则(跟 mcpclient/ 1:1):
 *   - 0 依赖外部 HTTP client lib;fetch 由 caller 注入(便于 nock / test mocking)
 *   - W3 stub 阶段:createCheckoutSession + confirmPayment 走 kernel ErrNotImplemented
 *     → SDK 抛友好 NotImplementedError "W5 Stripe 集成中"
 */

import {
  CancelOrderResult,
  Cart,
  CheckoutSession,
  ListOrdersFilter,
  ListOrdersResult,
  ListProductsFilter,
  ListProductsResult,
  Order,
  PaymentConfirmation,
  Product,
  SearchProductsResult,
} from "./types";
import {
  asRPCError,
  ErrCodeInternal,
  RPCError,
} from "./errors";
import { UcpAuth } from "./auth";
import {
  ToolAddToCart,
  ToolCancelOrder,
  ToolConfirmPayment,
  ToolCreateCheckoutSession,
  ToolGetCart,
  ToolGetOrder,
  ToolGetProduct,
  ToolListOrders,
  ToolListProducts,
  ToolRemoveFromCart,
  ToolSearchProducts,
} from "./tools";

/**
 * fetch 的最小子集(便于注入 — 测试用 nock.fetch,生产用全局 fetch)。
 *
 * fetch 签名跟标准 Fetch API 一致。
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

/** 默认 user agent。 */
export const DEFAULT_USER_AGENT = "wau-typescript-sdk/ucp/v1.3.3";

/** 默认 endpoint(跟 kernel ucp.Server 端口 + path 对齐)。 */
export const DEFAULT_ENDPOINT = "/ucp";

/** UCPClient 构造选项。 */
export interface UCPClientOptions {
  /** 自定义 fetch(测试用,生产用默认 globalThis.fetch)。 */
  fetchImpl?: FetchImpl;
  /** OAuth 2.0 identity_linking JWT bearer token(可选)。 */
  bearerToken?: string;
  /** tenant ID(可选,per D65)。 */
  tenantID?: string;
  /** 覆盖默认 endpoint path(主要给测试用)。 */
  endpoint?: string;
  /** 覆盖默认 user agent。 */
  userAgent?: string;
  /** 自定义 UcpAuth(一次性 apply bearer + tenant,w5+ 完整 OAuth refresh)。 */
  auth?: UcpAuth;
}

/**
 * jsonRPCRequest envelope(JSON-RPC 2.0 spec)。
 */
interface JsonRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

/**
 * jsonRPCResponse envelope:Result 用 RawJson(由 caller 提供 out 解析),Error 走 RPCError。
 */
interface JsonRPCResponse {
  jsonrpc: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | null;
}

/**
 * UCPClient 是 UCP client(对应 WAU-core-kernel internal/protocol/ucp.Server)。
 *
 * 用法:
 *
 *     const cli = new UCPClient("https://kernel.example.com", {
 *       bearerToken: oauthJWT,
 *     });
 *     const cart = await cli.addToCart("prod-123", 2);
 */
export class UCPClient {
  private readonly baseURL: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchImpl;
  private readonly auth: UcpAuth;
  private readonly userAgent: string;
  private nextID = 0;

  constructor(baseURL: string, opts: UCPClientOptions = {}) {
    if (!baseURL) {
      throw new Error("ucpclient: baseURL is required");
    }
    // baseURL 末尾 slash 去掉(避免双 slash)
    let cleaned = baseURL;
    if (cleaned.endsWith("/")) {
      cleaned = cleaned.slice(0, -1);
    }
    this.baseURL = cleaned;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl =
      opts.fetchImpl ??
      (globalThis.fetch as unknown as FetchImpl | undefined) ??
      defaultFetchFallback;
    this.auth = opts.auth ?? new UcpAuth(opts.bearerToken ?? "", opts.tenantID ?? "");
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  }

  /** 释放资源(stub:目前无连接池,留口给 future SSE long-lived stream)。 */
  async close(): Promise<void> {
    // 0 显式资源(fetch 无连接池)
  }

  // ─────────────────────────────────────────────────────
  // 11 commerce tool wrapper(D88.7 W3 实装)
  // ─────────────────────────────────────────────────────

  /** list_products tool。filter 可为 undefined(列所有)。 */
  async listProducts(filter?: ListProductsFilter): Promise<ListProductsResult> {
    return this.callTool(
      ToolListProducts,
      filter as unknown as Record<string, unknown> | undefined,
      ListProductsResultSchema,
    );
  }

  /** get_product tool(product_id 必填)。 */
  async getProduct(productID: string): Promise<Product> {
    if (!productID) throw new Error("ucpclient: product_id is required");
    return this.callTool(ProductTool, { product_id: productID }, ProductSchema);
  }

  /** search_products tool(query 必填,limit 可选默认 10)。 */
  async searchProducts(query: string, limit?: number): Promise<SearchProductsResult> {
    if (!query) throw new Error("ucpclient: query is required");
    const args: Record<string, unknown> = { query };
    if (limit && limit > 0) args["limit"] = limit;
    return this.callTool(ToolSearchProducts, args, SearchProductsResultSchema);
  }

  /** add_to_cart tool(product_id + quantity 必填;quantity 默认 1)。 */
  async addToCart(productID: string, quantity: number): Promise<Cart> {
    if (!productID) throw new Error("ucpclient: product_id is required");
    const q = quantity <= 0 ? 1 : quantity;
    return this.callTool(
      ToolAddToCart,
      { product_id: productID, quantity: q },
      CartSchema,
    );
  }

  /** get_cart tool(cart_id 必填)。 */
  async getCart(cartID: string): Promise<Cart> {
    if (!cartID) throw new Error("ucpclient: cart_id is required");
    return this.callTool(ToolGetCart, { cart_id: cartID }, CartSchema);
  }

  /** remove_from_cart tool(cart_id + line_item_id 必填)。 */
  async removeFromCart(cartID: string, lineItemID: string): Promise<Cart> {
    if (!cartID) throw new Error("ucpclient: cart_id is required");
    if (!lineItemID) throw new Error("ucpclient: line_item_id is required");
    return this.callTool(
      ToolRemoveFromCart,
      { cart_id: cartID, line_item_id: lineItemID },
      CartSchema,
    );
  }

  /**
   * create_checkout_session tool(cart_id 必填 — W5+ Stripe 集成)。
   *
   * W3 stub 阶段:kernel handler 返 ErrNotImplemented → SDK 抛 NotImplementedError 友好提示。
   * W5 阶段:返 CheckoutSession(checkout_url 由 Stripe Checkout 生成)。
   */
  async createCheckoutSession(cartID: string): Promise<CheckoutSession> {
    if (!cartID) throw new Error("ucpclient: cart_id is required");
    try {
      return await this.callTool(
        ToolCreateCheckoutSession,
        { cart_id: cartID },
        CheckoutSessionSchema,
      );
    } catch (e) {
      const r = asRPCError(e);
      if (r !== null && r.code === ErrCodeInternal) {
        throw new Error(`ucpclient: create_checkout_session (W5 Stripe 集成中): ${e}`);
      }
      throw e;
    }
  }

  /**
   * confirm_payment tool(checkout_session_id 必填 — W5+ Stripe payment_intent)。
   *
   * W3 stub 阶段:同 createCheckoutSession;W5+ 返 PaymentConfirmation。
   */
  async confirmPayment(checkoutSessionID: string): Promise<PaymentConfirmation> {
    if (!checkoutSessionID) throw new Error("ucpclient: checkout_session_id is required");
    try {
      return await this.callTool(
        ToolConfirmPayment,
        { checkout_session_id: checkoutSessionID },
        PaymentConfirmationSchema,
      );
    } catch (e) {
      const r = asRPCError(e);
      if (r !== null && r.code === ErrCodeInternal) {
        throw new Error(`ucpclient: confirm_payment (W5 Stripe 集成中): ${e}`);
      }
      throw e;
    }
  }

  /** get_order tool(order_id 必填)。 */
  async getOrder(orderID: string): Promise<Order> {
    if (!orderID) throw new Error("ucpclient: order_id is required");
    return this.callTool(ToolGetOrder, { order_id: orderID }, OrderSchema);
  }

  /** list_orders tool(user_id 必填,filter 可选)。 */
  async listOrders(userID: string, filter?: ListOrdersFilter): Promise<ListOrdersResult> {
    if (!userID) throw new Error("ucpclient: user_id is required");
    const args: Record<string, unknown> = { user_id: userID };
    if (filter !== undefined) args["filter"] = filter;
    return this.callTool(ToolListOrders, args, ListOrdersResultSchema);
  }

  /** cancel_order tool(order_id 必填;W5+ 走 Stripe refund)。 */
  async cancelOrder(orderID: string): Promise<CancelOrderResult> {
    if (!orderID) throw new Error("ucpclient: order_id is required");
    return this.callTool(
      ToolCancelOrder,
      { order_id: orderID },
      CancelOrderResultSchema,
    );
  }

  // ─────────────────────────────────────────────────────
  // JSON-RPC 2.0 主入口(callTool 通用 dispatch)
  // ─────────────────────────────────────────────────────

  /**
   * callTool 是 SDK 内部用的 typed-agnostic JSON-RPC 调用入口。
   *
   * 流程:
   *   1. 构造 envelope {jsonrpc, id, method, params: {name, arguments}}
   *   2. POST baseURL+endpoint
   *   3. 解析 Response envelope
   *   4. if error → 抛 RPCError;else 把 result 塞到 schema wrapper 后返回
   *
   * Schema 通过工厂函数(product_id / cart_id / tenant_id 等 snake_case 字段由 TS 端负责匹配)
   * 保留 backend 返 JSON 字段到 TS interface 的 camelCase 映射工作(后续版本可加)。
   * 当前版本(per D13 byte-equal):直接按 backend JSON 字段"snake_case -> snake_case TS"用,DTO interface 不做强转。
   */
  private async callTool<T>(
    toolName: string,
    arguments_: Record<string, unknown> | undefined,
    schema: SchemaWrapper<T>,
  ): Promise<T> {
    const nextId = (this.nextID += 1);
    const params: Record<string, unknown> = { name: toolName };
    if (arguments_ !== undefined) {
      params["arguments"] = arguments_;
    }
    const req: JsonRPCRequest = {
      jsonrpc: "2.0",
      method: "tools/call",
      params,
      id: nextId,
    };

    const body = JSON.stringify(req);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    // 直接在 Record 上注入 bearer + tenant(Headers object 是 wrapper,直接同步到 fetch call 用的 record)
    if (this.auth.bearerToken !== "") {
      headers["Authorization"] = "Bearer " + this.auth.bearerToken;
    }
    if (this.auth.tenantID !== "") {
      headers["X-WAU-Tenant-ID"] = this.auth.tenantID;
    }

    const resp = await this.fetchImpl(this.baseURL + this.endpoint, {
      method: "POST",
      headers,
      body,
    });

    // 4xx/5xx → 期望仍是 JSON-RPC envelope(kernel server 总是返 200 + envelope),
    // 但其他实现可能走 REST 错误,这里给 fallback
    if (resp.status >= 400) {
      const text = await resp.text();
      throw new RPCError(
        resp.status * -1,
        `http ${resp.status}: ${text}`,
        undefined,
      );
    }

    let rpcResp: JsonRPCResponse;
    try {
      rpcResp = (await resp.json()) as JsonRPCResponse;
    } catch (e) {
      const text = await resp.text();
      throw new Error(
        `ucpclient: unmarshal response (status=${resp.status}): ${String(e)} (body=${text})`,
      );
    }

    if (rpcResp.error !== undefined) {
      const e = rpcResp.error;
      throw new RPCError(e.code, e.message, e.data);
    }

    if (rpcResp.result === undefined || rpcResp.result === null) {
      // 空 result(比如 notification) — 让 schema 决定 fallback
      return schema.fromJSON({});
    }
    return schema.fromJSON(rpcResp.result);
  }
}

/**
 * local alias — 跟 ToolXxx 常量保持一致,避免同名歧义。
 */
const ProductTool = ToolGetProduct;

// ─────────────────────────────────────────────────────
// Schema wrappers:从 backend JSON 解析到 TS DTO interface
// ─────────────────────────────────────────────────────

/**
 * SchemaWrapper 提供统一的 fromJSON 工厂,把 kernel 返的 JSON object 变成 TS DTO 接口。
 *
 * 当前策略:不做 camelCase ↔ snake_case 转换(D13 byte-equal 让字段一致),
 * 只是在编译期让 TypeScript 知道 shape 没有遗留字段意外。
 * 未来如需强转(比如后端规范化字段),加一层 zod/valibot 即可。
 */
interface SchemaWrapper<T> {
  fromJSON(raw: unknown): T;
}

function identity<T extends object>(): SchemaWrapper<T> {
  return {
    fromJSON(raw: unknown): T {
      if (typeof raw !== "object" || raw === null) {
        return {} as T;
      }
      return raw as T;
    },
  };
}

const ProductSchema = identity<Product>();
const ListProductsResultSchema = identity<ListProductsResult>();
const SearchProductsResultSchema = identity<SearchProductsResult>();
const CartSchema = identity<Cart>();
const CheckoutSessionSchema = identity<CheckoutSession>();
const PaymentConfirmationSchema = identity<PaymentConfirmation>();
const OrderSchema = identity<Order>();
const ListOrdersResultSchema = identity<ListOrdersResult>();
const CancelOrderResultSchema = identity<CancelOrderResult>();

// ─────────────────────────────────────────────────────
// 默认 fetch fallback(当 globalThis.fetch 不可用时,作为 safety net)
// ─────────────────────────────────────────────────────

const defaultFetchFallback: FetchImpl = async () => {
  throw new Error(
    "ucpclient: no fetch implementation available — pass opts.fetchImpl or run in Node 18+/browser with global fetch",
  );
};
