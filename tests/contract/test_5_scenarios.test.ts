/**
 * 5 场景契约测试 — 对齐 wau-go-sdk/tests/contract_test.go + wau-python-sdk/tests/contract/test_5_scenarios.py
 *
 * 5 场景(clinical/france/pain/sales/rare_disease) 跟 wau-intent 仓 e2e_test/test_submit_l4.py 一致
 * 黄金 JSON 唯一真相源在 ./contract-golden/scenario_*.json (从 wau-go-sdk 复用, ADR-0004)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client, SubmitRequest } from "../../src";
import { BadRequestError, NotFoundError } from "../../src/errors";

const GOLDEN_DIR = join(__dirname, "..", "contract-golden");

interface GoldenScenario {
  scenario: string;
  prompt: string;
  expected_selected_agent: string;
  expected_status: string;
  expected_response_tokens: { en?: string[]; zh?: string[] };
  kernel_response: Record<string, unknown>;
}

const SCENARIOS: Array<[string, string, string, string[]]> = [
  ["clinical", "I need clinical decision support for a patient", "Jarvis",
    ["临床", "决策", "支持", "患者"]],
  ["france", "What is the capital of France?", "Whis", ["paris"]],
  ["pain", "Recommend an over-the-counter pain reliever", "Benny",
    ["ibuprofen", "acetaminophen", "pain", "reliever"]],
  ["sales", "Show me this quarter's sales analytics", "Whis",
    ["sales", "analytics", "quarter"]],
  ["rare_disease", "Help me diagnose a rare disease", "Jarvis",
    ["罕见病", "鉴别", "诊断"]],
];

function loadGolden(scenario: string): GoldenScenario {
  const path = join(GOLDEN_DIR, `scenario_${scenario}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

beforeAll(() => {
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe("5 场景契约", () => {
  for (const [scene, prompt, expectedAgent, expectedTokens] of SCENARIOS) {
    it(`${scene}: prompt="${prompt.slice(0, 30)}..." → ${expectedAgent}`, async () => {
      const golden = loadGolden(scene);
      const mockResponse = {
        ...golden.kernel_response,
        status: golden.expected_status,
        selected_agent: expectedAgent,
      };

      nock("http://mock-kernel:18400")
        .post("/registry/tasks/submit")
        .reply(200, mockResponse);

      const c = new Client("http://mock-kernel:18400");
      const resp = await c.tasks.submit(new SubmitRequest(prompt, 60000));

      expect(resp.status).toBe(golden.expected_status);
      expect(resp.selected_agent).toBe(expectedAgent);
      expect(resp.score).toBeGreaterThan(0);

      // 响应文本至少含 1 个期望 token
      const text = String(resp.response ?? "").toLowerCase();
      const matched = expectedTokens.some((tok) => text.includes(tok.toLowerCase()));
      expect(matched).toBe(true);
    });
  }

  it("空 prompt → 400 BadRequestError", async () => {
    nock("http://mock-kernel:18400")
      .post("/registry/tasks/submit")
      .reply(400, { error: "prompt is required", code: "bad_request" });

    const c = new Client("http://mock-kernel:18400");
    await expect(c.tasks.submit(new SubmitRequest(""))).rejects.toThrow(BadRequestError);
  });

  it("GET 不存在 agent → 404 NotFoundError", async () => {
    nock("http://mock-kernel:18400")
      .get("/registry/agents/ghost/status")
      .reply(404, { error: "agent not found", code: "not_found" });

    const c = new Client("http://mock-kernel:18400");
    await expect(c.agents.get("ghost")).rejects.toThrow(NotFoundError);
  });
});

describe("5 黄金 JSON schema", () => {
  it("5 黄金文件必含字段", () => {
    for (const [scene] of SCENARIOS) {
      const golden = loadGolden(scene);
      expect(golden.scenario).toBe(scene);
      expect(typeof golden.prompt).toBe("string");
      expect(golden.prompt.length).toBeGreaterThan(0);
      expect(typeof golden.expected_selected_agent).toBe("string");
      expect(typeof golden.expected_status).toBe("string");
      expect(golden.kernel_response).toBeDefined();
    }
  });
});
