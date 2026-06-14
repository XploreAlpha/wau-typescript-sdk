/**
 * 重试装饰器 — 指数退避 + 抖动(对齐 wau-go-sdk retry.go + wau-python-sdk _retry.py)
 *
 * 策略: maxRetries=3 / initial=200ms / max=5s / jitter=0.2
 * 只对**幂等**请求自动重试 (5xx + 429 + 网络错)
 */

import { APIError, MaxRetriesError, CircuitOpenError } from "./errors";
import { RetryConfig } from "./options";

/**
 * 判断异常是否可重试(对齐 wau-go-sdk retrier.shouldRetry)
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof CircuitOpenError) {
    return false; // 熔断不重试
  }
  if (err instanceof APIError) {
    return err.statusCode >= 500 || err.statusCode === 429;
  }
  // 网络错 / 超时
  if (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.message.includes("timeout") ||
      err.message.includes("connection") ||
      err.message.includes("ECONN") ||
      err.message.includes("fetch failed"))
  ) {
    return true;
  }
  return false;
}

/**
 * 退避时长(带 jitter)
 */
function backoff(
  attempt: number,
  cfg: RetryConfig,
  rand: () => number = Math.random
): number {
  let delay = cfg.initialBackoffMs;
  for (let i = 0; i < attempt; i++) {
    delay *= 2;
    if (delay > cfg.maxBackoffMs) {
      delay = cfg.maxBackoffMs;
      break;
    }
  }
  // 抖动: [1 - jitter, 1 + jitter]
  const multiplier = 1 + (rand() * 2 - 1) * cfg.jitter;
  return delay * multiplier;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 异步重试器(对齐 wau-go-sdk retrier + wau-python-sdk Retrier)
 */
export class Retrier {
  constructor(private readonly cfg: RetryConfig) {}

  /**
   * 执行 async op, 失败按配置重试
   *
   * 行为:
   * - op 成功 → 立刻返结果
   * - op 失败且不可重试 → 立刻返 err
   * - op 失败且可重试 → backoff + 重试, 直到 maxRetries 用完
   * - maxRetries 用完 → 返 MaxRetriesError (wraps last err)
   */
  async do<T>(op: () => Promise<T>): Promise<T> {
    if (this.cfg.maxRetries <= 0) {
      return op();
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        return await op();
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) {
          throw err;
        }
        // 最后一次不再 sleep
        if (attempt === this.cfg.maxRetries) {
          break;
        }
        const delay = backoff(attempt, this.cfg);
        await sleep(delay);
      }
    }
    throw new MaxRetriesError(
      lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    );
  }
}
