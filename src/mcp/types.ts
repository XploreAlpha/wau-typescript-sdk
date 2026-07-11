/**
 * MCP DTOs (wau-typescript-sdk v1.3.2, per D87.7).
 *
 * 8 DTOs aligned byte-equal to:
 *   - kernel `internal/protocol/mcp/handler.go` response shapes
 *   - wau-go-sdk `mcpclient/types.go` (v1.3.2, cross-SDK D13 byte-equal)
 *   - design doc [[process/2026-07-10-W3-MCP-client-SDK-design]] §二
 *
 * JSON 字段 snake_case (per MCP spec + JSON-RPC 2.0 wire format).
 */

// ────────────────────────────────────────────────────────
// send_message / parse_agent_card input
// ────────────────────────────────────────────────────────

export interface Part {
  type: "text" | "file" | "data";
  text?: string;
  file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
  data?: Record<string, unknown>;
}

export interface Message {
  role: "user" | "agent" | "system";
  parts: Part[];
  context_id?: string;
  metadata?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────
// Task (send_message / get_task / cancel_task output)
// ────────────────────────────────────────────────────────

export interface Artifact {
  type: "text" | "file" | "data";
  text?: string;
  file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
  data?: Record<string, unknown>;
}

export interface Task {
  task_id?: string;
  context_id?: string;
  status: "working" | "completed" | "failed" | "canceled";
  artifacts?: Artifact[];
  canceled_at?: string;
  history?: Record<string, unknown>[];
}

// ────────────────────────────────────────────────────────
// Agent card (parse_agent_card / get_extended_agent_card output)
// ────────────────────────────────────────────────────────

export interface AgentCard {
  name?: string;
  version?: string;
  description?: string;
  supported_interfaces?: string[];
  skills?: string[];
  url?: string;
  provider?: string;
  documentation_url?: string;
}

export interface ExtendedAgentCard {
  name?: string;
  version?: string;
  description?: string;
  supported_interfaces?: string[];
  skills?: string[];
  trust_score?: number;
  private_skills?: string[];
  owner_user_id?: string; // per D66=B RBAC
}

// ────────────────────────────────────────────────────────
// Health check (health_check output)
// ────────────────────────────────────────────────────────

export interface HealthCheckResult {
  status: "ok" | "degraded" | "unreachable";
  version?: string;
  uptime_seconds?: number;
}

// ────────────────────────────────────────────────────────
// List tasks (list_tasks output)
// ────────────────────────────────────────────────────────

export interface ListTasksFilter {
  status?: string[];
  context_id?: string;
  limit?: number;
  offset?: number;
}

export interface ListTasksResult {
  tasks: Task[];
  next_offset?: number | null;
}

// ────────────────────────────────────────────────────────
// Push notification config (create_task_push_notification_config)
// ────────────────────────────────────────────────────────

export interface PushConfig {
  url: string;
  events: string[];
  secret?: string;
}

export interface PushConfigResult {
  config_id?: string;
}