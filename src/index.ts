/**
 * wau-sdk v0.6.0-preview.1 — 公开 API 入口
 *
 * 用法:
 *   import { Client, SubmitRequest } from "wau-sdk";
 *   const c = new Client("http://localhost:18400");
 *   const resp = await c.tasks.submit(new SubmitRequest("hello"));
 */

export { Client } from "./client";

// Options (interfaces — 需要 export type 在 isolatedModules 模式下; Role 是 enum 值,值 export)
export type { AuthConfig, CircuitConfig, ClientOptions, RetryConfig } from "./options";
export { DEFAULT_CIRCUIT_CONFIG, DEFAULT_RETRY_CONFIG, Role } from "./options";

// Errors (classes)
export {
  APIError,
  BadRequestError,
  CircuitOpenError,
  ConflictError,
  ForbiddenError,
  HandshakeAgentNoEndpointError,  // v0.8.0 M5-1 B.1
  HandshakeAgentNotFoundError,
  HandshakeInsufficientTrustError,
  HandshakeInvalidProtocolError,
  HandshakeInvalidRequestError,
  HandshakeProtocolNotSupportedError,
  HandshakeRateLimitedError,
  HandshakeSessionNotFoundError,
  HandshakeTenantMismatchError,
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
  ChatChoice,  // v0.9.0 M3 §3.7
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatUsage,
  ChunkDelta,    // Stage 3.1 #10 SSE
  ChunkChoice,   // Stage 3.1 #10 SSE
  ChatCompletionChunk, // Stage 3.1 #10 SSE
  DecisionInfo,
  HandshakeRequest,  // v0.8.0 M5-1 B.1
  HandshakeResponse,
  HandshakeSessionDetail,
  HandshakeStats,
  HealthResponse,
  KernelInfo,
  PageOptions,
  SubmitRequest,
  SubmitResponse,
  Task,
} from "./types";

// Services
export { AgentsService } from "./agents";
export { ChatService } from "./chat";  // v0.9.0 M3 §3.7
export { HandshakeService } from "./handshake";  // v0.8.0 M5-1 B.1
export { IntentService } from "./intent";
export { KernelService } from "./kernel";
export { TasksService } from "./tasks";

// Building blocks (advanced)
export { Breaker, CircuitState, isCircuitFailure } from "./circuit";
export { Signer } from "./auth";
export { Retrier, isRetryable } from "./retry";
export { Transport } from "./transport";

// UCP client (v1.3.3, per D88.7) — 11 commerce tool wrapper (JSON-RPC 2.0 over HTTP)
// 独立子包,跟 mcpclient 后续也会走同 pattern(D60 additive, 0 改老 modules)
export {
  DEFAULT_ENDPOINT as UCP_DEFAULT_ENDPOINT,
  DEFAULT_USER_AGENT as UCP_DEFAULT_USER_AGENT,
  UCPClient,
} from "./ucp";
export type {
  CancelOrderResult,
  Cart,
  CartLineItem,
  CheckoutSession,
  FetchImpl,
  ListOrdersFilter,
  ListOrdersResult,
  ListProductsFilter,
  ListProductsResult,
  Order,
  PaymentConfirmation,
  Product,
  SearchProductsResult,
  UCPClientOptions,
} from "./ucp";
export {
  isNotFound as isUCPNotFound,
  isStripeError as isUCPStripeError,
  PaymentStatusFailed as UCPPaymentStatusFailed,
  PaymentStatusPending as UCPPaymentStatusPending,
  PaymentStatusProcessing as UCPPaymentStatusProcessing,
  PaymentStatusSucceeded as UCPPaymentStatusSucceeded,
  RPCError as UCPRPCError,
  setBearerToken as UCPSetBearerToken,
  setTenantID as UCPSetTenantID,
  UcpAuth,
} from "./ucp";

// MCP client (v1.3.2, per D87.7) — 8 sync tool wrapper (JSON-RPC 2.0 over HTTP)
// 独立子包, D60 additive (0 改老 modules),2 SSE streaming tool (streamMessage + subscribeToTask) deferred to W5+
export {
  ALL_TOOL_NAMES as MCP_ALL_TOOL_NAMES,
  AuthHeaderName as MCPAuthHeaderName,
  AuthSchemePrefix as MCPAuthSchemePrefix,
  DefaultUserAgent as MCPAuthDefaultUserAgent,
  MCPClient,
  isStreamingTool as MCPIsStreamingTool,
} from "./mcp";
export type {
  AgentCard,
  Artifact,
  ExtendedAgentCard,
  FetchImpl as MCPFetchImpl,
  HealthCheckResult,
  ListTasksFilter,
  ListTasksResult,
  MCPClientOptions,
  Message,
  Part,
  PushConfig,
  PushConfigResult,
  RPCErrorPayload as MCPRPCErrorPayload,
  Task as MCPTask,
} from "./mcp";
export {
  ErrCodeInternal as MCPErrCodeInternal,
  ErrCodeMCPInvalidAgentCard as MCPErrCodeMCPInvalidAgentCard,
  ErrCodeMCPAgentUnreachable as MCPErrCodeMCPAgentUnreachable,
  ErrCodeMCPTaskNotFound as MCPErrCodeMCPTaskNotFound,
  ErrCodeMethodNotFound as MCPErrCodeMethodNotFound,
  ErrCodeParse as MCPErrCodeParse,
  ErrCodeInvalidParams as MCPErrCodeInvalidParams,
  ErrCodeInvalidRequest as MCPErrCodeInvalidRequest,
  RPCError as MCPRPCError,
  McpAuth,
  buildHeaders as buildMCPHeaders,
  isAgentUnreachable as isMCPAgentUnreachable,
  isTaskNotFound as isMCPTaskNotFound,
  setBearerToken as MCPSetBearerToken,
} from "./mcp";
export {
  ToolCancelTask,
  ToolCreateTaskPushNotificationConfig,
  ToolGetExtendedAgentCard,
  ToolGetTask,
  ToolHealthCheck,
  ToolListTasks,
  ToolParseAgentCard,
  ToolSendMessage,
  ToolStreamMessage,
  ToolSubscribeToTask,
} from "./mcp";

// Wau client (v1.3.1, per v1.0.1 Phase 0 拍板 + SDK Consumer Contract §二)
// 独立子包, D60 additive (0 改老 modules), 4 method skeleton + 19-field WauWorkflow type
export {
  asWauWorkflowError,
  isWauRetryable,
  WAU_DEFAULT_HEARTBEAT_INTERVAL_MS,
  WAU_DEFAULT_TIMEOUT_MS,
  WAU_DEFAULT_USER_AGENT,
  WauClient,
  WauErrCodeAuthFailed,
  WauErrCodeConfidenceTooLow,
  WauErrCodeInvalidHarness,
  WauErrCodeInvalidWorkflowType,
  WauErrCodeNetworkError,
  WauErrCodeServerError,
  WauErrCodeTimeout,
  WauWorkflowError,
} from "./wau";
export type {
  WauClientConfig,
  WauClientOptions,
  WauSystemCapability,
  WauWorkflow,
  WauWorkflowAgent,
  WauWorkflowDependency,
  WauWorkflowErrorCode,
  WauWorkflowType,
} from "./wau";
export type { FetchImpl as WauFetchImpl } from "./wau";
