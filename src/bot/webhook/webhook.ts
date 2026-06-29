/**
 * bot.webhook — 通用 Webhook Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:WebhookBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 9 实装 HTTPS POST 端点 + 签名验证 + 消息归一化。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * WebhookBot stub
 *
 * 对齐 wau-go-sdk/bot/webhook/webhook.go:14-19 WebhookBot 字段 +
 * wau-python-sdk/src/wau_sdk/bot/webhook/bot.py:25-29 WebhookBot 字段。
 */
export class WebhookBot implements Bot {
  public addr: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  constructor(addr: string, builder: BotBuilder) {
    this.addr = addr;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
  }

  /** 启动 webhook server(stub)。Stage 1 实装:HTTP server + 签名验证。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): http.Server + 签名验证 + 消息归一化
  }

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

export function newWebhookBot(addr: string, builder: BotBuilder): WebhookBot {
  return new WebhookBot(addr, builder);
}
