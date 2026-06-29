/**
 * bot.discord — DiscordBot stub 单测(Stage 0)
 *
 * 6 case 镜像 Go + Python test 文件。
 */

import { describe, expect, it } from "vitest";

import { DiscordBot, newDiscordBot } from "../../src/bot/discord";
import { newBuilder } from "../../src/bot/common";
import type { Bot } from "../../src/bot/common";

describe("DiscordBot stub (Stage 0)", () => {
  it("1. newDiscordBot returns DiscordBot instance", () => {
    const bot = newDiscordBot("discord-bot-token", newBuilder());
    expect(bot).toBeDefined();
    expect(bot).toBeInstanceOf(DiscordBot);
  });

  it("2. constructor copies builder fields", () => {
    const bot = newDiscordBot(
      "discord-bot-token",
      newBuilder()
        .withTenant("acme")
        .withUniverse("us-prod")
        .onMessage((_msg) => ({ text: "ack", attachments: [], replyTo: "" })),
    );
    expect(bot.token).toBe("discord-bot-token");
    expect(bot.tenant).toBe("acme");
    expect(bot.universe).toBe("us-prod");
    expect(bot.handler).not.toBeNull();
  });

  it("3. async start/stop do not throw (stub)", async () => {
    const bot = newDiscordBot("t", newBuilder());
    await expect(bot.start()).resolves.toBeUndefined();
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it("4. onMessage chain overrides handler", () => {
    let called = false;
    const bot = newDiscordBot("t", newBuilder()).onMessage((_msg) => {
      called = true;
      return { text: "ok", attachments: [], replyTo: "" };
    });
    if (bot.handler) {
      bot.invokeHandler({ ...defaultIncoming(), text: "hi" });
    }
    expect(called).toBe(true);
  });

  it("5. withTenant / withUniverse chain returns Bot", () => {
    const bot = newDiscordBot("t", newBuilder());
    const result: Bot = bot.withTenant("t1").withUniverse("cn-prod");
    expect(result).toBe(bot);
    expect(bot.tenant).toBe("t1");
    expect(bot.universe).toBe("cn-prod");
  });

  it("6. DiscordBot implements Bot interface (compile-time)", () => {
    const bot: Bot = newDiscordBot("t", newBuilder());
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
