/**
 * Wau client — public API exports (per v1.0.1 Phase 0 拍板 + SDK Consumer Contract §二).
 *
 * ⭐ v1.3.1 WauClient skeleton (per D60 additive, 2026-07-12).
 *
 * 用法:
 *
 *     import { WauClient, type WauClientConfig } from "wau-sdk/wau";
 *     const cli = new WauClient({
 *       registry_url: "http://localhost:18401",
 *       intent_url: "http://localhost:18402",
 *       edge_url: "http://localhost:18403",
 *       heartbeat_interval_ms: 30000,
 *       dag_patterns_path: "assets/orchestrations/wau-dag-patterns/",
 *       system_capability: {
 *         category: "USER_ENTRY",
 *         sub_capabilities: [],
 *         trust_exempt: true,
 *       },
 *     });
 *     try {
 *       await cli.recommendWorkflow("find me aspirin");
 *     } catch (err) {
 *       if (isWauRetryable(err)) { /* retry 2x *\/ }
 *     }
 *
 * 协议合规:D60 additive / D78 byte-equal / D66=B RBAC / #1c / #17 / #22
 */

// DTO types(per SDK Consumer Contract §二.2)
export type {
  WauClientConfig,
  WauSystemCapability,
  WauWorkflow,
  WauWorkflowAgent,
  WauWorkflowDependency,
  WauWorkflowType,
} from "./types";

// Errors(per SDK Consumer Contract §二.4)
export {
  asWauWorkflowError,
  isWauRetryable,
  WauErrCodeAuthFailed,
  WauErrCodeConfidenceTooLow,
  WauErrCodeInvalidHarness,
  WauErrCodeInvalidWorkflowType,
  WauErrCodeNetworkError,
  WauErrCodeServerError,
  WauErrCodeTimeout,
  WauWorkflowError,
} from "./errors";
export type { WauWorkflowErrorCode } from "./errors";

// Client(constants + class)
export {
  WAU_DEFAULT_HEARTBEAT_INTERVAL_MS,
  WAU_DEFAULT_TIMEOUT_MS,
  WAU_DEFAULT_USER_AGENT,
  WauClient,
} from "./client";
// Client(types — must be export type under isolatedModules)
export type { FetchImpl, WauClientOptions } from "./client";