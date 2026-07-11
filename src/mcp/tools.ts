/**
 * MCP tool name constants — 10 tool constants aligned byte-equal to
 * WAU-core-kernel `internal/protocol/mcp/tools.go` ToolXxx + handler routeToProtocol.
 *
 * W3 D87.1 实装 8 sync tool, 2 SSE tool (stream_message + subscribe_to_task) deferred to W5+.
 *
 * ⭐ v1.0.0 D87.7 W3 + W4-W5 实装(2026-07-11)。
 */

// 8 sync tools (W3 实装, 镜像 wau-go-sdk mcpclient/tools.go)
export const ToolHealthCheck = "health_check";
export const ToolParseAgentCard = "parse_agent_card";
export const ToolSendMessage = "send_message";
export const ToolGetTask = "get_task";
export const ToolListTasks = "list_tasks";
export const ToolCancelTask = "cancel_task";
export const ToolCreateTaskPushNotificationConfig = "create_task_push_notification_config";
export const ToolGetExtendedAgentCard = "get_extended_agent_card";

// 2 SSE tools (W5+ deferred, 本 SDK 暂不暴露 typed wrapper)
export const ToolStreamMessage = "stream_message";
export const ToolSubscribeToTask = "subscribe_to_task";

export const ALL_TOOL_NAMES: readonly string[] = [
  ToolHealthCheck,
  ToolParseAgentCard,
  ToolSendMessage,
  ToolStreamMessage,
  ToolGetTask,
  ToolListTasks,
  ToolCancelTask,
  ToolSubscribeToTask,
  ToolCreateTaskPushNotificationConfig,
  ToolGetExtendedAgentCard,
] as const;

/** 判断 tool 是不是 SSE 流式 tool (W5+ streaming)。*/
export function isStreamingTool(toolName: string): boolean {
  return toolName === ToolStreamMessage || toolName === ToolSubscribeToTask;
}