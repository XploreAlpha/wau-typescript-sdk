/**
 * WAU TypeScript SDK — Bot 子包(per v0.9.0 Stage 0 / D13 拍板)
 *
 * 子包结构(镜像 wau-go-sdk/bot/ + wau-python-sdk/src/wau_sdk/bot/):
 *
 *   ./common    — 4 SDK 公共接口(Bot / IncomingMessage / OutgoingMessage /
 *                 Attachment / BotBuilder)
 *   ./telegram  — Telegram Bot SDK 集成(stub,Stage 0)
 *   ./discord   — Discord Bot SDK 集成(stub,Stage 0)
 *   ./webhook   — 通用 Webhook Bot SDK 集成(stub,Stage 0)
 *
 * Stage 0:只搭骨架 + Bot interface + 3 个 stub Bot 实现。
 * Stage 1 M1 子项 7-9 实装 Telegram Bot API / Discord Bot Gateway / HTTP Webhook 接入。
 *
 * 字段名 + 类型必须与 wau-go-sdk / wau-python-sdk / wau-rust-sdk 100% 一致
 * (per D13:4 SDK Bot interface 完全统一)。
 */

// common
export type {
  Attachment,
  Bot,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
} from "./common";
export {
  BotBuilder,
  DEFAULT_HANDLER,
  newBuilder,
  newIncomingMessage,
  newOutgoingMessage,
} from "./common";

// telegram
export { TelegramBot, newTelegramBot } from "./telegram";

// discord
export { DiscordBot, newDiscordBot } from "./discord";

// webhook
export { WebhookBot, newWebhookBot } from "./webhook";
