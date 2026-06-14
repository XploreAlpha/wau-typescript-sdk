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
    const ErrClass = STATUS_MAP[resp.status] ?? APIError;
    const body = resp.data as { error?: string; message?: string; code?: string } | undefined;
    const message = body?.error ?? body?.message ?? "";
    const code = body?.code ?? "";
    const requestId = (resp.headers as Record<string, string>)["x-request-id"] ?? "";

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
