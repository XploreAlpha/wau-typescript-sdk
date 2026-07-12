/**
 * Wau client — 5 DTO (per v1.0.1 SoT doc + SDK Consumer Contract §二.1-2.2).
 *
 * 5 SDK 共享 wire format:JSON over HTTP at POST {baseURL}/v1/wau/* (mirror MCP/UCP pattern)
 * (跟 WAU-core-kernel wau-intent/wau-registry/wau-edge align)。
 *
 * 本文件 DTO 字段 byte-equal:5 SDK 必须字段名 + 类型 1:1 (per D78 byte-equal)。
 *
 * v1.3.1 拍板 (per 24-decisions-closure + WauWorkflow msg type spec):
 *   - WauWorkflow: 19 字段(5 必填 + 14 元数据 + DAG pattern + 鉴权)
 *   - WauClientConfig: 5 URL + systemCapability (per #1c 全局)
 *   - WauWorkflowType: 6 enum 值(per WauWorkflow msg type spec)
 *   - WauWorkflowAgent / WauWorkflowDependency: 嵌套 type
 *
 * JSON 字段 snake_case(per WauWorkflow msg type spec §三.3 + #14 A 拍板)
 *
 * 协议合规:
 *   - D60 additive: 0 改老 SDK,独立子包(跟 src/ucp/ src/mcp/ 1:1 pattern)
 *   - D78 byte-equal: 5 SDK 字段名 wire format 一致(本文件是 TS canonical)
 *   - D66=B RBAC: owner_user_id 维持 string(JWT 4-claim)
 *   - #1c 全局: category: 'USER_ENTRY' + trustExempt: true
 *   - #17 voice harness: harness 字段强校验 'codex-appserver'
 *   - #19 WauWorkflow 全字段 wire:5 必填 + 14 元数据,本文件 19 字段完整 export
 */

// NOTE: WauClientConfig is defined in this file (跟 UCP/MCP pattern 一致 —
// types 跟 client 同 sub-package 但 types 不依赖 client, client 依赖 types)

/**
 * WauWorkflowType enum(6 值,per WauWorkflow msg type spec §三.3)
 * 跟 wau-intent / afp-protocol proto WorkflowType 一致
 * (5 SDK byte-equal, snake_case uppercase 字符串 wire format)
 */
export type WauWorkflowType =
  | "WORKFLOW_TYPE_UNSPECIFIED"
  | "WORKFLOW_TYPE_SINGLE"
  | "WORKFLOW_TYPE_CHAIN"
  | "WORKFLOW_TYPE_PARALLEL"
  | "WORKFLOW_TYPE_QUORUM"
  | "WORKFLOW_TYPE_FAN_OUT";

// ────────────────────────────────────────────────────────
// WauWorkflow 嵌套 type(per SDK Consumer Contract §二.2)
// ────────────────────────────────────────────────────────

/**
 * 单个 agent 推荐块 — 跟 wau-intent proto WauWorkflowAgent 字段 1:1
 */
export interface WauWorkflowAgent {
  name: string;
  url: string;
  skills: string[];
  /** 0-1 浮点,server 推荐 confidence */
  confidence: number;
}

/**
 * DAG 依赖图节点 — 跟 wau-intent proto WauWorkflowDependency 字段 1:1
 */
export interface WauWorkflowDependency {
  upstream_agents: string[];
}

/**
 * SystemCapability(per #1c + #13):homerail-voice 严格 category: USER_ENTRY
 */
export interface WauSystemCapability {
  /** 唯一允许值:'USER_ENTRY'(per #1c) */
  category: "USER_ENTRY";
  /** 子能力清单(可空,空数组也算合法) */
  sub_capabilities: Array<{
    name: string;
    version: string;
    description: string;
  }>;
  /** Per #1b 全局:true(voice workflow trust_exempt) */
  trust_exempt: true;
}

/**
 * WauClientConfig(per SDK Consumer Contract §二.1):
 * 5 URL + systemCapability + 可选 timeout/auth
 */
export interface WauClientConfig {
  /** wau-registry 服务 URL,默认 http://localhost:18401 */
  registry_url: string;
  /** wau-intent 服务 URL,默认 http://localhost:18402 */
  intent_url: string;
  /** wau-edge 服务 URL,默认 http://localhost:18403(per #15 走 wau-edge 不直连) */
  edge_url: string;
  /** heartbeat 周期,默认 30000ms */
  heartbeat_interval_ms: number;
  /** DAG patterns 路径,默认 'assets/orchestrations/wau-dag-patterns/' */
  dag_patterns_path: string;
  /** 系统能力声明(per #1c + #13) */
  system_capability: WauSystemCapability;
  /** 可选:4 方法超时,默认 30000ms */
  timeout_ms?: number;
  /** 可选:JWT 4-claim override(per D66=B + #21),默认从 wau-edge 取 */
  auth_token?: string;
}

/**
 * WauWorkflow(per SDK Consumer Contract §二.2 + WauWorkflow msg type spec §三.3):
 * 19 字段全 wire format
 *
 * - 必填 5 字段:agents / dependency_graph / confidence / workflow_type / harness
 * - 标识 3 字段:workflow_id / created_at / user_id
 * - DAG pattern 元数据 3 optional:dag_pattern_hint / description / estimated_duration_ms
 * - 推荐上下文 3 字段:original_query / parent_workflow_id? / retry_count?
 * - Server metadata 3 字段:server_version / trace_id / ttl_ms
 * - 鉴权 2 字段:auth_user_id / auth_claim_set
 *
 * ⚠️ voice workflow 必须 harness='codex-appserver'(per #17 配错保护)
 */
export interface WauWorkflow {
  // === 必填 5 字段 ===
  agents: WauWorkflowAgent[];
  dependency_graph: {
    dependencies: Record<string, WauWorkflowDependency>;
  };
  confidence: number;
  workflow_type: WauWorkflowType;
  /** voice workflow 必须 'codex-appserver',其它 harness 抛错(per #17) */
  harness: string;

  // === 标识字段 ===
  workflow_id: string;
  /** unix ms */
  created_at: number;
  user_id: string;

  // === DAG pattern 元数据(per #4 抽象 wau-dag-patterns) ===
  dag_pattern_hint?: string;
  description?: string;
  estimated_duration_ms?: number;

  // === 推荐上下文 ===
  /** 用户原始 query */
  original_query: string;
  /** 子 workflow 追溯 */
  parent_workflow_id?: string;
  /** 0=首次,1+=重试 */
  retry_count?: number;

  // === Server-side metadata ===
  /** wau-intent server version,byte-equal verify anchor */
  server_version: string;
  /** 跨 SDK 调试 trace */
  trace_id: string;
  /** workflow 有效期,过期 client 拒收 */
  ttl_ms: number;

  // === 鉴权上下文(per D66=B JWT 4-claim) ===
  auth_user_id: string;
  /** 4 claim names:sub/aud/exp/scope */
  auth_claim_set: string[];
}