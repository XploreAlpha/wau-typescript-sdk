/**
 * UCP client — Stripe helper (per D88.7, W3 UCP-Stripe-Checkout design).
 *
 * 设计原则(per [[process/2026-07-11-W3-UCP-Stripe-Checkout-design]]):
 *
 *   SDK 0 直接依赖 Stripe SDK — 所有 Stripe API call 都由 kernel
 *   internal/protocol/ucp/ucp_stripe.go 转发,SDK 只发常规 HTTP/JSON-RPC。
 *   Stripe webhook → kernel POST /v1/ucp/webhooks/stripe →
 *   内部走 Stripe SDK + 幂等表 dedup。
 *
 * 本文件只是 helper 集合(W3 stub 阶段),W5+ 加:
 *   - Stripe SDK 错误码 → UCP error code 转换
 *   - payment_intent ID 提取
 *   - refund flow DTO 转换
 *
 * D13 byte-equal 跨 5 SDK 共享 stripe 路径判断。
 */

import {
  ToolCreateCheckoutSession,
  ToolConfirmPayment,
  ToolCancelOrder,
} from "./tools";

/**
 * 判断 DTO 是不是跟 Stripe 相关的(create_checkout_session / confirm_payment / cancel_order + refund)。
 */
export function isStripePath(toolName: string): boolean {
  return (
    toolName === ToolCreateCheckoutSession ||
    toolName === ToolConfirmPayment ||
    toolName === ToolCancelOrder
  );
}

/** Payment status 常量(per Stripe payment_intent.status)。 */
export const PaymentStatusSucceeded = "succeeded";
export const PaymentStatusFailed = "failed";
export const PaymentStatusProcessing = "processing";
export const PaymentStatusPending = "pending";
