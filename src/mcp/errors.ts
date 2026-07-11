/**
 * MCP RPC error types (wau-typescript-sdk v1.3.2, per D87.7).
 *
 * 跟 wau-go-sdk `mcpclient/errors.go` 字段 1:1 对齐 (cross-SDK D13 byte-equal)。
 * JSON-RPC 2.0 spec 5 code + 3 MCP-specific code (-32001 ~ -32003, 跟 UCP -32101 ~ -32105 错开).
 */

// ────────────────────────────────────────────────────────
// JSON-RPC 2.0 spec error codes (跟 kernel mcp.ErrCode* 一致)
// ────────────────────────────────────────────────────────

export const ErrCodeParse = -32700;
export const ErrCodeInvalidRequest = -32600;
export const ErrCodeMethodNotFound = -32601;
export const ErrCodeInvalidParams = -32602;
export const ErrCodeInternal = -32603;

// MCP-specific (-32001 ~ -32003, 跟 UCP -32101 ~ -32105 错开)
export const ErrCodeMCPAgentUnreachable = -32001;
export const ErrCodeMCPInvalidAgentCard = -32002;
export const ErrCodeMCPTaskNotFound = -32003;

/** JSON-RPC 2.0 error envelope shape. */
export interface RPCErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

/** MCP RPCError class(extends Error + code + data)。*/
export class RPCError extends Error {
  public readonly code: number;
  public readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(formatRPCError(code, message));
    this.code = code;
    this.data = data;
    this.name = "RPCError";
  }

  static fromDict(d: RPCErrorPayload): RPCError {
    return new RPCError(Number(d.code ?? -32603), String(d.message ?? ""), d.data);
  }
}

function formatRPCError(code: number, message: string): string {
  return `mcp rpc error: code=${code} message=${JSON.stringify(message)}`;
}

/** 判断 err 是不是 agent unreachable 语义错误 (MCP spec)。*/
export function isAgentUnreachable(err: unknown): boolean {
  return err instanceof RPCError && err.code === ErrCodeMCPAgentUnreachable;
}

/** 判断 err 是不是 task 'not found' 语义错误 (MCP spec)。*/
export function isTaskNotFound(err: unknown): boolean {
  return err instanceof RPCError && err.code === ErrCodeMCPTaskNotFound;
}

/** Convert any error into RPCError (best effort). */
export function asRPCError(e: unknown): RPCError {
  if (e instanceof RPCError) return e;
  if (e instanceof Error) return new RPCError(ErrCodeInternal, e.message);
  return new RPCError(ErrCodeInternal, String(e));
}