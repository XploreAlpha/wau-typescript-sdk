/**
 * bot.telegram — TelegramBot stub 单测(Stage 0)
 *
 * 6 case 镜像 wau-go-sdk/bot/telegram/telegram_test.go +
 * wau-python-sdk/tests/test_bot/telegram/test_telegram.py:
 *   1. newTelegramBot 返回 TelegramBot(非 undefined)
 *   2. newTelegramBot 自动从 builder 拷贝 tenant / universe / handler
 *   3. async start / stop 不报错(stub)
 *   4. onMessage chain 后 handler 覆盖
 *   5. withTenant / withUniverse chain
 *   6. 编译期 TelegramBot 是 Bot 子类型
 */

import { describe, expect, it } from "vitest";

import { TelegramBot, newTelegramBot } from "../../src/bot/telegram";
import { newBuilder } from "../../src/bot/common";
import type { Bot } from "../../src/bot/common";

describe("TelegramBot stub (Stage 0)", () => {
  it("1. newTelegramBot returns TelegramBot instance", () => {
    const bot = newTelegramBot("1234:test-token", newBuilder());
    expect(bot).toBeDefined();
    expect(bot).toBeInstanceOf(TelegramBot);
  });

  it("2. constructor copies builder fields", () => {
    const bot = newTelegramBot(
      "1234:test-token",
      newBuilder()
        .withTenant("acme")
        .withUniverse("us-prod")
        .onMessage((msg) => ({ text: `echo: ${msg.text}`, attachments: [], replyTo: "" })),
    );
    expect(bot.token).toBe("1234:test-token");
    expect(bot.tenant).toBe("acme");
    expect(bot.universe).toBe("us-prod");
    expect(bot.handler).not.toBeNull();
  });

  it("3. async start/stop do not throw (stub)", async () => {
    const bot = newTelegramBot("test-token", newBuilder());
    await expect(bot.start()).resolves.toBeUndefined();
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it("4. onMessage chain overrides handler", () => {
    let called = false;
    const bot = newTelegramBot("t", newBuilder()).onMessage((_msg) => {
      called = true;
      return { text: "ok", attachments: [], replyTo: "" };
    });
    expect(bot.handler).not.toBeNull();
    if (bot.handler) {
      bot.invokeHandler({ ...defaultIncoming(), text: "hi" });
    }
    expect(called).toBe(true);
  });

  it("5. withTenant / withUniverse chain returns Bot", () => {
    const bot = newTelegramBot("t", newBuilder());
    const result: Bot = bot.withTenant("t1").withUniverse("cn-prod");
    expect(result).toBe(bot);
    expect(bot.tenant).toBe("t1");
    expect(bot.universe).toBe("cn-prod");
  });

  it("6. TelegramBot implements Bot interface (compile-time)", () => {
    const bot: Bot = newTelegramBot("t", newBuilder());
    expect(bot).toBeDefined();
  });
});

function defaultIncoming() {
  return {
    platformMsgId: "",
    channelId: "",
    userId: "",
    username: "",
    text: "",
    attachments: [],
    replyTo: "",
    timestamp: new Date(),
  };
}
