/**
 * UCP client — RPCError + error codes (per D88.7, W3 UCP client SDK design §二 §三).
 *
 * 跟 kernel ucp.Error 字段 byte-equal:Code / Message / Data。
 * 5 spec code(-32700/-32600/-32601/-32602/-32603)+ 5 UCP-specific code 跟 kernel ucp.Envelope 一致。
 *
 * D13 byte-equal 跨 5 SDK 共享(跟 wau-go-sdk/ucpclient/errors.go + wau-python-sdk/ucp_errors.py 字段一致)。
 */

/**
 * RPCError 是 JSON-RPC 2.0 error object 的 TS 表达(per spec + UCP 扩展)。
 *
 * 跟 kernel ucp.Error 字段 byte-equal:code / message / data。
 */
export class RPCError extends Error {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(formatRPCErrorMessage(code, message));
    this.name = "RPCError";
    this.code = code;
    this.data = data;
  }

  /** 跟 Go fmt.Sprintf("ucp rpc error: code=%d message=%q", ...) 等价 */
  toString(): string {
    return `ucp rpc error: code=${this.code} message=${JSON.stringify(this.message)}`;
  }
}

function formatRPCErrorMessage(code: number, message: string): string {
  return `ucp rpc error: code=${code} message=${JSON.stringify(message)}`;
}

// ────────────────────────────────────────────────────────
// JSON-RPC 2.0 spec error codes(跟 kernel ucp.ErrCode* 一致)
// ────────────────────────────────────────────────────────

export const ErrCodeParse = -32700;
export const ErrCodeInvalidRequest = -32600;
export const ErrCodeMethodNotFound = -32601;
export const ErrCodeInvalidParams = -32602;
export const ErrCodeInternal = -32603;

// UCP-specific(-32100 ~ -32199,跟 MCP -32001~32003 错开)
export const ErrCodeUCPProductNotFound = -32101;
export const ErrCodeUCPCartExpired = -32102;
export const ErrCodeUCPStripeError = -32103;
export const ErrCodeUCPOrderNotFound = -32104;
export const ErrCodeUCPPaymentFailed = -32105;

/**
 * 把任意 error 转成 RPCError,失败返 null。
 *
 * 设计:kernel server 总是返 RPCError(client 解 Response envelope 拿到);
 * HTTP 4xx/5xx 走 transport-style throw 的 TypeError / StatusError,不走这条路径。
 */
export function asRPCError(err: unknown): RPCError | null {
  if (err instanceof RPCError) return err;
  return null;
}

/**
 * 判断 err 是不是 product / order / cart "not found" 语义错误(UCP spec)。
 */
export function isNotFound(err: unknown): boolean {
  const r = asRPCError(err);
  if (r === null) return false;
  return r.code === ErrCodeUCPProductNotFound || r.code === ErrCodeUCPOrderNotFound;
}

/**
 * 判断 err 是不是 Stripe API 路径错误。
 */
export function isStripeError(err: unknown): boolean {
  const r = asRPCError(err);
  if (r === null) return false;
  return r.code === ErrCodeUCPStripeError || r.code === ErrCodeUCPPaymentFailed;
}
