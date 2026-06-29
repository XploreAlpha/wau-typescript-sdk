/**
 * bot.common — 4 SDK 公共 Bot interface / 消息类型 / builder(per D13 拍板:完全统一)
 *
 * 字段名 + 类型必须与 wau-go-sdk / wau-python-sdk / wau-rust-sdk 100% 一致。
 */

export type { Attachment, IncomingMessage, OutgoingMessage } from "./message";
export { newIncomingMessage, newOutgoingMessage } from "./message";

export type { Bot, MessageHandler } from "./bot";

export { BotBuilder, DEFAULT_HANDLER, newBuilder } from "./options";
