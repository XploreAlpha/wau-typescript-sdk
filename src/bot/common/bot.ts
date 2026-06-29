/**
 * bot.common.bot — Bot interface(per D13 拍板:4 SDK 方法签名 100% 一致)
 *
 * 抽象方法签名严格对齐 wau-go-sdk/bot/common/bot.go Bot interface +
 * wau-python-sdk/src/wau_sdk/bot/common/bot.py Bot ABC。
 */

import type { IncomingMessage, OutgoingMessage } from "./message";

/** Handler 类型:同步(per Go SDK func(IncomingMessage) OutgoingMessage) */
export type MessageHandler = (msg: IncomingMessage) => OutgoingMessage;

/**
 * Bot 通用 Bot interface(per D13)。
 *
 * 4 SDK 必须实现的方法签名 100% 一致:
 *   - start(): Promise<void>
 *   - stop(): Promise<void>
 *   - onMessage(handler): Bot
 *   - withTenant(tenantId): Bot
 *   - withUniverse(universe): Bot
 */
export interface Bot {
  /** 启动 bot(长连接 / webhook server) */
  start(): Promise<void>;

  /** 优雅停止 */
  stop(): Promise<void>;

  /** 注册消息处理 handler,返回 Bot 支持链式调用 */
  onMessage(handler: MessageHandler): Bot;

  /** 设置 tenantId,返回 Bot 支持链式调用 */
  withTenant(tenantId: string): Bot;

  /** 设置 Universe 标签(W-6),返回 Bot 支持链式调用 */
  withUniverse(universe: string): Bot;
}
