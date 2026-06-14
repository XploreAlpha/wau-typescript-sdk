/**
 * 错误层级 — 跟 wau-go-sdk errors.go 字段 1:1 对应
 * 所有错误继承 WauError;HTTP 4xx/5xx 自动映射到对应子类
 */

/** 所有 wau-sdk 错误的基类 */
export class WauError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** HTTP 4xx/5xx 错误基类 */
export class APIError extends WauError {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly requestId: string;
  public readonly body: Buffer | undefined;

  constructor(
    statusCode: number,
    message: string = "",
    code: string = "",
    requestId: string = "",
    body?: Buffer
  ) {
    super(formatMessage(statusCode, message, code, requestId, body));
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
    this.body = body;
  }

  /** 允许 errors.Is(err, ErrNotFound) 匹配 */
  is(target: WauError): boolean {
    if (target instanceof APIError && this instanceof APIError) {
      return this.statusCode === target.statusCode;
    }
    return false;
  }
}

function formatMessage(
  statusCode: number,
  message: string,
  code: string,
  requestId: string,
  body?: Buffer
): string {
  const parts = [`status=${statusCode}`];
  if (code) parts.push(`code=${code}`);
  if (requestId) parts.push(`request_id=${requestId}`);
  if (message) parts.push(`message=${message}`);
  if (body && body.length > 0) {
    const bodyStr = body.toString("utf-8", 0, Math.min(200, body.length));
    parts.push(`body=${JSON.stringify(bodyStr)}`);
  }
  return `WauAPIError(${parts.join(", ")})`;
}

/** 4xx/5xx 子类 */
export class NotFoundError extends APIError {
  constructor(message: string = "not found", code: string = "", requestId: string = "", body?: Buffer) {
    super(404, message, code || "not_found", requestId, body);
  }
}

export class UnauthorizedError extends APIError {
  constructor(message: string = "unauthorized", code: string = "", requestId: string = "", body?: Buffer) {
    super(401, message, code || "unauthorized", requestId, body);
  }
}

export class ForbiddenError extends APIError {
  constructor(message: string = "forbidden", code: string = "", requestId: string = "", body?: Buffer) {
    super(403, message, code || "forbidden", requestId, body);
  }
}

export class BadRequestError extends APIError {
  constructor(message: string = "bad request", code: string = "", requestId: string = "", body?: Buffer) {
    super(400, message, code || "bad_request", requestId, body);
  }
}

export class ConflictError extends APIError {
  constructor(message: string = "conflict", code: string = "", requestId: string = "", body?: Buffer) {
    super(409, message, code || "conflict", requestId, body);
  }
}

/** 熔断开 */
export class CircuitOpenError extends WauError {
  constructor(message: string = "circuit breaker is open") {
    super(message);
  }
}

/** 重试耗尽 (wraps last error) */
export class MaxRetriesError extends WauError {
  public readonly lastError: Error;

  constructor(lastError: Error, message: string = "max retries exceeded") {
    super(`${message}: ${lastError.message}`);
    this.lastError = lastError;
  }
}

/** P2 stub (gRPC IntentService) */
export class NotImplementedError extends WauError {}
