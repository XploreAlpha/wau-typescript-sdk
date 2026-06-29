/**
 * bot.telegram — Telegram Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:TelegramBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 7 实装 Telegram Bot API 集成(getUpdates / setWebhook / sendMessage)。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * TelegramBot stub
 *
 * 对齐 wau-go-sdk/bot/telegram/telegram.go:14-19 TelegramBot 字段 +
 * wau-python-sdk/src/wau_sdk/bot/telegram/bot.py:25-29 TelegramBot 字段。
 */
export class TelegramBot implements Bot {
  public token: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  constructor(token: string, builder: BotBuilder) {
    this.token = token;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
  }

  /** 启动 bot(stub)。Stage 1 实装:Telegram Bot API getUpdates / setWebhook。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): 接入 Telegram Bot API (getUpdates / setWebhook)
  }

  /** 优雅停止(stub) */
  async stop(): Promise<void> {
    return;
  }

  onMessage(handler: MessageHandler): this {
    this.handler = handler;
    return this;
  }

  withTenant(tenantId: string): this {
    this.tenant = tenantId;
    return this;
  }

  withUniverse(universe: string): this {
    this.universe = universe;
    return this;
  }

  /** 已注册的 handler(供测试直接 invoke) */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }
}

/** 用 token + builder 创建 Telegram bot(stub)。对齐 Go/Python 的 New()。 */
export function newTelegramBot(token: string, builder: BotBuilder): TelegramBot {
  return new TelegramBot(token, builder);
}
