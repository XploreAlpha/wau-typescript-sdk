/**
 * W6.5-6 翻译测试 — wau-circuit Go 9 个 table-driven 单测的 TypeScript 1:1 镜像
 *
 * ADR-0003: 行为对齐, 保证 3 SDK 熔断器语义字节级一致
 */

import { describe, it, expect } from "vitest";

import {
  Breaker,
  CircuitState,
  DEFAULT_FAILURE_THRESHOLD,
  isCircuitFailure,
} from "../src/circuit";
import {
  APIError,
  BadRequestError,
  CircuitOpenError,
  NotFoundError,
} from "../src/errors";

describe("Breaker 状态机", () => {
  it("Closed → Open after threshold failures", async () => {
    const cb = new Breaker(undefined, 3, 50);
    // 2 次失败:仍 Closed
    cb.recordFailure("agent-A");
    cb.recordFailure("agent-A");
    expect(cb.getState("agent-A")).toBe(CircuitState.CLOSED);
    // 第 3 次:跳 Open
    cb.recordFailure("agent-A");
    expect(cb.getState("agent-A")).toBe(CircuitState.OPEN);
  });

  it("Open → HalfOpen after recovery timeout", async () => {
    const cb = new Breaker(undefined, 1, 20);
    cb.recordFailure("agent-B");
    expect(cb.getState("agent-B")).toBe(CircuitState.OPEN);

    // 立即查:仍 Open
    expect(cb.getState("agent-B")).toBe(CircuitState.OPEN);

    // 等超时
    await new Promise((resolve) => setTimeout(resolve, 30));

    // 现在应 Open → HalfOpen
    expect(cb.getState("agent-B")).toBe(CircuitState.HALF_OPEN);
  });

  it("HalfOpen → Closed on success", async () => {
    const cb = new Breaker(undefined, 1, 10);
    cb.recordFailure("agent-C");
    await new Promise((resolve) => setTimeout(resolve, 15));
    void cb.getState("agent-C"); // 触发 Open → HalfOpen
    expect(cb.getState("agent-C")).toBe(CircuitState.HALF_OPEN);

    cb.recordSuccess("agent-C");
    expect(cb.getState("agent-C")).toBe(CircuitState.CLOSED);
  });

  it("HalfOpen → Open on failure", async () => {
    const cb = new Breaker(undefined, 1, 10);
    cb.recordFailure("agent-D");
    await new Promise((resolve) => setTimeout(resolve, 15));
    void cb.getState("agent-D"); // 触发 Open → HalfOpen

    // HalfOpen 状态下再失败:回 Open
    cb.recordFailure("agent-D");
    expect(cb.getState("agent-D")).toBe(CircuitState.OPEN);
  });

  it("unknown agent defaults to Closed", () => {
    const cb = new Breaker();
    expect(cb.getState("agent-zzz")).toBe(CircuitState.CLOSED);
  });

  it("isOpen variadic (any agent open)", () => {
    const cb = new Breaker(undefined, 1, 30_000);
    cb.recordFailure("agent-A"); // Open
    // agent-B 未触发:仍 Closed

    expect(cb.isOpen("agent-A", "agent-B")).toBe(true);
    expect(cb.isOpen("agent-A")).toBe(true);
    expect(cb.isOpen("agent-B", "agent-C")).toBe(false);
    expect(cb.isOpen()).toBe(false);
  });

  it("reset clears state", () => {
    const cb = new Breaker(undefined, 1, 30_000);
    cb.recordFailure("agent-A");
    expect(cb.getState("agent-A")).toBe(CircuitState.OPEN);

    cb.reset("agent-A");
    expect(cb.getState("agent-A")).toBe(CircuitState.CLOSED);
  });

  it("concurrent guard calls are safe (10 parallel × 100 ops)", async () => {
    const cb = new Breaker(undefined, 1000); // 高阈值,避免触发熔断
    let successCount = 0;
    let failCount = 0;

    async function worker(): Promise<void> {
      for (let j = 0; j < 1000; j++) {
        try {
          await cb.guard("agent-concurrent", async () => {
            // 模拟正常 op
            return "ok";
          });
          successCount++;
        } catch {
          failCount++;
        }
        // 也直接交错调 recordSuccess/Failure(模拟真实情况)
        if (j % 2 === 0) {
          cb.recordFailure("agent-concurrent");
        } else {
          cb.recordSuccess("agent-concurrent");
        }
      }
    }

    const threads = Array.from({ length: 10 }, () => worker());
    await Promise.all(threads);

    expect(successCount).toBe(10_000);
    expect(failCount).toBe(0);
    // 1000 阈值下应仍 Closed
    expect(cb.getState("agent-concurrent")).toBe(CircuitState.CLOSED);
  });
});

describe("isCircuitFailure", () => {
  it("None returns false", () => {
    expect(isCircuitFailure(null)).toBe(false);
    expect(isCircuitFailure(undefined)).toBe(false);
  });

  it("5xx APIError returns true", () => {
    expect(isCircuitFailure(new APIError(500, "server error"))).toBe(true);
    expect(isCircuitFailure(new APIError(503))).toBe(true);
  });

  it("4xx APIError returns false", () => {
    expect(isCircuitFailure(new NotFoundError())).toBe(false);
    expect(isCircuitFailure(new BadRequestError())).toBe(false);
  });

  it("network error returns true", () => {
    expect(isCircuitFailure(new Error("dial tcp: connection refused"))).toBe(true);
  });

  it("CircuitOpenError itself returns false", () => {
    expect(isCircuitFailure(new CircuitOpenError())).toBe(false);
  });
});

describe("Breaker 默认配置", () => {
  it("matches wau-circuit Go defaults (5 failures / 30s)", () => {
    const cb = new Breaker();
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(5);
    // 内部字段访问(测试用)
    expect((cb as unknown as { failureThreshold: number }).failureThreshold).toBe(5);
    expect((cb as unknown as { recoveryTimeoutMs: number }).recoveryTimeoutMs).toBe(30_000);
  });
});

describe("Breaker.guard async", () => {
  it("successful op records success", async () => {
    const cb = new Breaker();
    const result = await cb.guard("agent-guard-ok", async () => "ok");
    expect(result).toBe("ok");
  });

  it("failing op records failure and re-throws", async () => {
    const cb = new Breaker(undefined, 2, 30_000);
    const err = new APIError(500, "boom");
    await expect(
      cb.guard("agent-guard-fail", async () => {
        throw err;
      })
    ).rejects.toThrow("boom");
    // 1 次失败:仍 Closed
    expect(cb.getState("agent-guard-fail")).toBe(CircuitState.CLOSED);
  });

  it("open circuit short-circuits with CircuitOpenError", async () => {
    const cb = new Breaker(undefined, 1, 30_000);
    cb.recordFailure("agent-short");
    // 立即短路
    await expect(
      cb.guard("agent-short", async () => {
        throw new Error("should not be called");
      })
    ).rejects.toThrow(CircuitOpenError);
  });
});
