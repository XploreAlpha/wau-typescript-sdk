/**
 * UCP client — auth helpers (per D88.7, W3 UCP client SDK design §四).
 *
 * 跟 MCP 共享同一 Authorization channel(D78/D79/D80);W2.0 拍板 JWT 4 claims
 * + UCP spec OAuth 2.0 identity_linking(AI agent 跟人类用户绑定)。
 *
 * D13 byte-equal 跨 5 SDK 共享 header 名 / format(跟 wau-go-sdk + wau-python-sdk 字段一致)。
 *
 * 注:本文件是针对 fetch Request 的 helper(mirror Go 的 net/http Request + Python 的 httpx.Request);
 * 用 fetchImpl 注入做依赖反转,跟 wau-python-sdk/ucp_auth.py 同 pattern。
 */

/**
 * 标准 Authorization header 名(RFC 6750 Bearer Token)。
 */
export const AUTH_HEADER_NAME = "Authorization";

/**
 * bearer token 前缀。
 */
export const AUTH_SCHEME_PREFIX = "Bearer ";

/**
 * 默认 tenant header 名(W3 不传,W5+ 多租户 add)。
 */
export const DEFAULT_TENANT_HEADER_NAME = "X-WAU-Tenant-ID";

/**
 * 给现有 fetch Headers 注入 bearer token(per OAuth 2.0 / RFC 6750)。
 */
export function setBearerToken(headers: Headers, token: string): void {
  if (token === "") return;
  headers.set(AUTH_HEADER_NAME, AUTH_SCHEME_PREFIX + token);
}

/**
 * 给现有 fetch Headers 注入 tenant ID(per D65 multi-tenant)。
 *
 * W3 stub 阶段不传;W5+ 多租户切换时启用。
 */
export function setTenantID(headers: Headers, tenantID: string): void {
  if (tenantID === "") return;
  headers.set(DEFAULT_TENANT_HEADER_NAME, tenantID);
}

/**
 * UcpAuth 是 UCP-specific OAuth 2.0 identity_linking 入口(W5 完整实装)。
 *
 * W3 stub:只保留 bearer token + tenant ID 的 helper,W5+ 加 OAuth refresh flow。
 * 设计参考 UCP spec identity_linking(AI agent ↔ 人类用户绑定)。
 */
export class UcpAuth {
  /** 当前 JWT(OAuth 2.0 access token) */
  public bearerToken: string;
  /** 当前 tenant(W5+ 多租户切换) */
  public tenantID: string;

  constructor(bearerToken: string = "", tenantID: string = "") {
    this.bearerToken = bearerToken;
    this.tenantID = tenantID;
  }

  /**
   * 给 fetch Headers 注入 Authorization + X-WAU-Tenant-ID header。
   */
  apply(headers: Headers): void {
    setBearerToken(headers, this.bearerToken);
    setTenantID(headers, this.tenantID);
  }
}
