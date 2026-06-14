/**
 * TasksService 单测 — 3 方法(nock mock kernel)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { Client, SubmitRequest } from "../src";
import { BadRequestError, APIError } from "../src/errors";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

describe("TasksService.submit", () => {
  it("正常响应(含 decision.candidates)", async () => {
    nock("http://mock:18400")
      .post("/registry/tasks/submit")
      .reply(200, {
        task_id: "t-001",
        status: "completed",
        selected_agent: "Whis",
        score: 0.85,
        decision: {
          selected_agent: "Whis", score: 0.85, decision_time_ms: 100,
          candidates: [{ name: "Whis", score: 0.85, reason: "mock" }],
        },
        a2a_call_ms: 2000,
        response: "Echo: hello",
      });

    const c = new Client("http://mock:18400");
    const resp = await c.tasks.submit(new SubmitRequest("hello", 30000));
    expect(resp.status).toBe("completed");
    expect(resp.selected_agent).toBe("Whis");
    expect(resp.score).toBe(0.85);
    expect(resp.decision.candidates).toHaveLength(1);
    expect(resp.decision.candidates[0].name).toBe("Whis");
  });

  it("传 timeoutMs", async () => {
    nock("http://mock:18400")
      .post("/registry/tasks/submit")
      .reply(200, {
        task_id: "t", status: "completed", selected_agent: "Whis", score: 0.5,
        decision: { selected_agent: "Whis", score: 0.5, decision_time_ms: 50 },
      });

    const c = new Client("http://mock:18400");
    await c.tasks.submit(new SubmitRequest("x", 15000));
  });

  it("不传 timeoutMs", async () => {
    nock("http://mock:18400")
      .post("/registry/tasks/submit")
      .reply(200, {
        task_id: "t", status: "completed", selected_agent: "Whis", score: 0.5,
        decision: { selected_agent: "Whis", score: 0.5, decision_time_ms: 50 },
      });

    const c = new Client("http://mock:18400");
    await c.tasks.submit(new SubmitRequest("x"));
  });

  it("空 prompt → 400 BadRequestError", async () => {
    nock("http://mock:18400")
      .post("/registry/tasks/submit")
      .reply(400, { error: "prompt required", code: "bad_request" });

    const c = new Client("http://mock:18400");
    await expect(c.tasks.submit(new SubmitRequest(""))).rejects.toThrow(BadRequestError);
  });

  it("5xx 抛 APIError", async () => {
    nock("http://mock:18400")
      .post("/registry/tasks/submit")
      .reply(500, { error: "boom" });

    const c = new Client("http://mock:18400");
    await expect(c.tasks.submit(new SubmitRequest("hi"))).rejects.toThrow(APIError);
  });
});

describe("TasksService.simulate", () => {
  it("L3 决策(不含 a2a_call_ms)", async () => {
    nock("http://mock:18400")
      .post("/registry/tasks/simulate")
      .reply(200, {
        selected_agent: "Whis", score: 0.55, decision_time_ms: 100,
        candidates: [{ name: "Whis", score: 0.55, reason: "general" }],
      });

    const c = new Client("http://mock:18400");
    const decision = await c.tasks.simulate(new SubmitRequest("test"));
    expect(decision.selected_agent).toBe("Whis");
    expect(decision.candidates).toHaveLength(1);
  });
});

describe("TasksService.get", () => {
  it("返回 Task", async () => {
    nock("http://mock:18400")
      .get("/registry/tasks/task-001")
      .reply(200, {
        taskId: "task-001", message: "echo", sourcePeer: "test",
        status: "completed", assignedAgent: "Whis",
        createdAt: 1718342400, updatedAt: 1718342401,
      });

    const c = new Client("http://mock:18400");
    const task = await c.tasks.get("task-001");
    expect(task.taskId).toBe("task-001");
    expect(task.status).toBe("completed");
    expect(task.assignedAgent).toBe("Whis");
  });
});
