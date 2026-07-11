/**
 * UCP client — 11 commerce tool name constants (per D88.7, W3 UCP client SDK design §三).
 *
 * 跟 kernel ucp/server.go ToolXxx + handler routeToCommerce 严格对齐。
 *
 * 公开:SDK caller 可以用 const 拼 params,也可用 typed wrapper method(UCPClient 上 11 method)。
 */
export const ToolListProducts = "list_products";
export const ToolGetProduct = "get_product";
export const ToolSearchProducts = "search_products";
export const ToolAddToCart = "add_to_cart";
export const ToolGetCart = "get_cart";
export const ToolRemoveFromCart = "remove_from_cart";
export const ToolCreateCheckoutSession = "create_checkout_session";
export const ToolConfirmPayment = "confirm_payment";
export const ToolGetOrder = "get_order";
export const ToolListOrders = "list_orders";
export const ToolCancelOrder = "cancel_order";

export const ALL_TOOL_NAMES: ReadonlyArray<string> = [
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
];
