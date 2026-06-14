/**
 * AgentsService — 7 方法(对齐 wau-go-sdk agents.go)
 */

import { Transport } from "./transport";
import {
  Agent,
  AgentListResponse,
  AgentLoad,
  AgentRegisterRequest,
  AgentScore,
  AgentStatus,
  HealthResponse,
  PageOptions,
} from "./types";

export class AgentsService {
  constructor(private readonly transport: Transport) {}

  // ---- Health ----

  async health(): Promise<HealthResponse> {
    const data = (await this.transport.request("GET", "/health")) as HealthResponse;
    return new HealthResponse(
      data?.status ?? "unknown",
      data?.version ?? "",
      data?.uptime ?? 0,
      data?.redis ?? "",
      data?.error
    );
  }

  // ---- List ----

  async list(opts: PageOptions = {}): Promise<AgentListResponse> {
    const page = opts.page ?? 1;
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));
    const params: Record<string, string | number> = { page, pageSize };
    if (opts.skill) params.skill = opts.skill;
    if (opts.status) params.status = opts.status;
    if (opts.search) params.search = opts.search;

    const data = (await this.transport.request(
      "GET",
      "/registry/agents",
      undefined,
      params
    )) as AgentListResponse;

    return new AgentListResponse(
      (data.agents ?? []).map(
        (a) =>
          new Agent(
            a.name,
            a.id,
            a.url,
            a.description,
            a.skills,
            a.universes,
            a.trust,
            a.status,
            a.lastSeen
          )
      ),
      data.total ?? 0,
      data.page ?? 1,
      data.pageSize ?? 10,
      data.totalPages ?? 1
    );
  }

  // ---- Iter (lazy paginated) ----

  async *iter(opts: PageOptions = {}): AsyncIterableIterator<Agent> {
    let page = 1;
    const pageSize = Math.max(1, opts.pageSize ?? 10);
    while (true) {
      const resp = await this.list({ ...opts, page, pageSize });
      for (const a of resp.agents) {
        yield a;
      }
      if (page >= resp.totalPages) {
        return;
      }
      page++;
    }
  }

  // ---- Single agent ----

  async get(name: string): Promise<AgentStatus> {
    const data = (await this.transport.request(
      "GET",
      `/registry/agents/${name}/status`
    )) as {
      name: string;
      status: string;
      trust: number;
      load?: Partial<AgentLoad>;
      circuit: string;
    };
    const load = new AgentLoad(
      data.load?.activeTasks ?? 0,
      data.load?.maxCapacity ?? 10,
      data.load?.cpuUsage ?? 0,
      data.load?.memoryUsage ?? 0
    );
    return new AgentStatus(
      data.name ?? name,
      data.status ?? "unknown",
      data.trust ?? 0,
      load,
      data.circuit ?? "closed"
    );
  }

  async score(name: string): Promise<AgentScore> {
    const data = (await this.transport.request(
      "GET",
      `/registry/agents/${name}/score`
    )) as {
      name: string;
      totalScore: number;
      trustScore: number;
      skillMatch: number;
      healthScore: number;
      loadScore: number;
    };
    return new AgentScore(
      data.name ?? name,
      data.totalScore,
      data.trustScore,
      data.skillMatch,
      data.healthScore,
      data.loadScore
    );
  }

  // ---- Registration ----

  async register(req: AgentRegisterRequest): Promise<void> {
    await this.transport.request("POST", "/registry/agents/register", {
      name: req.name,
      url: req.url,
      description: req.description ?? "",
      skills: req.skills ?? [],
      universes: req.universes ?? [],
    });
  }

  async deregister(name: string): Promise<void> {
    await this.transport.request("DELETE", `/registry/agents/${name}`);
  }

  // ---- Heartbeat / Load ----

  async heartbeat(agentId: string): Promise<void> {
    await this.transport.request("POST", "/registry/agents/heartbeat", {
      agentId,
    });
  }

  async reportLoad(agentId: string, load: AgentLoad): Promise<void> {
    await this.transport.request("POST", "/heartbeat/load", {
      agentId,
      activeTasks: load.activeTasks,
      maxCapacity: load.maxCapacity,
      cpuUsage: load.cpuUsage,
      memoryUsage: load.memoryUsage,
    });
  }
}
