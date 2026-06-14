/**
 * Circuit breaker — wau-circuit Go 版 (154 行) 的 TypeScript 翻译
 *
 * 来源: https://github.com/XploreAlpha/wau-circuit/blob/main/breaker.go
 * ADR-0003: 翻译到 3 SDK, 行为 1:1 对齐(由"故障注入黄金测试"兜底)
 *
 * 状态机:
 *   Closed  ──(N failures)──>  Open
 *      ^                        │
 *      │                        │ recovery_timeout
 *      │                        ▼
 *      └─(1 success)───  HalfOpen
 *                          │
 *                          │ 1 failure
 *                          ▼
 *                        Open
 *
 * TypeScript 翻译要点:
 * - 状态用 enum (对应 Go iota)
 * - map[agentID]state → Record<agentID, BreakerState>
 * - 并发安全: 用简单的同步封装(Node 单线程事件循环,异步操作串行)
 */

import { CircuitOpenError, APIError } from "./errors";

export enum CircuitState {
  CLOSED = 0,
  OPEN = 1,
  HALF_OPEN = 2,
}

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_RECOVERY_TIMEOUT_MS = 30_000;

interface AgentState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
}

/**
 * 熔断器 — wau-circuit.Breaker 的 TypeScript 实现
 */
export class Breaker {
  private logger: (level: string, msg: string, ...args: unknown[]) => void;
  private failureThreshold: number;
  private recoveryTimeoutMs: number;
  private states: Map<string, AgentState> = new Map();
  // 简单锁(同步 op 串行,async op 排队)
  private lockChain: Promise<void> = Promise.resolve();

  constructor(
    logger?: (level: string, msg: string, ...args: unknown[]) => void,
    failureThreshold: number = DEFAULT_FAILURE_THRESHOLD,
    recoveryTimeoutMs: number = DEFAULT_RECOVERY_TIMEOUT_MS
  ) {
    // 跟 Go 一致: nil logger fallback 到 console
    this.logger = logger || ((level, msg, ...args) => {
      if (level === "warn" || level === "error") {
        console.warn(`[wau-circuit] ${msg}`, ...args);
      }
    });
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
  }

  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    // 串行化所有 op(简化版的 async lock)
    const prev = this.lockChain;
    let release: () => void = () => {};
    this.lockChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  private getOrCreateState(agentId: string): AgentState {
    let s = this.states.get(agentId);
    if (!s) {
      s = { state: CircuitState.CLOSED, failures: 0, lastFailureAt: 0 };
      this.states.set(agentId, s);
    }
    return s;
  }

  getState(agentId: string): CircuitState {
    const s = this.getOrCreateState(agentId);
    if (s.state === CircuitState.CLOSED) return CircuitState.CLOSED;
    if (s.state === CircuitState.OPEN) {
      // 跟 Go 一致: time.Since(lastFailure) > recoveryTimeout → 转 HalfOpen
      if (Date.now() - s.lastFailureAt > this.recoveryTimeoutMs) {
        s.state = CircuitState.HALF_OPEN;
        return CircuitState.HALF_OPEN;
      }
      return CircuitState.OPEN;
    }
    return CircuitState.HALF_OPEN;
  }

  /** 变参:任一 Open 即 true(对齐 Go wau-circuit.IsOpen) */
  isOpen(...agentIds: string[]): boolean {
    return agentIds.some((aid) => this.getState(aid) === CircuitState.OPEN);
  }

  recordFailure(agentId: string): void {
    const s = this.getOrCreateState(agentId);
    s.failures++;
    s.lastFailureAt = Date.now();

    // HalfOpen 失败 → 直接 Open(不计数)
    if (s.state === CircuitState.HALF_OPEN) {
      s.state = CircuitState.OPEN;
      this.logger("warn", "Circuit breaker re-opened from half-open", { agent: agentId });
      return;
    }

    if (s.state === CircuitState.CLOSED && s.failures >= this.failureThreshold) {
      s.state = CircuitState.OPEN;
      this.logger("warn", "Circuit breaker opened", { agent: agentId, failures: s.failures });
    }
  }

  recordSuccess(agentId: string): void {
    const s = this.getOrCreateState(agentId);
    s.failures = 0;
    if (s.state === CircuitState.HALF_OPEN) {
      s.state = CircuitState.CLOSED;
      this.logger("info", "Circuit breaker closed", { agent: agentId });
    }
  }

  reset(agentId: string): void {
    this.states.delete(agentId);
  }

  /**
   * 异步 Guard — 在 op 外包熔断逻辑
   * - 熔断开 → 短路返 CircuitOpenError
   * - 熔断关/半开 → 调 op, 然后 RecordSuccess/RecordFailure
   */
  async guard<T>(agentId: string, op: () => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      if (this.isOpen(agentId)) {
        throw new CircuitOpenError();
      }
      try {
        const result = await op();
        this.recordSuccess(agentId);
        return result;
      } catch (err) {
        if (isCircuitFailure(err)) {
          this.recordFailure(agentId);
        }
        throw err;
      }
    });
  }
}

/**
 * 判断异常是否应计入熔断失败(对齐 wau-go-sdk isCircuitFailure)
 *
 * 规则:
 * - 5xx APIError: 计
 * - 4xx APIError: 不计
 * - 网络错 / 超时: 计
 * - CircuitOpenError 自身: 不计(避免雪崩)
 */
export function isCircuitFailure(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof CircuitOpenError) return false;
  if (err instanceof APIError) {
    return err.statusCode >= 500;
  }
  // 网络错 / 超时 / 其他未知错误: 计
  return true;
}
