/**
 * UCP client — public API exports (per D88.7, W3 实装)。
 *
 * 用法:
 *
 *     import { UCPClient } from "wau-sdk/ucp";
 *     const cli = new UCPClient("https://kernel.example.com", { bearerToken: "jwt" });
 *     const products = await cli.listProducts();
 */

// DTO types
export type {
  CancelOrderResult,
  Cart,
  CartLineItem,
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

// Errors
export {
  asRPCError,
  ErrCodeInternal,
  ErrCodeInvalidParams,
  ErrCodeInvalidRequest,
  ErrCodeMethodNotFound,
  ErrCodeParse,
  ErrCodeUCPCartExpired,
  ErrCodeUCPPaymentFailed,
  ErrCodeUCPOrderNotFound,
  ErrCodeUCPProductNotFound,
  ErrCodeUCPStripeError,
  isNotFound,
  isStripeError,
  RPCError,
} from "./errors";

// Auth
export {
  AUTH_HEADER_NAME,
  AUTH_SCHEME_PREFIX,
  DEFAULT_TENANT_HEADER_NAME,
  setBearerToken,
  setTenantID,
  UcpAuth,
} from "./auth";

// Stripe helpers
export {
  isStripePath,
  PaymentStatusFailed,
  PaymentStatusPending,
  PaymentStatusProcessing,
  PaymentStatusSucceeded,
} from "./stripe";

// Tool constants
export {
  ALL_TOOL_NAMES,
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

// Client(constants + class)
export {
  DEFAULT_ENDPOINT,
  DEFAULT_USER_AGENT,
  UCPClient,
} from "./client";
// Client(types — must be export type under isolatedModules)
export type {
  FetchImpl,
  UCPClientOptions,
} from "./client";
