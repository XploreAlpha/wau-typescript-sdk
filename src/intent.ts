/**
 * IntentService — intent 解析 + agent 评分。
 *
 * ## 2026-11-19:从 gRPC stub 改成实装 HTTP
 *
 * 之前这个类是 **P2 stub**,4 个方法全部抛 NotImplementedError。
 * M3.1 一直没做。
 *
 * 但 kernel 侧**早就有可用的 HTTP 端点**了(2026-11-19 对着生产服务器
 * 100.125.139.145 实测确认):
 *
 * ```text
 * POST /v1/intent/parse  {message, source_universe?}
 *     → 200 {"intent":{"type","required_skills","urgency","estimated_complexity","source_universe"}}
 *
 * POST /v1/intent/score  {agents[], required_skills[], intent_type, urgency, source_universe?}
 *     → 200 {"scores":[{"AgentID","TotalScore","Dimensions":{...},"Rank"}]}
 * ```
 *
 * ⇒ **不必等 gRPC**,直接走 HTTP 就能把 intent 服务变成可用的。
 *
 * ## 形状上的坑(实测)
 *
 * `/v1/intent/score` 返回的 score 元素用的是 **Go 字段名**
 * (`AgentID` / `TotalScore` / `Dimensions`),不是 snake_case
 * —— 因为 `internal/scoring.AgentScore` 这个 struct **没有 json tag**。
 * 而 `/registry/agents/{name}/score` 返回的是 camelCase
 * (`agentId` / `totalScore` / `dimensions`)⇒ 两个端点形状不一致,两种都认。
 */

import { Transport } from "./transport";
import { Agent, HealthResponse } from "./types";

/** `POST /v1/intent/parse` 的解析结果。字段名跟 kernel 的 proxy.IntentEntry 1:1。 */
export class IntentEntry {
  constructor(
    public type: string = "",
    public required_skills: string[] = [],
    public urgency: string = "",
    public estimated_complexity: number = 0,
    public source_universe: string = ""
  ) {}
}

/** `POST /v1/intent/score` 里一个 agent 的评分。 */
export class IntentAgentScore {
  constructor(
    public agentId: string = "",
    public totalScore: number = 0,
    public dimensions: Record<string, number> = {},
    public rank: number = 0
  ) {}
}

/**
 * 从 agent 列表响应里取出元素数组。
 *
 * kernel 的 GET /registry/agents 返回**裸数组**,不是 {agents:[...]}。
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

export class IntentService {
  constructor(private readonly transport?: Transport) {}

  private get t(): Transport {
    if (!this.transport) {
      throw new Error(
        "IntentService 没有 transport —— 请通过 Client(...).intent 使用,不要直接 new IntentService()。"
      );
    }
    return this.transport;
  }

  /**
   * 解析用户输入的 intent —— 对应 POST /v1/intent/parse。
   */
  async parseIntent(text: string, sourceUniverse: string = ""): Promise<IntentEntry> {
    const body: Record<string, unknown> = { message: text };
    if (sourceUniverse) body.source_universe = sourceUniverse;

    const raw = (await this.t.request("POST", "/v1/intent/parse", body)) as Record<
      string,
      unknown
    >;

    const inner = (raw?.intent ?? raw) as Record<string, unknown>;
    const skills = (inner?.required_skills as string[]) ?? [];
    return new IntentEntry(
      (inner?.type as string) ?? "",
      Array.isArray(skills) ? skills : [],
      (inner?.urgency as string) ?? "",
      (inner?.estimated_complexity as number) ?? 0,
      (inner?.source_universe as string) ?? ""
    );
  }

  /**
   * 给 agent 列表打分 —— 对应 POST /v1/intent/score(按 Rank 升序)。
   */
  async scoreAgents(
    agents: string[],
    requiredSkills: string[] = [],
    intentType: string = "",
    urgency: string = "",
    sourceUniverse: string = ""
  ): Promise<IntentAgentScore[]> {
    const body: Record<string, unknown> = { agents };
    if (requiredSkills.length) body.required_skills = requiredSkills;
    if (intentType) body.intent_type = intentType;
    if (urgency) body.urgency = urgency;
    if (sourceUniverse) body.source_universe = sourceUniverse;

    const raw = (await this.t.request("POST", "/v1/intent/score", body)) as Record<
      string,
      unknown
    >;

    const items = (raw?.scores as Array<Record<string, unknown>>) ?? [];
    const scores = items.map((s) => {
      const dimsRaw = (s.Dimensions ?? s.dimensions) as Record<string, unknown>;
      const dimensions: Record<string, number> = {};
      if (dimsRaw && typeof dimsRaw === "object") {
        for (const [k, v] of Object.entries(dimsRaw)) {
          if (typeof v === "number") dimensions[k] = v;
        }
      }
      return new IntentAgentScore(
        (s.AgentID as string) ?? (s.agentId as string) ?? (s.agent_id as string) ?? "",
        (s.TotalScore as number) ?? (s.totalScore as number) ?? 0,
        dimensions,
        (s.Rank as number) ?? (s.rank as number) ?? 0
      );
    });

    scores.sort((a, b) => {
      const ra = a.rank || Number.MAX_SAFE_INTEGER;
      const rb = b.rank || Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return b.totalScore - a.totalScore;
    });
    return scores;
  }

  /**
   * 推荐最合适的 agent —— parse → list_agents → score → topK。
   */
  async recommend(prompt: string, topK: number = 1): Promise<IntentAgentScore[]> {
    const entry = await this.parseIntent(prompt);
    const agents = await this.listAgents();
    const names = agents.map((a) => a.name).filter((n) => n.length > 0);
    if (names.length === 0) return [];
    const scores = await this.scoreAgents(
      names,
      entry.required_skills,
      entry.type,
      entry.urgency,
      entry.source_universe
    );
    return scores.slice(0, Math.max(1, topK));
  }

  /**
   * 列出 agent —— 对应 GET /registry/agents(kernel 返回**裸数组**)。
   */
  async listAgents(onlineOnly: boolean = true): Promise<Agent[]> {
    const raw = await this.t.request("GET", "/registry/agents");
    const items = extractAgentItems(raw);
    const agents = items.map((a) => {
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
        (a as { universe_labels?: Record<string, string> }).universe_labels,
        (a.trust as number) ?? 0,
        (a.status as string) ?? "",
        (a.lastSeen as string) ?? ""
      );
    });
    return onlineOnly ? agents.filter((a) => a.name.length > 0) : agents;
  }

  /**
   * kernel 健康检查 —— 对应 GET /health。
   */
  async healthCheck(): Promise<HealthResponse> {
    const raw = (await this.t.request("GET", "/health")) as Record<string, unknown>;
    return new HealthResponse(
      (raw?.status as string) ?? "unknown",
      (raw?.version as string) ?? "",
      (raw?.uptime as number) ?? 0,
      (raw?.redis as string) ?? "",
      (raw?.error as string) ?? undefined
    );
  }
}
