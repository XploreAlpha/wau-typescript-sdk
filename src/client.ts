/**
 * Client 主类 — 串起所有装饰器(retry + circuit + auth + transport)
 *
 * 调用链:
 *   Service method → Transport.do → HTTP (via Service 直接调 transport, 走 Client 的 retrier + circuit 可选)
 *
 * 对齐 wau-go-sdk Client.doWithRetry + wau-python-sdk Client._do_with_retry
 */

import { Breaker } from "./circuit";
import { Signer } from "./auth";
import {
  ClientOptions,
  DEFAULT_CIRCUIT_CONFIG,
  DEFAULT_RETRY_CONFIG,
} from "./options";
import { Retrier } from "./retry";
import { Transport } from "./transport";
import { AgentsService } from "./agents";
import { IntentService } from "./intent";
import { KernelService } from "./kernel";
import { TasksService } from "./tasks";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = "wau-typescript-sdk/0.6.0-preview.1";

export class Client {
  public readonly baseURL: string;
  public readonly options: ClientOptions;
  public readonly retrier: Retrier;
  public readonly circuit: Breaker | null;
  private readonly transport: Transport;
  private readonly signer: Signer | null;

  public readonly kernel: KernelService;
  public readonly agents: AgentsService;
  public readonly tasks: TasksService;
  public readonly intent: IntentService;

  constructor(baseURL: string, options: ClientOptions = {}) {
    if (!baseURL) {
      baseURL = "http://localhost:18400";
    }
    this.baseURL = baseURL;
    this.options = options;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    const fullOptions: ClientOptions = { ...options, timeoutMs, userAgent };

    // 鉴权
    this.signer = options.auth ? new Signer(options.auth) : null;

    // 熔断
    if (options.circuit?.enabled !== false) {
      const cfg = { ...DEFAULT_CIRCUIT_CONFIG, ...options.circuit };
      this.circuit = new Breaker(
        undefined,
        cfg.failureThreshold,
        cfg.openTimeoutMs
      );
    } else {
      this.circuit = null;
    }

    // transport
    this.transport = new Transport(baseURL, fullOptions, this.signer);

    // retry
    const retryCfg = { ...DEFAULT_RETRY_CONFIG, ...options.retry };
    this.retrier = new Retrier(retryCfg);

    // 4 子服务
    this.kernel = new KernelService(this.transport);
    this.agents = new AgentsService(this.transport);
    this.tasks = new TasksService(this.transport);
    this.intent = new IntentService();
  }

  /**
   * 返回 SDK 内部熔断状态(debug / metrics)
   * "closed" | "open" | "half-open"
   */
  circuitState(): string {
    if (!this.circuit) {
      return "closed";
    }
    const state = this.circuit.getState("wau-kernel");
    return ["closed", "open", "half-open"][state];
  }

  async close(): Promise<void> {
    // axios 实例无需显式 close
  }
}
