/**
 * v0.9.0 M3 §3.7 — ChatService (wau-edge OpenAI 兼容层封装, per D20 architecture-pivot)
 *
 * 替换 v0.8.0 时代的 tasks.submit 路径(走 /registry/tasks/submit 老路径):
 *   旧: c.tasks.submit({prompt: "..."})        → wau-core :18400 /registry/tasks/submit
 *   新: c.chat.completions(ChatCompletionRequest) → wau-edge :18402 /v1/chat/completions
 *
 * 沿用 handshake.ts service 模式:
 *   - 持有 transport
 *   - 走 transport.request(method, path, body?) 一行封装
 *   - 自动应用:HS256 鉴权 + 熔断 + 重试(transport 层透传)
 *
 * 完整链路(per M3 §4.5.1):
 *   bot → wau-edge :18402 /v1/chat/completions
 *        → wau-llm-router :18403 /v1/resolve(决定 userToken + model)
 *        → new-api :3000 /v1/chat/completions → LLM provider
 */

import { Transport } from "./transport";
import {
  ChatChoice,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatUsage,
} from "./types";

export class ChatService {
  constructor(private readonly transport: Transport) {}

  /**
   * POST /v1/chat/completions
   *
   * @throws Error if model is empty
   * @throws Error if messages is empty
   * @throws APIError on HTTP 4xx/5xx
   */
  async completions(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!req.model) {
      throw new Error("ChatCompletionRequest.model is required");
    }
    if (!req.messages || req.messages.length === 0) {
      throw new Error("ChatCompletionRequest.messages must not be empty");
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => {
        const out: Record<string, string> = { role: m.role, content: m.content };
        if (m.name) out.name = m.name;
        return out;
      }),
    };
    if (req.stream) body.stream = true;
    if (req.universe) body.universe = req.universe;
    if (req.metadata && Object.keys(req.metadata).length > 0) {
      body.metadata = req.metadata;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens > 0) body.max_tokens = req.maxTokens;

    const data = (await this.transport.request(
      "POST",
      "/v1/chat/completions",
      body
    )) as {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<{
        index: number;
        message: { role: string; content: string; name?: string };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      reason?: string;
    };

    return new ChatCompletionResponse(
      data.id,
      data.object,
      data.created,
      data.model,
      data.choices.map(
        (c) =>
          new ChatChoice(
            c.index,
            new ChatMessage(c.message.role, c.message.content, c.message.name ?? ""),
            c.finish_reason
          )
      ),
      new ChatUsage(
        data.usage.prompt_tokens,
        data.usage.completion_tokens,
        data.usage.total_tokens
      ),
      data.reason ?? ""
    );
  }
}
