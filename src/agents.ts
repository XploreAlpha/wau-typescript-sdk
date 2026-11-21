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

    const raw = (await this.transport.request(
      "GET",
      "/registry/agents",
      undefined,
      params
    )) as unknown;

    // ★ 2026-11-19:kernel 的 GET /registry/agents 返回**裸数组**
    // (实测:[{"id","name","url","version","skills","universe"}, ...]),
    // 不是 {agents:[...]} ⇒ 旧解析拿不到 agents。
    // ⇒ 兼容三种形状:裸数组 / {agents:[...]} / {cards:[...]}。
    const items = extractAgentItems(raw);

    const total = items.length;

    return new AgentListResponse(
      items.map((a) => {
        // kernel 的元素用**单数** universe 字段;registry 卡片用复数 universes[]
        const universes = [...((a.universes as string[]) ?? [])];
        const universe = (a as { universe?: string }).universe;
        if (universe && !universes.includes(universe)) universes.push(universe);
        return new Agent(
          (a.name as string) ?? "",
          (a.id as string) ?? "",
          (a.url as string) ?? "",
          (a.description as string) ?? "",
          (a.skills as string[]) ?? [],
          universes,
          // v0.8.0 M3-2C: server JSON 返 snake_case universe_labels
          // 旧 server 不会返此字段 → undefined,Agent 构造函数 universeLabels?: Record<string, string> 兼容
          (a as { universe_labels?: Record<string, string> }).universe_labels,
          (a.trust as number) ?? 0,
          (a.status as string) ?? "",
          (a.lastSeen as string) ?? ""
        );
      }),
      total,
      opts.page ?? 1,
      pageSize,
      Math.max(1, Math.ceil(total / pageSize))
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
    // ★ 2026-11-19:kernel 真实响应是
    // {"agentId","online":bool,"lastSeen":N,"trust":{...},"circuitState":N}
    // 旧 SDK 期望 {"name","status","trust":number,"load","circuit"}
    // ⇒ trust 可能是数字也可能是对象 ⇒ 两种都认。
    const raw = (await this.transport.request(
      "GET",
      `/registry/agents/${name}/status`
    )) as Record<string, unknown>;

    const loadData = (raw?.load ?? {}) as Partial<AgentLoad>;
    const load = new AgentLoad(
      loadData.activeTasks ?? 0,
      loadData.maxCapacity ?? 10,
      loadData.cpuUsage ?? 0,
      loadData.memoryUsage ?? 0
    );

    const trustRaw = raw?.trust;
    let trust = 0;
    let trustDetail: Record<string, unknown> = {};
    if (typeof trustRaw === "number") {
      trust = trustRaw;
    } else if (trustRaw && typeof trustRaw === "object") {
      trustDetail = trustRaw as Record<string, unknown>;
      const s = (trustRaw as { score?: number }).score;
      trust = typeof s === "number" ? s : 0;
    }

    const online = raw?.online === true;
    const circuitState = typeof raw?.circuitState === "number" ? raw.circuitState : 0;
    const circuitNames: Record<number, string> = {
      0: "closed",
      1: "open",
      2: "half_open",
    };

    // status:优先显式字符串,没有才从 online 推导
    const status =
      typeof raw?.status === "string" && raw.status
        ? raw.status
        : online
          ? "online"
          : "offline";
    // circuit:优先显式字符串,没有才从 circuitState 映射
    const circuit =
      typeof raw?.circuit === "string" && raw.circuit
        ? raw.circuit
        : (circuitNames[circuitState] ?? String(circuitState));

    return new AgentStatus(
      (raw?.agentId as string) ?? (raw?.name as string) ?? name,
      status,
      trust,
      load,
      circuit,
      (raw?.agentId as string) ?? "",
      online,
      typeof raw?.lastSeen === "number" ? raw.lastSeen : 0,
      trustDetail,
      circuitState
    );
  }

  async score(name: string): Promise<AgentScore> {
    // ★ 2026-11-19:kernel 返回 {"agentId","totalScore","dimensions":{15 维}}
    // ⇒ 平铺字段从 dimensions 回填。
    const raw = (await this.transport.request(
      "GET",
      `/registry/agents/${name}/score`
    )) as Record<string, unknown>;

    const dimsRaw = raw?.dimensions;
    const dimensions: Record<string, number> = {};
    if (dimsRaw && typeof dimsRaw === "object") {
      for (const [k, v] of Object.entries(dimsRaw as Record<string, unknown>)) {
        if (typeof v === "number") dimensions[k] = v;
      }
    }

    const pick = (key: string): number =>
      typeof dimensions[key] === "number" ? (dimensions[key] as number) : 0;

    return new AgentScore(
      (raw?.agentId as string) ?? (raw?.name as string) ?? name,
      typeof raw?.totalScore === "number" ? raw.totalScore : 0,
      pick("trustScore"),
      pick("skillMatch"),
      pick("healthScore"),
      pick("loadScore"),
      (raw?.agentId as string) ?? "",
      dimensions
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
      // ★ 2026-11-19:带上调用凭证
      auth_token: req.authToken ?? "",
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

/**
 * ★ 2026-11-19:从 agent 列表响应里取出元素数组。
 *
 * kernel 的 GET /registry/agents 返回**裸数组**
 * (实测:[{"id","name","url","version","skills","universe"}, ...]),
 * 不是 {agents:[...]} ⇒ 旧解析拿不到 agents。
 * 兼容三种形状:裸数组 / {agents:[...]} / {cards:[...]}。
 */
function extractAgentItems(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["agents", "cards", "items"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
  }
  return [];
}
