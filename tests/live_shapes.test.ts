/**
 * ★ 2026-11-19 新增:kernel 真实响应形状的回归测试。
 *
 * 背景:2026-11-19 对着生产服务器 100.125.139.145 实测,发现 SDK 的解析层
 * 跟 kernel 的**真实响应**脱节:
 *
 *   agents.list  → kernel 返回**裸数组**(不是 {agents:[...]})
 *   agents.get   → kernel 返回 {agentId, online, lastSeen, trust:{...}, circuitState}
 *   agents.score → kernel 返回 {agentId, totalScore, dimensions:{15 维}}
 *   tasks.simulate → kernel 返回 best_agent/best_score(不是 selected_agent/score)
 *   tasks.submit   → candidate 带 url 字段
 *
 * 本文件用**真实抓到的响应体**做 mock,把这些形状钉死,防止再退化。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { Client } from "../src";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

// ── 真实抓到的响应体(2026-11-19,server 100.125.139.145)─────────────

const REAL_AGENTS_ARRAY = [
  {
    id: "hermes-shop01",
    name: "hermes-shop01",
    url: "http://100.125.198.80:9901/",
    version: "",
    skills: ["hermes_chat", "a2a", "chat"],
    universe: "hermes-saas",
  },
  {
    id: "matwau",
    name: "matwau",
    url: "http://106.53.3.108:8080/wau/dispatch",
    version: "",
    skills: ["multi_agent", "critic_llm"],
    universe: "matwau",
  },
];

const REAL_STATUS = {
  agentId: "hermes-shop01",
  online: true,
  lastSeen: 0,
  trust: {
    agentId: "hermes-shop01",
    score: 0.5,
    successCount: 0,
    failureCount: 0,
    avgLatencyMs: 0,
    lastUpdated: 1795077908,
  },
  circuitState: 0,
};

const REAL_SCORE = {
  agentId: "hermes-shop01",
  totalScore: 0.7450000000000002,
  dimensions: {
    skillMatch: 1, trustScore: 0.5, healthScore: 0.5, latencyScore: 1,
    loadScore: 0.5, successRate: 0.5, networkPenalty: 1,
    bandwidthScore: 1, authLevel: 1, protocolCompat: 1,
    historyCount: 0.5, errorRate: 1, availability: 1,
    versionCompat: 1, geoPenalty: 1,
  },
};

const REAL_SIMULATE = {
  best_agent: "hermes-shop01",
  best_score: 0.6186,
  url: "http://100.125.198.80:9901/",
  reason: "Selected by laya hermes-shop01 (score=0.62)",
  skills: ["hermes_chat", "a2a", "chat"],
  candidates: [{ name: "hermes-shop01", score: 0.6186, reason: "laya score 0.62" }],
  intent_source: "INTENT_SOURCE_AGENTREC",
  decision_time_ms: 3382,
};

const REAL_SUBMIT = {
  task_id: "54297c72-fa2c-4906-a2cb-cba1eb8b1e8d",
  agent_id: "hermes-shop02",
  agent_url: "http://100.125.198.80:9902/",
  score: 0.6626999974250793,
  decision: {
    intent_source: "INTENT_SOURCE_AGENTREC",
    decision_time_ms: 1780,
    score: 0.6627,
    candidates: [
      { name: "hermes-shop01", score: 0.6627, url: "http://100.125.198.80:9901/" },
      { name: "hermes-shop02", score: 0.2702, url: "http://100.125.198.80:9902/" },
    ],
  },
  status: "completed",
  selected_agent: "hermes-shop02",
  selected_agent_url: "http://100.125.198.80:9902/",
  response: "ok",
  round_trip_ms: 3077,
  a2a_call_ms: 1294,
  tried_agents: ["hermes-shop02", "hermes-shop01(sibling-won)"],
};

const REAL_INTENT_PARSE = {
  intent: {
    type: "task",
    required_skills: null,
    urgency: "normal",
    estimated_complexity: 1,
    source_universe: "hermes-saas",
  },
};

const REAL_INTENT_SCORE = {
  scores: [
    {
      AgentID: "hermes-shop01",
      TotalScore: 0.7450000000000002,
      Dimensions: {
        SkillMatch: 1, TrustScore: 0.5, HealthScore: 0.5, LatencyScore: 1,
        LoadScore: 0.5, SuccessRate: 0.5, NetworkPenalty: 1,
        BandwidthScore: 1, AuthLevel: 1, ProtocolCompat: 1,
        HistoryCount: 0.5, ErrorRate: 1, Availability: 1,
        VersionCompat: 1, GeoPenalty: 1,
      },
      Rank: 1,
    },
  ],
};

// ── agents.list:裸数组 ─────────────────────────────────────────────

describe("agents.list — kernel 真实形状(裸数组)", () => {
  it("解析裸数组", async () => {
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "1", pageSize: "10" })
      .reply(200, REAL_AGENTS_ARRAY);

    const c = new Client("http://mock:18400");
    const resp = await c.agents.list();
    expect(resp.agents).toHaveLength(2);
    expect(resp.agents[0].name).toBe("hermes-shop01");
    expect(resp.agents[0].id).toBe("hermes-shop01");
    expect(resp.agents[0].url).toBe("http://100.125.198.80:9901/");
    expect(resp.agents[0].skills).toEqual(["hermes_chat", "a2a", "chat"]);
    // 单数 universe 字段也要并进 universes
    expect(resp.agents[0].universes).toContain("hermes-saas");
    expect(resp.total).toBe(2);
  });

  it("仍兼容旧 {agents:[...]} 形状", async () => {
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "1", pageSize: "10" })
      .reply(200, {
        agents: [{ name: "Whis", url: "http://whis:18800", skills: ["general"] }],
        total: 1, page: 1, pageSize: 10, totalPages: 1,
      });

    const c = new Client("http://mock:18400");
    const resp = await c.agents.list();
    expect(resp.agents).toHaveLength(1);
    expect(resp.agents[0].name).toBe("Whis");
  });

  it("兼容 registry 的 {cards:[...]} 形状", async () => {
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "1", pageSize: "10" })
      .reply(200, {
        cards: [{ name: "hermes-shop01", url: "http://x:9901/", skills: ["a2a"], universes: ["hermes-saas"] }],
        total: 1,
      });

    const c = new Client("http://mock:18400");
    const resp = await c.agents.list();
    expect(resp.agents).toHaveLength(1);
    expect(resp.agents[0].name).toBe("hermes-shop01");
  });
});

// ── agents.get / agents.score ───────────────────────────────────────

describe("agents.get / agents.score — kernel 真实形状", () => {
  it("get 解析 agentId/online/trust 对象/circuitState", async () => {
    nock("http://mock:18400")
      .get("/registry/agents/hermes-shop01/status")
      .reply(200, REAL_STATUS);

    const c = new Client("http://mock:18400");
    const st = await c.agents.get("hermes-shop01");
    expect(st.name).toBe("hermes-shop01");
    expect(st.status).toBe("online");
    expect(st.agentId).toBe("hermes-shop01");
    expect(st.online).toBe(true);
    expect(st.trust).toBe(0.5);
    expect(st.circuit).toBe("closed");
    expect(st.circuitState).toBe(0);
  });

  it("score 解析嵌套 dimensions", async () => {
    nock("http://mock:18400")
      .get("/registry/agents/hermes-shop01/score")
      .reply(200, REAL_SCORE);

    const c = new Client("http://mock:18400");
    const sc = await c.agents.score("hermes-shop01");
    expect(sc.name).toBe("hermes-shop01");
    expect(sc.agentId).toBe("hermes-shop01");
    expect(sc.totalScore).toBeCloseTo(0.745);
    expect(Object.keys(sc.dimensions)).toHaveLength(15);
    // 平铺字段从 dimensions 回填
    expect(sc.skillMatch).toBe(1);
    expect(sc.trustScore).toBe(0.5);
    expect(sc.healthScore).toBe(0.5);
    expect(sc.loadScore).toBe(0.5);
  });
});

// ── tasks.simulate / tasks.submit ───────────────────────────────────

describe("tasks — kernel 真实形状", () => {
  it("simulate 解析 best_agent/best_score", async () => {
    nock("http://mock:18400").post("/registry/tasks/simulate").reply(200, REAL_SIMULATE);

    const c = new Client("http://mock:18400");
    const d = await c.tasks.simulate({ prompt: "查血糖" });
    expect(d.selected_agent).toBe("hermes-shop01");
    expect(d.best_agent).toBe("hermes-shop01");
    expect(d.score).toBeCloseTo(0.6186);
    expect(d.url).toBe("http://100.125.198.80:9901/");
    expect(d.intent_source).toBe("INTENT_SOURCE_AGENTREC");
    expect(d.candidates).toHaveLength(1);
  });

  it("submit 解析 candidate.url", async () => {
    nock("http://mock:18400").post("/registry/tasks/submit").reply(200, REAL_SUBMIT);

    const c = new Client("http://mock:18400");
    const r = await c.tasks.submit({ prompt: "说两个字" });
    expect(r.task_id).toBe("54297c72-fa2c-4906-a2cb-cba1eb8b1e8d");
    expect(r.selected_agent).toBe("hermes-shop02");
    expect(r.status).toBe("completed");
    expect(r.decision.candidates).toHaveLength(2);
    expect(r.decision.candidates[0].url).toBe("http://100.125.198.80:9901/");
    expect(r.decision.candidates[0].name).toBe("hermes-shop01");
  });
});

// ── intent(2026-11-19 从 stub 改实装)────────────────────────────────

describe("intent — 2026-11-19 实装 HTTP", () => {
  it("parseIntent 调 /v1/intent/parse", async () => {
    nock("http://mock:18400").post("/v1/intent/parse").reply(200, REAL_INTENT_PARSE);

    const c = new Client("http://mock:18400");
    const e = await c.intent.parseIntent("帮我查血糖趋势");
    expect(e.type).toBe("task");
    expect(e.urgency).toBe("normal");
    expect(e.estimated_complexity).toBe(1);
    expect(e.source_universe).toBe("hermes-saas");
    expect(e.required_skills).toEqual([]);
  });

  it("scoreAgents 解析 Go 字段名", async () => {
    nock("http://mock:18400").post("/v1/intent/score").reply(200, REAL_INTENT_SCORE);

    const c = new Client("http://mock:18400");
    const scores = await c.intent.scoreAgents(["hermes-shop01"]);
    expect(scores).toHaveLength(1);
    expect(scores[0].agentId).toBe("hermes-shop01");
    expect(scores[0].totalScore).toBeCloseTo(0.745);
    expect(scores[0].rank).toBe(1);
    expect(Object.keys(scores[0].dimensions)).toHaveLength(15);
  });

  it("listAgents 解析裸数组", async () => {
    nock("http://mock:18400").get("/registry/agents").reply(200, REAL_AGENTS_ARRAY);

    const c = new Client("http://mock:18400");
    const agents = await c.intent.listAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe("hermes-shop01");
  });

  it("healthCheck", async () => {
    nock("http://mock:18400").get("/health").reply(200, {
      redis: "connected", status: "ok", uptime: 1708613.346685623, version: "v1.3.4",
    });

    const c = new Client("http://mock:18400");
    const h = await c.intent.healthCheck();
    expect(h.status).toBe("ok");
    expect(h.version).toBe("v1.3.4");
  });

  it("recommend 走 parse → list → score 全链路", async () => {
    nock("http://mock:18400").post("/v1/intent/parse").reply(200, REAL_INTENT_PARSE);
    nock("http://mock:18400").get("/registry/agents").reply(200, REAL_AGENTS_ARRAY);
    nock("http://mock:18400").post("/v1/intent/score").reply(200, REAL_INTENT_SCORE);

    const c = new Client("http://mock:18400");
    const scores = await c.intent.recommend("查血糖趋势", 1);
    expect(scores).toHaveLength(1);
    expect(scores[0].agentId).toBe("hermes-shop01");
  });
});
