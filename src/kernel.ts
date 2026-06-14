/**
 * KernelService — 2 方法(对齐 wau-go-sdk kernel.go)
 */

import { Transport } from "./transport";
import { HealthResponse, KernelInfo } from "./types";

export class KernelService {
  constructor(private readonly transport: Transport) {}

  async info(): Promise<KernelInfo> {
    const data = (await this.transport.request("GET", "/kernel/info")) as {
      version: string;
      startTime: string;
      uptime: number;
      agentsCount: number;
      tasksCount: number;
    };
    return new KernelInfo(
      data.version ?? "unknown",
      data.startTime ?? "",
      data.uptime ?? 0,
      data.agentsCount ?? 0,
      data.tasksCount ?? 0
    );
  }

  async health(): Promise<HealthResponse> {
    const data = (await this.transport.request("GET", "/health")) as {
      status: string;
      version: string;
      uptime: number;
      redis: string;
      error?: string;
    };
    return new HealthResponse(
      data.status ?? "unknown",
      data.version ?? "",
      data.uptime ?? 0,
      data.redis ?? "",
      data.error
    );
  }
}
