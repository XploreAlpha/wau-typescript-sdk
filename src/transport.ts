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
}
