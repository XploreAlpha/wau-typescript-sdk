/**
 * TasksService — 3 方法(对齐 wau-go-sdk tasks.go)
 *
 * SubmitRequest 字段以 kernel 真相源为准 ({prompt, timeoutMs})
 */

import { Transport } from "./transport";
import { Candidate, DecisionInfo, SubmitRequest, SubmitResponse, Task } from "./types";

export class TasksService {
  constructor(private readonly transport: Transport) {}

  async submit(req: SubmitRequest): Promise<SubmitResponse> {
    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.timeoutMs !== undefined) {
      body.timeoutMs = req.timeoutMs;
    }

    const data = (await this.transport.request(
      "POST",
      "/registry/tasks/submit",
      body
    )) as {
      task_id: string;
      agent_id?: string;
      score?: number;
      decision: {
        selected_agent: string;
        score: number;
        decision_time_ms: number;
        candidates?: Array<{ name: string; score: number; reason: string }>;
      };
      status: string;
      selected_agent?: string;
      a2a_call_ms?: number;
      response?: unknown;
      error?: string;
      source_peer?: string;
      source_agent_id?: string;
    };

    return new SubmitResponse(
      data.task_id ?? "",
      data.agent_id,
      data.selected_agent,
      data.score,
      new DecisionInfo(
        data.decision?.selected_agent ?? "",
        data.decision?.score ?? 0,
        data.decision?.decision_time_ms ?? 0,
        (data.decision?.candidates ?? []).map(
          // ★ 2026-11-19:kernel 的 candidate 带 url 字段
          (c) => new Candidate(c.name, c.score, c.reason, (c as { url?: string }).url ?? "")
        )
      ),
      data.status ?? "",
      data.a2a_call_ms,
      data.response,
      data.error,
      data.source_peer,
      data.source_agent_id
    );
  }

  async simulate(req: SubmitRequest): Promise<DecisionInfo> {
    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.timeoutMs !== undefined) {
      body.timeoutMs = req.timeoutMs;
    }
    // ★ 2026-11-19:simulate 端点返回的是 **best_agent / best_score**
    // (不是 submit 的 selected_agent / score)⇒ 旧解析永远拿到空 agent。
    // ⇒ 两个名字都读,统一归一到 selected_agent / score。
    const data = (await this.transport.request(
      "POST",
      "/registry/tasks/simulate",
      body
    )) as Record<string, unknown>;

    const candidates: Candidate[] = (
      (data?.candidates as Array<Record<string, unknown>>) ?? []
    ).map(
      (c) =>
        new Candidate(
          (c.name as string) ?? "",
          (c.score as number) ?? 0,
          (c.reason as string) ?? "",
          (c.url as string) ?? ""
        )
    );

    const bestAgent = (data?.best_agent as string) ?? "";
    const bestScore = (data?.best_score as number) ?? 0;
    const selectedAgent =
      (data?.selected_agent as string) ?? bestAgent;
    const score = (data?.score as number) ?? bestScore;

    return new DecisionInfo(
      selectedAgent,
      score,
      (data?.decision_time_ms as number) ?? 0,
      candidates,
      bestAgent,
      bestScore,
      (data?.url as string) ?? "",
      (data?.reason as string) ?? "",
      (data?.skills as string[]) ?? [],
      (data?.intent_source as string) ?? ""
    );
  }

  async get(taskId: string): Promise<Task> {
    const data = (await this.transport.request(
      "GET",
      `/registry/tasks/${taskId}`
    )) as {
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
    };
    return new Task(
      data.taskId ?? taskId,
      data.message ?? "",
      data.sourcePeer ?? "",
      data.sourceAgentId ?? "",
      data.status ?? "",
      data.assignedAgent ?? "",
      data.result ?? "",
      data.createdAt ?? 0,
      data.updatedAt ?? 0,
      data.requiredSkills ?? []
    );
  }
}
