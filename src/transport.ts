/**
 * HTTP transport 层 — axios 包装
 *
 * 调用链:
 *   Caller → Transport.do → HTTP
 *
 * 4xx/5xx 翻译成 APIError 子类
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import {
  APIError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HandshakeAgentNoEndpointError,
  HandshakeAgentNotFoundError,
  HandshakeInsufficientTrustError,
  HandshakeInvalidProtocolError,
  HandshakeInvalidRequestError,
  HandshakeProtocolNotSupportedError,
  HandshakeRateLimitedError,
  HandshakeSessionNotFoundError,
  HandshakeTenantMismatchError,
  NotFoundError,
  UnauthorizedError,
} from "./errors";
import { ClientOptions } from "./options";
import { Signer } from "./auth";
import { ChatCompletionChunk, ChunkChoice, ChunkDelta } from "./types";

const STATUS_MAP: Record<number, new (msg?: string, code?: string) => APIError> = {
  400: BadRequestError as new (msg?: string, code?: string) => APIError,
  401: UnauthorizedError as new (msg?: string, code?: string) => APIError,
  403: ForbiddenError as new (msg?: string, code?: string) => APIError,
  404: NotFoundError as new (msg?: string, code?: string) => APIError,
  409: ConflictError as new (msg?: string, code?: string) => APIError,
};

// v0.8.0 M5-1 B.1 — Handshake 错误码 → 错误类
const HANDSHAKE_CODE_TO_CLS: Record<string, new (msg?: string, code?: string) => APIError> = {
  "-32001": HandshakeInsufficientTrustError,
  "-32002": HandshakeAgentNotFoundError,
  "-32003": HandshakeTenantMismatchError,
  "-32004": HandshakeRateLimitedError,
  "-32005": HandshakeProtocolNotSupportedError,
  "-32600": HandshakeInvalidRequestError,
  SESSION_NOT_FOUND: HandshakeSessionNotFoundError,
  AGENT_NO_ENDPOINT: HandshakeAgentNoEndpointError,
  INVALID_PROTOCOL: HandshakeInvalidProtocolError,
  INVALID_REQUEST: HandshakeInvalidRequestError,
};

export class Transport {
  public readonly baseURL: string;
  private readonly http: AxiosInstance;
  private signer: Signer | null;

  constructor(baseURL: string, options: ClientOptions, signer: Signer | null = null) {
    this.baseURL = baseURL;
    this.signer = signer;
    this.http = axios.create({
      baseURL,
      timeout: options.timeoutMs ?? 30_000,
      headers: {
        "User-Agent": options.userAgent ?? "wau-typescript-sdk/0.6.0-preview.1",
        Accept: "application/json",
      },
      ...(options.transport ? { adapter: options.transport as never } : {}),
    });
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number>
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.signer) {
      headers["Authorization"] = `Bearer ${this.signer.sign()}`;
    }

    const config: AxiosRequestConfig = {
      method,
      url: path.startsWith("/") ? path : `/${path}`,
      headers,
      params,
      data: body,
      validateStatus: () => true, // 自己处理 4xx/5xx
      responseType: "json",
    };

    const resp = await this.http.request(config);
    return Transport.handleResponse(resp);
  }

  private static handleResponse(resp: AxiosResponse): unknown {
    if (resp.status >= 400) {
      Transport.raiseForStatus(resp);
    }
    if (resp.status === 204 || !resp.data) {
      return null;
    }
    return resp.data;
  }

  private static raiseForStatus(resp: AxiosResponse): never {
    const body = resp.data as { error?: { code?: number | string; message?: string } | string; message?: string; code?: number | string } | undefined;
    // code 可能在 error.code(嵌套)或顶层 code 字段
    let code = "";
    let message = "";
    if (body) {
      const errObj = body.error;
      if (typeof errObj === "object" && errObj !== null) {
        code = String(errObj.code ?? "");
        message = errObj.message ?? "";
      } else if (typeof errObj === "string") {
        message = errObj;
      } else {
        message = body.message ?? "";
      }
      if (!code && body.code !== undefined) {
        code = String(body.code);
      }
    }
    const requestId = (resp.headers as Record<string, string>)["x-request-id"] ?? "";

    // v0.8.0 M5-1 B.1: 握手端点 → 用 Handshake*Error
    let ErrClass: new (msg?: string, code?: string) => APIError = STATUS_MAP[resp.status] ?? APIError;
    if (resp.config?.url?.includes("/handshake/")) {
      const HandshakeClass = HANDSHAKE_CODE_TO_CLS[code];
      if (HandshakeClass) {
        ErrClass = HandshakeClass;
      }
    }

    let bodyBytes: Buffer | undefined;
    if (typeof resp.data === "string") {
      bodyBytes = Buffer.from(resp.data, "utf-8");
    } else if (resp.data) {
      bodyBytes = Buffer.from(JSON.stringify(resp.data), "utf-8");
    }

    const err = new ErrClass(message, code);
    Object.assign(err, {
      statusCode: resp.status,
      requestId,
      body: bodyBytes,
    });
    throw err;
  }

  /**
   * SSE 流式请求 — Stage 3.1 #10 (2026-07-02) 实装
   *
   * 用 fetch 直读 ReadableStream(axios 不支持原生 SSE 流式解析)。
   * 协议: data: {json}\n\n + data: [DONE]\n\n 终止
   *
   * @param path 请求路径(以 / 开头)
   * @param body JSON body
   * @returns AsyncIterable<ChatCompletionChunk>
   * @throws APIError 当 4xx/5xx 时
   */
  async *streamChat(
    path: string,
    body: unknown
  ): AsyncIterable<ChatCompletionChunk> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent":
        (this.http.defaults.headers.common["User-Agent"] as string) ??
        "wau-typescript-sdk/0.6.0-preview.1",
    };
    if (this.signer) {
      headers["Authorization"] = `Bearer ${this.signer.sign()}`;
    }
    const url = path.startsWith("/") ? path : `/${path}`;
    const fullUrl = `${this.baseURL}${url}`;

    const resp = await fetch(fullUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (resp.status >= 400) {
      const text = await resp.text();
      let parsed: {
        error?: { code?: number | string; message?: string };
        message?: string;
        code?: number | string;
      } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ignore */
      }
      let code = "";
      let message = "";
      if (parsed.error && typeof parsed.error === "object") {
        code = String(parsed.error.code ?? "");
        message = parsed.error.message ?? "";
      } else {
        message = parsed.message ?? text;
      }
      if (!code && parsed.code !== undefined) {
        code = String(parsed.code);
      }
      const requestId = resp.headers.get("x-request-id") ?? "";
      const ErrClass = STATUS_MAP[resp.status] ?? APIError;
      const err = new ErrClass(message, code);
      Object.assign(err, {
        statusCode: resp.status,
        requestId,
        body: Buffer.from(text, "utf-8"),
      });
      throw err;
    }

    if (!resp.body) {
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            return;
          }
          let data: {
            id: string;
            object: string;
            created: number;
            model: string;
            choices: Array<{
              index: number;
              delta: { role?: string; content?: string };
              finish_reason?: string | null;
            }>;
          };
          try {
            data = JSON.parse(payload);
          } catch (e) {
            throw new Error(
              `wau: parse SSE chunk failed: ${(e as Error).message} (payload=${payload})`
            );
          }
          const { ChunkChoice: CC, ChunkDelta: CD } = { ChunkChoice, ChunkDelta };
          yield new ChatCompletionChunk(
            data.id ?? "",
            data.object ?? "chat.completion.chunk",
            data.created ?? 0,
            data.model ?? "",
            (data.choices ?? []).map(
              (c) =>
                new CC(
                  c.index,
                  new CD(c.delta?.role ?? "", c.delta?.content ?? ""),
                  c.finish_reason ?? null
                )
            )
          );
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
