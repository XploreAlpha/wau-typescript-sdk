/**
 * DTO 类 — 跟 wau-go-sdk types.go 字段 1:1 对应
 * 所有字段以 WAU-core-kernel 真相源为准
 */

export class HealthResponse {
  constructor(
    public status: string = "",
    public version: string = "",
    public uptime: number = 0,
    public redis: string = "",
    public error?: string
  ) {}
}

export class KernelInfo {
  constructor(
    public version: string = "",
    public startTime: string = "",
    public uptime: number = 0,
    public agentsCount: number = 0,
    public tasksCount: number = 0
  ) {}
}

export class Agent {
  constructor(
    public name: string = "",
    public id: string = "",
    public url: string = "",
    public description: string = "",
    public skills: string[] = [],
    public universes: string[] = [],
    // universeLabels K8s-style labels(per universe,v0.8.0 M3-2C 新增)
    //   - 业务分组用 universes(原字段,保持向后兼容)
    //   - 资源 / 调度特征用 universeLabels(新字段)
    //   - 老 client 不传 → undefined(server 视为空 map)
    //   - 字段名跟 afp-protocol + WAU-core-kernel proto + wau-go-sdk + wau-python-sdk 1:1 对齐
    public universeLabels?: Record<string, string>,
    public trust: number = 0,
    public status: string = "",
    public lastSeen: string = ""
  ) {}
}

export class AgentListResponse {
  constructor(
    public agents: Agent[] = [],
    public total: number = 0,
    public page: number = 1,
    public pageSize: number = 10,
    public totalPages: number = 1
  ) {}
}

export class PageOptions {
  /** 1-based; default 1 */
  public page?: number;
  /** default 10, max 100 */
  public pageSize?: number;
  public skill?: string;
  public status?: string;
  public search?: string;
}

export class AgentRegisterRequest {
  constructor(
    public name: string = "",
    public url: string = "",
    public description: string = "",
    public skills: string[] = [],
    public universes: string[] = [],
    // universeLabels 跟 Agent.universeLabels 字段语义一致(v0.8.0 M3-2C 新增)
    public universeLabels?: Record<string, string>
  ) {}
}

export class AgentScore {
  constructor(
    public name: string = "",
    public totalScore: number = 0,
    public trustScore: number = 0,
    public skillMatch: number = 0,
    public healthScore: number = 0,
    public loadScore: number = 0
  ) {}
}

export class AgentLoad {
  constructor(
    public activeTasks: number = 0,
    public maxCapacity: number = 10,
    public cpuUsage: number = 0,
    public memoryUsage: number = 0
  ) {}
}

export class AgentStatus {
  constructor(
    public name: string = "",
    public status: string = "",
    public trust: number = 0,
    public load: AgentLoad = new AgentLoad(),
    public circuit: string = "closed"
  ) {}
}

export class Task {
  constructor(
    public taskId: string = "",
    public message: string = "",
    public sourcePeer: string = "",
    public sourceAgentId: string = "",
    public status: string = "",
    public assignedAgent: string = "",
    public result: string = "",
    public createdAt: number = 0,
    public updatedAt: number = 0,
    public requiredSkills: string[] = []
  ) {}
}

/**
 * L4 提交请求 — 字段以 kernel 真相源为准 (Prompt + TimeoutMs)
 * v0.6.0 M3 关键修正: 跟 wau-cli 旧 DTO {message, sourcePeer, ...} 不一致
 */
export class SubmitRequest {
  constructor(
    public prompt: string,
    public timeoutMs?: number
  ) {}
}

export class Candidate {
  constructor(
    public name: string = "",
    public score: number = 0,
    public reason: string = ""
  ) {}
}

export class DecisionInfo {
  constructor(
    public selected_agent: string = "",
    public score: number = 0,
    public decision_time_ms: number = 0,
    public candidates: Candidate[] = []
  ) {}
}

export class SubmitResponse {
  constructor(
    public task_id: string = "",
    public agent_id: string = "",
    public selected_agent: string = "",
    public score: number = 0,
    public decision: DecisionInfo = new DecisionInfo(),
    public status: string = "",
    public a2a_call_ms: number = 0,
    public response: unknown = null,
    public error: string = "",
    public source_peer: string = "",
    public source_agent_id: string = ""
  ) {}
}

