/**
 * 配置类型 — 跟 wau-go-sdk options.go 字段 1:1 对应
 */

export enum Role {
  KERNEL_CORE = "kernel_core",
  TRUSTED_AGENT = "trusted_agent",
  EXTERNAL_AGENT = "external_agent",
}

/**
 * 重试配置 — 指数退避 + 抖动
 * 默认: maxRetries=3 / initial=200ms / max=5s / jitter=0.2
 * 只对**幂等**请求自动重试;非幂等 POST 默认不重试
 */
export interface RetryConfig {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitter: number; // [0, 1]
  retryOn: number[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialBackoffMs: 200,
  maxBackoffMs: 5000,
  jitter: 0.2,
  retryOn: [500, 502, 503, 504, 429],
};

/**
 * 熔断配置 (集成 wau-circuit)
 */
export interface CircuitConfig {
  failureThreshold: number; // default 5
  openTimeoutMs: number; // default 30000
  halfOpenMax: number; // default 1
  enabled: boolean; // default true
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  openTimeoutMs: 30000,
  halfOpenMax: 1,
  enabled: true,
};

/**
 * HS256 Bearer 鉴权配置
 *
 * exp: 5 分钟 (短; 每次请求新签)
 * jti: UUID v4 防重放
 *
 * per Stage 3.1 #1 修复(2026-07-01):wau-edge Claims 必填 tenant_id(per
 * wau-edge/internal/auth/jwt.go:96-98)。SDK 必须签 tenant_id,否则 401。
 * Subject 对齐 wau-edge Claims.Subject(sub claim),缺省用 agentName 兜底。
 */
export interface AuthConfig {
  role: Role;
  agentName: string;
  /** 租户 ID(必填,wau-edge 必校验,空字符串 = Signer 构造时 throw)*/
  tenantId: string;
  /** JWT 'sub' claim(可选;空 = 用 agentName 兜底)*/
  subject?: string;
  sharedSecret: string | Buffer;
}

/**
 * 顶层 SDK 配置
 */
export interface ClientOptions {
  timeoutMs?: number; // default 30000
  retry?: RetryConfig;
  circuit?: CircuitConfig;
  auth?: AuthConfig;
  userAgent?: string; // default "wau-typescript-sdk/0.6.0-preview.1"
  transport?: unknown; // axios 注入点(测试/代理)
}
