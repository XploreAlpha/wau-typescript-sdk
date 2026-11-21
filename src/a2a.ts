/**
 * A2A v1.0 客户端 —— 调外部 agent。
 *
 * ## 2026-11-19 新增
 *
 * 5 个 SDK 之前都没有 A2A 客户端 —— 只有 MCP 的 `send_message` tool
 * (那走 MCP,不是 A2A)。而 kernel 已经在用 A2A v1.0 调外部 agent 了
 * (ZeroClaw / Hermes / 边缘 agent)⇒ SDK 侧要能直连 A2A 才能自己组网。
 *
 * ## A2A v1.0 的线格式(实测,对着 hermes-shop01:9901)
 *
 * ```http
 * POST {agent_url}
 * Content-Type: application/json
 * Accept: application/json
 * A2A-Version: 1.0              ← ★ 必带,缺失或值不匹配服务端直接拒
 * Authorization: Bearer <token>  ← 可选(agent 开 pairing 认证时必带)
 *
 * {"jsonrpc":"2.0","id":"<uuid>","method":"SendMessage",
 *  "params":{"message":{"messageId":"<uuid>","role":"user",
 *                       "parts":[{"text":"你好"}]}}}
 * ```
 *
 * 响应(实测):
 *
 * ```json
 * {"jsonrpc":"2.0","id":"...","result":{
 *    "task":{"id":"task-...","contextId":"ctx-...",
 *            "status":{"state":"TASK_STATE_COMPLETED","timestamp":"...",
 *                      "message":{"role":"ROLE_AGENT",
 *                                 "parts":[{"text":"...","mediaType":"text/plain"}],
 *                                 "messageId":"...","contextId":"ctx-..."}},
 *            "artifacts":[{"artifactId":"...","parts":[{"text":"..."}]}]}}}
 * ```
 *
 * ⚠️ v1.0 的 Part 没有 `kind` 字段 —— 内容分支本身就是判别器
 * (`text` / `raw` / `url` / `data`)。旧 v0.3.0 形状的 `kind` 只在 legacy 路径兜底。
 */

import { Transport } from "./transport";

/** A2A v1.0 标准方法名(首字母大写;v0.3.0 是 `message/send`)。 */
export const METHOD_SEND_MESSAGE = "SendMessage";

/** A2A v1.0 协议版本 —— 每次请求都必须带这个头。 */
export const A2A_PROTOCOL_VERSION = "1.0";

/**
 * 从 A2A 结构的任意节点里递归提取文本。
 *
 * 覆盖 v1.0 的三种形状:
 *  - task 分支    : `{task:{status:{message:{parts:[...]}},artifacts:[{parts:[...]}]}}`
 *  - message 分支 : `{message:{parts:[...]}}`
 *  - legacy v0.3.0: `{kind:"task",artifacts:[{parts:[{kind:"text",text:"..."}]}]}`
 */
export function extractA2AText(node: unknown): string {
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>;
      // Part:v1.0 用 "text" 字段本身当判别器;legacy 用 "kind":"text"
      if (typeof obj.text === "string" && obj.text) {
        if (!seen.has(obj.text)) {
          seen.add(obj.text);
          out.push(obj.text);
        }
      }
      for (const key of ["message", "status", "artifacts", "parts", "result", "task"]) {
        if (key in obj) walk(obj[key]);
      }
    }
  };

  walk(node);
  return out.join("\n");
}

/** 生成一个随机 ID(A2A 的 request id / messageId)。 */
function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class A2AClient {
  constructor(private readonly transport: Transport) {}

  /**
   * 发一条 A2A 消息,返回**原始** JSON-RPC result。
   *
   * 想要纯文本用 `sendText()`。
   */
  async sendMessage(
    agentUrl: string,
    text: string,
    token: string = "",
    contextId: string = ""
  ): Promise<Record<string, unknown>> {
    const message: Record<string, unknown> = {
      messageId: newId(),
      role: "user",
      parts: [{ text }],
    };
    if (contextId) message.contextId = contextId;

    const body = {
      jsonrpc: "2.0",
      id: newId(),
      method: METHOD_SEND_MESSAGE,
      params: { message },
    };

    const headers: Record<string, string> = { "A2A-Version": A2A_PROTOCOL_VERSION };
    if (token) headers.Authorization = `Bearer ${token}`;

    const raw = (await this.transport.request(
      "POST",
      agentUrl,
      body,
      undefined,
      headers
    )) as Record<string, unknown> | undefined;

    if (!raw || typeof raw !== "object") return {};
    const err = raw.error;
    if (err && typeof err === "object") {
      const e = err as { code?: number; message?: string };
      throw new Error(`a2a error ${e.code ?? -32603}: ${e.message ?? ""}`);
    }
    const result = raw.result;
    return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  }

  /**
   * 发一条 A2A 消息,直接返回回复文本。
   */
  async sendText(
    agentUrl: string,
    text: string,
    token: string = "",
    contextId: string = ""
  ): Promise<string> {
    const result = await this.sendMessage(agentUrl, text, token, contextId);
    return extractA2AText(result);
  }

  /**
   * 拉 agent 卡片(GET `{agentUrl}/.well-known/agent-card.json`)。
   */
  async getAgentCard(agentUrl: string): Promise<Record<string, unknown>> {
    const base = agentUrl.replace(/\/+$/, "");
    const raw = (await this.transport.request(
      "GET",
      `${base}/.well-known/agent-card.json`
    )) as Record<string, unknown> | undefined;
    return raw && typeof raw === "object" ? raw : {};
  }
}
