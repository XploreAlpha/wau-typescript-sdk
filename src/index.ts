/**
 * wau-sdk v0.6.0-preview.1 — 公开 API 入口
 *
 * 用法:
 *   import { Client, SubmitRequest } from "wau-sdk";
 *   const c = new Client("http://localhost:18400");
 *   const resp = await c.tasks.submit(new SubmitRequest("hello"));
 */

export { Client } from "./client";

// Options (interfaces — 需要 export type 在 isolatedModules 模式下)
export type { AuthConfig, CircuitConfig, ClientOptions, RetryConfig, Role } from "./options";
export { DEFAULT_CIRCUIT_CONFIG, DEFAULT_RETRY_CONFIG } from "./options";

// Errors (classes)
export {
  APIError,
  BadRequestError,
  CircuitOpenError,
  ConflictError,
  ForbiddenError,
  MaxRetriesError,
  NotFoundError,
  NotImplementedError,
  UnauthorizedError,
  WauError,
} from "./errors";

// Types (classes)
export {
  Agent,
  AgentListResponse,
  AgentLoad,
  AgentRegisterRequest,
  AgentScore,
  AgentStatus,
  Candidate,
  DecisionInfo,
  HealthResponse,
  KernelInfo,
  PageOptions,
  SubmitRequest,
  SubmitResponse,
  Task,
} from "./types";

// Services
export { AgentsService } from "./agents";
export { IntentService } from "./intent";
export { KernelService } from "./kernel";
export { TasksService } from "./tasks";

// Building blocks (advanced)
export { Breaker, CircuitState, isCircuitFailure } from "./circuit";
export { Signer } from "./auth";
export { Retrier, isRetryable } from "./retry";
export { Transport } from "./transport";
