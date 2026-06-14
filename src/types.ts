/**
 * DTO 定义 — 跟 wau-go-sdk types.go 字段 1:1 对应
 * 所有字段以 WAU-core-kernel 真相源为准
 */

export interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  redis: string;
  error?: string;
}

export interface KernelInfo {
  version: string;
  startTime: string;
  uptime: number;
  agentsCount: number;
  tasksCount: number;
}

export interface Agent {
  name: string;
  id?: string;
  url?: string;
  description?: string;
  skills?: string[];
  universes?: string[];
  trust?: number;
  status?: string;
  lastSeen?: string;
}

export interface AgentListResponse {
  agents: Agent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PageOptions {
  page?: number; // 1-based; default 1
  pageSize?: number; // default 10, max 100
  skill?: string;
  status?: string;
  search?: string;
}

export interface AgentRegisterRequest {
  name: string;
  url: string;
  description?: string;
  skills?: string[];
  universes?: string[];
}

export interface AgentScore {
  name: string;
  totalScore?: number;
  trustScore?: number;
  skillMatch?: number;
  healthScore?: number;
  loadScore?: number;
}

export interface AgentLoad {
  activeTasks?: number;
  maxCapacity?: number;
  cpuUsage?: number;
  memoryUsage?: number;
}

export interface AgentStatus {
  name: string;
  status: string;
  trust: number;
  load: AgentLoad;
  circuit: string;
}

export interface Task {
  taskId: string;
  message?: string;
  sourcePeer?: string;
  sourceAgentId?: string;
  status?: string;
  assignedAgent?: string;
  result?: string;
  createdAt?: number;
  updatedAt?: number;
  requiredSkills?: string[];
}

/**
 * L4 提交请求 — 字段以 kernel 真相源为准 (Prompt + TimeoutMs)
 * v0.6.0 M3 关键修正: 跟 wau-cli 旧 DTO {message, sourcePeer, ...} 不一致
 */
export interface SubmitRequest {
  prompt: string;
  timeoutMs?: number;
}

export interface Candidate {
  name: string;
  score: number;
  reason: string;
}

export interface DecisionInfo {
  selected_agent: string;
  score: number;
  decision_time_ms: number;
  candidates?: Candidate[];
}

export interface SubmitResponse {
  task_id: string;
  agent_id?: string;
  agent_url?: string;
  score?: number;
  dimensions?: Record<string, number>;
  decision: DecisionInfo;
  status: string;
  selected_agent?: string;
  a2a_call_ms?: number;
  response?: unknown;
  error?: string;
  source_peer?: string;
  source_agent_id?: string;
}
