/**
 * bot.feishu — Feishu (Lark) Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:FeishuBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 8 实装 @larksuiteoapi/node-sdk 长连接接收 + 事件回调。
 *
 * W5 (2026-07-13) OSS-onboarding closure:4 SDK 5 平台 bot/ 完整 SDK 端实现。
 * 公共 Bot interface 沿用 M10 N1 拍板(start/stop/onMessage/withTenant/withUniverse)。
 * 注册走 wau-edge POST /v1/bots/{bot_id}/messages(per M10 N3)。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * FeishuBot stub
 *
 * 对齐 wau-go-sdk/bot/feishu/feishu.go:28-38 FeishuBot 字段。
 * Feishu (Lark) 用 AppID + AppSecret 鉴权 + VerificationToken 校验回调。
 */
export class FeishuBot implements Bot {
  public appId: string;
  public appSecret: string;
  public verificationToken: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  constructor(
    appId: string,
    appSecret: string,
    verificationToken: string,
    builder: BotBuilder,
  ) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.verificationToken = verificationToken;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
  }

  /** 启动 bot(stub)。Stage 1 实装:@larksuiteoapi/node-sdk 事件订阅 + 长连接。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): import @larksuiteoapi/node-sdk,WSClient + EventDispatcher
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

/** 用 appId + appSecret + verificationToken + builder 创建 Feishu bot(stub)。对齐 Go/Python 的 New()。 */
export function newFeishuBot(
  appId: string,
  appSecret: string,
  verificationToken: string,
  builder: BotBuilder,
): FeishuBot {
  return new FeishuBot(appId, appSecret, verificationToken, builder);
}