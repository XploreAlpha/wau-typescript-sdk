/**
 * bot.common.options — BotBuilder(per feedback-dev-style 偏好 builder 模式)
 *
 * 用法:
 *
 *   const bot = newBuilder()
 *     .withTenant("acme")
 *     .withUniverse("us-prod")
 *     .onMessage((msg) => ({ text: `echo: ${msg.text}`, attachments: [], replyTo: "" }))
 *     .build(new TelegramBot("token:xxx"));
 *
 * 对齐 wau-go-sdk/bot/common/options.go BotBuilder +
 * wau-python-sdk/src/wau_sdk/bot/common/options.py BotBuilder。
 */

import type { Bot } from "./bot";
import type { MessageHandler } from "./bot";
import type { OutgoingMessage } from "./message";

export class BotBuilder {
  private _tenantId: string = "";
  private _universe: string = "";
  private _handler: MessageHandler | null = null;

  withTenant(tenantId: string): this {
    this._tenantId = tenantId;
    return this;
  }

  withUniverse(universe: string): this {
    this._universe = universe;
    return this;
  }

  onMessage(handler: MessageHandler): this {
    this._handler = handler;
    return this;
  }

  // ---------- getters(供具体 adapter 读取)----------

  tenantId(): string {
    return this._tenantId;
  }

  universe(): string {
    return this._universe;
  }

  handler(): MessageHandler | null {
    return this._handler;
  }

  /**
   * Build 是占位入口(Stage 1 雏形期具体 adapter 实现)。
   *
   * Stage 0:接收 factory 函数返回具体 Bot 实例。
   * Stage 1:各 platform(telegram/discord/webhook) 的 newXxxBot() 函数用 BotBuilder 构建具体 Bot。
   */
  build(factory: (b: BotBuilder) => Bot): Bot {
    return factory(this);
  }
}

/** 创建 BotBuilder(等价于 Go 的 botcommon.NewBuilder()) */
export function newBuilder(): BotBuilder {
  return new BotBuilder();
}

/** 默认 handler(返回空响应,防止漏配) */
export const DEFAULT_HANDLER: MessageHandler = (_msg): OutgoingMessage => ({
  text: "",
  attachments: [],
  replyTo: "",
});
