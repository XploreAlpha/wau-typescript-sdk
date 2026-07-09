/**
 * bot.slack — Slack Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:SlackBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 7 实装 Slack Bot API 集成(Web API /chat.postMessage + Socket Mode)。
 *
 * W5 (2026-07-13) OSS-onboarding closure:4 SDK 5 平台 bot/ 完整 SDK 端实现。
 * 公共 Bot interface 沿用 M10 N1 拍板(start/stop/onMessage/withTenant/withUniverse)。
 * 注册走 wau-edge POST /v1/bots/{bot_id}/messages(per M10 N3)。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * SlackBot stub
 *
 * 对齐 wau-go-sdk/bot/slack/slack.go:28-38 SlackBot 字段。
 * Slack 同时需要 Bot User OAuth Token (xoxb-) 和 App-Level Token (xapp-),
 * 故构造器收两个 token。
 */
export class SlackBot implements Bot {
  public botToken: string;
  public appToken: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  constructor(botToken: string, appToken: string, builder: BotBuilder) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
  }

  /** 启动 bot(stub)。Stage 1 实装:@slack/web-api + Socket Mode 长连接。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): import @slack/web-api + socket-mode,app.token 启动 Socket Mode
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

/** 用 botToken + appToken + builder 创建 Slack bot(stub)。对齐 Go/Python 的 New()。 */
export function newSlackBot(
  botToken: string,
  appToken: string,
  builder: BotBuilder,
): SlackBot {
  return new SlackBot(botToken, appToken, builder);
}