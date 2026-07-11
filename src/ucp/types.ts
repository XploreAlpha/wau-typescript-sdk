/**
 * UCP client — 8 commerce DTO (per W3 UCP client SDK design §三, D88.7 W3 实装).
 *
 * 5 SDK 共享 wire format:JSON-RPC 2.0 over HTTP at POST {baseURL}/ucp
 * (跟 WAU-core-kernel internal/protocol/ucp/server.go handleUCP 对齐)。
 *
 * 本文件 DTO 字段 byte-equal:跟 kernel ucp.Commerce interface 返的 any 期望 shape 对齐;
 * D13 byte-equal 跨 5 SDK 由 design doc §三 8 DTO 详设保证。
 *
 * JSON 字段 snake_case(per UCP spec)+ tenant_id / product_id / line_item_id / cart_id / order_id 等
 */

// ────────────────────────────────────────────────────────
// Product 系列(对应 tool 1-3: list_products / get_product / search_products)
// ────────────────────────────────────────────────────────

export interface Product {
  product_id?: string;
  name?: string;
  description?: string;
  price_cents?: number;
  currency?: string;
  stock?: number;
  images?: string[];
  category?: string;
  created_at?: string;
  available?: boolean;
  sku?: string;
}

export interface ListProductsFilter {
  category?: string;
  price_min_cents?: number;
  price_max_cents?: number;
  page?: number;
  page_size?: number;
}

export interface ListProductsResult {
  products: Product[];
  total: number;
  page: number;
  page_size: number;
}

export interface SearchProductsResult {
  products: Product[];
  total: number;
  query?: string;
}

// ────────────────────────────────────────────────────────
// Cart 系列(对应 tool 4-6: add_to_cart / get_cart / remove_from_cart)
// ────────────────────────────────────────────────────────

export interface CartLineItem {
  line_item_id?: string;
  product_id?: string;
  name?: string;
  quantity?: number;
  unit_price_cents?: number;
  subtotal_cents?: number;
}

export interface Cart {
  cart_id?: string;
  user_id?: string;
  /** per D65 multi-tenant */
  tenant_id?: string;
  line_items?: CartLineItem[];
  total_cents?: number;
  currency?: string;
  created_at?: string;
  /** 24h 默认,per UCP spec */
  expires_at?: string;
  last_updated?: string;
  /** remove_from_cart 特有 */
  removed?: boolean;
}

// ────────────────────────────────────────────────────────
// CheckoutSession + PaymentConfirmation(对应 tool 7-8, Stripe 透明)
// ────────────────────────────────────────────────────────

/**
 * CheckoutSession 是 Stripe Checkout Session DTO(tool 7: create_checkout_session)。
 *
 * W5+ Stripe 集成时,kernel 通过 /v1/ucp/webhooks/stripe 调 SDK,
 * SDK 0 直接 Stripe(透明)。
 */
export interface CheckoutSession {
  checkout_session_id?: string;
  cart_id?: string;
  checkout_url?: string;
  amount_cents?: number;
  currency?: string;
  /** "pending" | "completed" | "expired" */
  status?: string;
  expires_at?: string;
}

/**
 * PaymentConfirmation 是 Stripe payment_intent 确认 DTO(tool 8: confirm_payment)。
 */
export interface PaymentConfirmation {
  checkout_session_id?: string;
  payment_intent_id?: string;
  /** "succeeded" | "failed" | "processing" */
  status?: string;
  order_id?: string;
}

// ────────────────────────────────────────────────────────
// Order 系列(对应 tool 9-10-11: get_order / list_orders / cancel_order)
// ────────────────────────────────────────────────────────

/**
 * Order 是订单 DTO。必含 tenant_id(per D65 multi-tenant)。
 */
export interface Order {
  order_id?: string;
  user_id?: string;
  /** per D65 */
  tenant_id?: string;
  /** "pending" | "paid" | "shipped" | "delivered" | "canceled" | "refunded" */
  status?: string;
  line_items?: CartLineItem[];
  total_cents?: number;
  currency?: string;
  shipping_address?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ListOrdersFilter {
  status?: string[];
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export interface ListOrdersResult {
  orders: Order[];
  total: number;
  page?: number;
  page_size?: number;
}

/**
 * CancelOrderResult 是 cancel_order 返的 DTO(含 Stripe refund 流程)。
 */
export interface CancelOrderResult {
  order_id?: string;
  /** 通常 "canceled" */
  status?: string;
  refund_id?: string;
  /** "pending" | "succeeded" | "failed" */
  refund_status?: string;
  canceled_at?: string;
  refund_reason?: string;
}
