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
    public universes: string[] = []
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
