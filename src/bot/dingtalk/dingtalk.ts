/**
 * bot.dingtalk — Dingtalk (Dingding) Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:DingtalkBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 10 实装 dingtalk-stream 长连接 / OpenAPI 回调接入。
 *
 * W5 (2026-07-13) OSS-onboarding closure:4 SDK 5 平台 bot/ 完整 SDK 端实现。
 * 公共 Bot interface 沿用 M10 N1 拍板(start/stop/onMessage/withTenant/withUniverse)。
 * 注册走 wau-edge POST /v1/bots/{bot_id}/messages(per M10 N3)。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * DingtalkBot stub
 *
 * 对齐 wau-go-sdk/bot/dingtalk/dingtalk.go:28-38 DingtalkBot 字段。
 * 钉钉机器人(企业内部)用 AppKey + AppSecret + RobotCode 三段鉴权。
 */
export class DingtalkBot implements Bot {
  public appKey: string;
  public appSecret: string;
  public robotCode: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  constructor(
    appKey: string,
    appSecret: string,
    robotCode: string,
    builder: BotBuilder,
  ) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.robotCode = robotCode;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
  }

  /** 启动 bot(stub)。Stage 1 实装:dingtalk-stream StreamClient + 事件回调。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): import dingtalk-stream,启动 StreamClient + RegisterRobotCallback
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

/** 用 appKey + appSecret + robotCode + builder 创建 Dingtalk bot(stub)。对齐 Go/Python 的 New()。 */
export function newDingtalkBot(
  appKey: string,
  appSecret: string,
  robotCode: string,
  builder: BotBuilder,
): DingtalkBot {
  return new DingtalkBot(appKey, appSecret, robotCode, builder);
}