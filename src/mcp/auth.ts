/**
 * MCP auth helpers (wau-typescript-sdk v1.3.2, per D87.7).
 *
 * Bearer token 注入 helper (per D78/D79/D80 + W3-MCP-auth-SDK-design §三)。
 */

export const AuthHeaderName = "Authorization";
export const AuthSchemePrefix = "Bearer ";
export const DefaultUserAgent = "wau-typescript-sdk/mcpclient/v1.3.2";

/** 注入 Authorization: Bearer <token> 到 headers。*/
export function setBearerToken(headers: Record<string, string>, token: string): Record<string, string> {
  if (token) {
    headers[AuthHeaderName] = AuthSchemePrefix + token;
  } else {
    delete headers[AuthHeaderName];
  }
  return headers;
}

/** 构造 MCP request headers (Content-Type + User-Agent + Authorization)。*/
export function buildHeaders(
  bearerToken?: string,
  userAgent?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": userAgent ?? DefaultUserAgent,
  };
  if (bearerToken) {
    setBearerToken(h, bearerToken);
  }
  if (extra) {
    Object.assign(h, extra);
  }
  return h;
}

/** MCP auth wrapper — 持有 bearer token,提供运行时更新能力 (W5+ refresh flow 用)。*/
export class McpAuth {
  private _token: string;

  constructor(token = "") {
    this._token = token;
  }

  get token(): string {
    return this._token;
  }

  setBearerToken(token: string): void {
    this._token = token;
  }

  apply(headers: Record<string, string>): Record<string, string> {
    return setBearerToken(headers, this._token);
  }
}