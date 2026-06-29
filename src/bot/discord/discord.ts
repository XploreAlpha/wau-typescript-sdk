/**
 * bot.discord — Discord Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:DiscordBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 8 实装 Discord Bot Gateway (WebSocket) 接入。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * DiscordBot stub
 *
 * 对齐 wau-go-sdk/bot/discord/discord.go:14-19 DiscordBot 字段 +
 * wau-python-sdk/src/wau_sdk/bot/discord/bot.py:25-29 DiscordBot 字段。
 */
export class DiscordBot implements Bot {
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

  /** 启动 bot(stub)。Stage 1 实装:Discord Bot Gateway (WebSocket)。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): 接入 Discord Bot Gateway (WebSocket)
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

  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }
}

export function newDiscordBot(token: string, builder: BotBuilder): DiscordBot {
  return new DiscordBot(token, builder);
}