// v0.8.0 M5-1 B.1 — Handshake DTO

export class HandshakeRequest {
  constructor(
    public tenantId: string,
    public agentId: string,
    public protocol: string = "a2a",
    public universe: string = "",
    public clientId: string = ""
  ) {}
}

export class HandshakeResponse {
  constructor(
    public sessionId: string = "",
    public directEndpoint: string = "",
    public protocol: string = "",
    public expiresAt: string = "",
    public ttlSeconds: number = 0,
    public reused: boolean = false
  ) {}
}

export class HandshakeSessionDetail {
  constructor(
    public sessionId: string = "",
    public tenantId: string = "",
    public clientId: string = "",
    public agentId: string = "",
    public directEndpoint: string = "",
    public protocol: string = "",
    public trustScore: number = 0,
    public createdAt: string = "",
    public expiresAt: string = "",
    public ttlSeconds: number = 0,
    public reuseCount: number = 0
  ) {}
}

export class HandshakeStats {
  constructor(
    public totalSessions: number = 0,
    public totalReuses: number = 0,
    public reuseHitRate: number = 0,
    public activeSessions: number = 0,
    public perTenant: Record<string, { sessions: number; reuses: number; hitRate: number }> = {}
  ) {}
}

// ============== Chat / LLM DTO(v0.9.0 M3 §3.7 新增,per D20 architecture-pivot)==============
// 字段 1:1 对齐 OpenAI Chat Completions API + wau-go-sdk Chat DTO,
// 4 SDK 通用,test mock 跟真 wau-edge 字节级兼容(per M2 §2.5 端到端 mock 验证)。

export class ChatMessage {
  constructor(
    public role: string = "",
    public content: string = "",
    public name: string = ""
  ) {}
}

export class ChatCompletionRequest {
  constructor(
    public model: string = "",
    public messages: ChatMessage[] = [],
    public stream: boolean = false,
    public universe: string = "",
    public metadata: Record<string, string> = {},
    public temperature?: number,
    public maxTokens: number = 0
  ) {}
}

export class ChatChoice {
  constructor(
    public index: number = 0,
    public message: ChatMessage = new ChatMessage(),
    public finishReason: string = ""
  ) {}
}

export class ChatUsage {
  constructor(
    public promptTokens: number = 0,
    public completionTokens: number = 0,
    public totalTokens: number = 0
  ) {}
}

export class ChatCompletionResponse {
  constructor(
    public id: string = "",
    public object: string = "chat.completion",
    public created: number = 0,
    public model: string = "",
    public choices: ChatChoice[] = [],
    public usage: ChatUsage = new ChatUsage(),
    public reason: string = "" // WAU 扩展,wau-llm-router 决策原因
  ) {}
}

// ============== Streaming SSE DTO(per Stage 3.1 #10, 2026-07-02)==============
//
// OpenAI ChatCompletionChunk 协议 1:1 对齐(per https://platform.openai.com/docs/api-reference/chat-streaming)。
// 4 SDK 通用字段(per Stage 0 4 SDK 5/5 字段对齐)。
//
// 完整链路(per Stage 3.1 #10):
//   SDK → wau-edge :18402 /v1/chat/completions?stream=true
//       → wau-llm-router :18404 Resolve(unary, 拿 userToken + model)
//       → new-api sidecar :3000 /v1/chat/completions?stream=true
//       → DeepSeek v4-flash reasoning model → SSE chunks → 响应回 SDK

export class ChunkDelta {
  constructor(
    public role: string = "",
    public content: string = ""
  ) {}
}

export class ChunkChoice {
  constructor(
    public index: number = 0,
    public delta: ChunkDelta = new ChunkDelta(),
    public finishReason: string | null = null
  ) {}
}

export class ChatCompletionChunk {
  constructor(
    public id: string = "",
    public object: string = "chat.completion.chunk",
    public created: number = 0,
    public model: string = "",
    public choices: ChunkChoice[] = []
  ) {}
}
