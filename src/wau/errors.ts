/**
 * Wau client — WauWorkflowError class + 7 error code constants
 * (per SDK Consumer Contract §二.4 + v1.0.1 SoT doc §四.5).
 *
 * 设计原则(跟 UCP/MCP errors.ts 1:1):
 *   - WauWorkflowError 继承 Error + name/code/retryable/cause
 *   - 7 个 string code 常量(TIMEOUT / AUTH_FAILED / INVALID_HARNESS / ...),跟 7 个 WauWorkflowErrorCode 字面量 union 对齐
 *   - asWauWorkflowError helper:把 unknown → WauWorkflowError | null
 *   - 5 SDK byte-equal:Go/Python/Rust/Java 同样 7 个 code 字面量
 *
 * 协议合规:
 *   - D60 additive: 0 改老 errors.ts,独立子包
 *   - D78 byte-equal: code 字符串跟 kernel WauWorkflowErrorCode enum 1:1
 *   - #18 retry 2x + 失败回退:retryable flag 由 caller 决定(homerail PR-B executeWauIntent retry 2x)
 */

/**
 * 7 个 WauWorkflowError code 字面量(per SDK Consumer Contract §二.4):
 *   - TIMEOUT: RPC 超时
 *   - AUTH_FAILED: JWT 4-claim 鉴权失败(per D66=B)
 *   - INVALID_HARNESS: voice workflow harness 不是 'codex-appserver'(per #17 配错保护)
 *   - INVALID_WORKFLOW_TYPE: workflow_type enum 不在 6 个允许值内
 *   - CONFIDENCE_TOO_LOW: workflow.confidence < 阈值(server-side 拒收,通常 < 0.3)
 *   - NETWORK_ERROR: HTTP/网络层错误(connect refused / DNS / TLS 等)
 *   - SERVER_ERROR: server 5xx + 业务错误(-32603 等)
 */
export type WauWorkflowErrorCode =
  | "TIMEOUT"
  | "AUTH_FAILED"
  | "INVALID_HARNESS"
  | "INVALID_WORKFLOW_TYPE"
  | "CONFIDENCE_TOO_LOW"
  | "NETWORK_ERROR"
  | "SERVER_ERROR";

/**
 * 7 个 code string 常量(跟 WauWorkflowErrorCode 字面量 union 1:1,便于 caller 用 === 比较)
 */
export const WauErrCodeTimeout: WauWorkflowErrorCode = "TIMEOUT";
export const WauErrCodeAuthFailed: WauWorkflowErrorCode = "AUTH_FAILED";
export const WauErrCodeInvalidHarness: WauWorkflowErrorCode = "INVALID_HARNESS";
export const WauErrCodeInvalidWorkflowType: WauWorkflowErrorCode =
  "INVALID_WORKFLOW_TYPE";
export const WauErrCodeConfidenceTooLow: WauWorkflowErrorCode =
  "CONFIDENCE_TOO_LOW";
export const WauErrCodeNetworkError: WauWorkflowErrorCode = "NETWORK_ERROR";
export const WauErrCodeServerError: WauWorkflowErrorCode = "SERVER_ERROR";

/**
 * 默认 retryable map(per #22 失败回退):除 INVALID_HARNESS + INVALID_WORKFLOW_TYPE 外都 retryable
 */
const DEFAULT_RETRYABLE: Record<WauWorkflowErrorCode, boolean> = {
  TIMEOUT: true,
  AUTH_FAILED: false, // 鉴权失败 retry 无效
  INVALID_HARNESS: false, // 配错保护,homerail PR-E handler 已经 throw,SDK 收到 = caller bug
  INVALID_WORKFLOW_TYPE: false, // server 返错 wire format,retry 无效
  CONFIDENCE_TOO_LOW: false, // 业务拒绝,retry 不会改 server 行为
  NETWORK_ERROR: true,
  SERVER_ERROR: true,
};

/**
 * WauWorkflowError(per SDK Consumer Contract §二.4):
 * caller 用 err.retryable 决定是否 retry(per #22 retry 2x + 失败回退)
 */
export class WauWorkflowError extends Error {
  public readonly code: WauWorkflowErrorCode;
  public readonly retryable: boolean;
  public override readonly cause?: Error;

  constructor(
    message: string,
    code: WauWorkflowErrorCode,
    retryable?: boolean,
    cause?: Error,
  ) {
    super(formatWauWorkflowErrorMessage(code, message));
    this.name = "WauWorkflowError";
    this.code = code;
    this.retryable = retryable ?? DEFAULT_RETRYABLE[code];
    if (cause !== undefined) {
      this.cause = cause;
    }
  }

  /** 跟 UCP RPCError.toString() 等价 */
  toString(): string {
    return `wau workflow error: code=${this.code} message=${JSON.stringify(this.message)}`;
  }
}

function formatWauWorkflowErrorMessage(
  code: WauWorkflowErrorCode,
  message: string,
): string {
  return `wau workflow error: code=${code} message=${JSON.stringify(message)}`;
}

/**
 * 把任意 error 转成 WauWorkflowError,失败返 null。
 *
 * 设计:本 SDK 抛的总是 WauWorkflowError(per SDK Consumer Contract §二.4);
 * network 层错(fetch throw TypeError) → caller catch 后手动包成 WauWorkflowError(NETWORK_ERROR)。
 */
export function asWauWorkflowError(err: unknown): WauWorkflowError | null {
  if (err instanceof WauWorkflowError) return err;
  return null;
}

/**
 * 判断 err 是否 retryable(per #22 retry 2x):
 *   - WauWorkflowError:读 err.retryable
 *   - 其他 error:默认 retryable(网络错等)
 */
export function isWauRetryable(err: unknown): boolean {
  const w = asWauWorkflowError(err);
  if (w !== null) return w.retryable;
  return true;
}