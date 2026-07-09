/**
 * bot.qq — QQ Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:QQBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 9 实装 QQ 官方 Bot SDK (qq-bot-sdk) 集成。
 *
 * W5 (2026-07-13) OSS-onboarding closure:4 SDK 5 平台 bot/ 完整 SDK 端实现。
 * 公共 Bot interface 沿用 M10 N1 拍板(start/stop/onMessage/withTenant/withUniverse)。
 * 注册走 wau-edge POST /v1/bots/{bot_id}/messages(per M10 N3)。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * QQBot stub
 *
 * 对齐 wau-go-sdk/bot/qq/qq.go:28-38 QQBot 字段。
 * QQ 频道 Bot 用 AppID + AppSecret (client credentials) + 频道鉴权。
 */
export class QQBot implements Bot {
  public appId: string;
  public appSecret: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  constructor(appId: string, appSecret: string, builder: BotBuilder) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
  }

  /** 启动 bot(stub)。Stage 1 实装:qq-bot-sdk + WebSocket 长连接 / Webhook。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): import qq-bot-sdk,启动 WSClient 或 Webhook server
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

/** 用 appId + appSecret + builder 创建 QQ bot(stub)。对齐 Go/Python 的 New()。 */
export function newQQBot(
  appId: string,
  appSecret: string,
  builder: BotBuilder,
): QQBot {
  return new QQBot(appId, appSecret, builder);
}