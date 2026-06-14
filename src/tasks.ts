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
          (c) => new Candidate(c.name, c.score, c.reason)
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
    const data = (await this.transport.request(
      "POST",
      "/registry/tasks/simulate",
      body
    )) as {
      selected_agent: string;
      score: number;
      decision_time_ms: number;
      candidates?: Array<{ name: string; score: number; reason: string }>;
    };
    const candidates: Candidate[] = (data.candidates ?? []).map(
      (c) => new Candidate(c.name, c.score, c.reason)
    );
    return new DecisionInfo(
      data.selected_agent ?? "",
      data.score ?? 0,
      data.decision_time_ms ?? 0,
      candidates
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
