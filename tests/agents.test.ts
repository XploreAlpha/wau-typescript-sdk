/**
 * AgentsService 单测 — 7 方法(nock mock kernel)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { Client, PageOptions } from "../src";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

describe("AgentsService.list", () => {
  it("默认 page/pageSize", async () => {
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "1", pageSize: "10" })
      .reply(200, {
        agents: [
          { name: "Whis", url: "http://whis:18800", skills: ["general"], status: "online", trust: 0.85 },
          { name: "Jarvis", url: "http://jarvis:18800", skills: ["clinical"], status: "online", trust: 0.92 },
        ],
        total: 2, page: 1, pageSize: 10, totalPages: 1,
      });

    const c = new Client("http://mock:18400");
    const resp = await c.agents.list();
    expect(resp.agents).toHaveLength(2);
    expect(resp.agents[0].name).toBe("Whis");
    expect(resp.agents[1].name).toBe("Jarvis");
  });

  it("with filters", async () => {
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "2", pageSize: "5", skill: "clinical", status: "online" })
      .reply(200, {
        agents: [{ name: "Jarvis", status: "online", trust: 0.9 }],
        total: 1, page: 2, pageSize: 5, totalPages: 1,
      });

    const c = new Client("http://mock:18400");
    const resp = await c.agents.list({
      page: 2, pageSize: 5, skill: "clinical", status: "online",
    });
    expect(resp.agents).toHaveLength(1);
    expect(resp.agents[0].name).toBe("Jarvis");
  });
});

describe("AgentsService.iter", () => {
  it("懒加载遍历所有页", async () => {
    // 2 页
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "1", pageSize: "1" })
      .reply(200, {
        agents: [{ name: "Whis", status: "online", trust: 0.85 }],
        total: 2, page: 1, pageSize: 1, totalPages: 2,
      });
    nock("http://mock:18400")
      .get("/registry/agents")
      .query({ page: "2", pageSize: "1" })
      .reply(200, {
        agents: [{ name: "Jarvis", status: "online", trust: 0.92 }],
        total: 2, page: 2, pageSize: 1, totalPages: 2,
      });

    const c = new Client("http://mock:18400");
    const names: string[] = [];
    for await (const a of c.agents.iter(new PageOptions({ pageSize: 1 }))) {
      names.push(a.name);
    }
    expect(names).toEqual(["Whis", "Jarvis"]);
  });
});

describe("AgentsService.get / score / register / deregister", () => {
  it("get status 含 load", async () => {
    nock("http://mock:18400")
      .get("/registry/agents/jarvis/status")
      .reply(200, {
        name: "jarvis", status: "online", trust: 0.9,
        load: { activeTasks: 1, maxCapacity: 10, cpuUsage: 0.2, memoryUsage: 0.3 },
        circuit: "closed",
      });

    const c = new Client("http://mock:18400");
    const status = await c.agents.get("jarvis");
    expect(status.name).toBe("jarvis");
    expect(status.circuit).toBe("closed");
    expect(status.load.activeTasks).toBe(1);
  });

  it("score 5 维", async () => {
    nock("http://mock:18400")
      .get("/registry/agents/jarvis/score")
      .reply(200, {
        name: "jarvis", totalScore: 0.88, trustScore: 0.9,
        skillMatch: 0.85, healthScore: 0.95, loadScore: 0.8,
      });

    const c = new Client("http://mock:18400");
    const score = await c.agents.score("jarvis");
    expect(score.totalScore).toBe(0.88);
  });

  it("register 201", async () => {
    nock("http://mock:18400")
      .post("/registry/agents/register")
      .reply(201, { name: "new", registered: true });

    const c = new Client("http://mock:18400");
    await c.agents.register({
      name: "new", url: "http://new:18800", skills: ["demo"],
    });
  });

  it("deregister", async () => {
    nock("http://mock:18400")
      .delete("/registry/agents/old")
      .reply(200, { name: "old", deregistered: true });

    const c = new Client("http://mock:18400");
    await c.agents.deregister("old");
  });
});

describe("AgentsService.heartbeat / reportLoad", () => {
  it("heartbeat", async () => {
    nock("http://mock:18400")
      .post("/registry/agents/heartbeat")
      .reply(200, { received: true });

    const c = new Client("http://mock:18400");
    await c.agents.heartbeat("test-agent");
  });

  it("reportLoad", async () => {
    nock("http://mock:18400")
      .post("/heartbeat/load")
      .reply(200, { received: true });

    const c = new Client("http://mock:18400");
    await c.agents.reportLoad("test-agent", {
      activeTasks: 2, maxCapacity: 10, cpuUsage: 0.5, memoryUsage: 0.6,
    });
  });
});
