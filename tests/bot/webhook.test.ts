/**
 * bot.webhook — WebhookBot stub 单测(Stage 0)
 *
 * 5 case 镜像 Go + Python test 文件。
 */

import { describe, expect, it } from "vitest";

import { WebhookBot, newWebhookBot } from "../../src/bot/webhook";
import { newBuilder } from "../../src/bot/common";
import type { Bot } from "../../src/bot/common";

describe("WebhookBot stub (Stage 0)", () => {
  it("1. newWebhookBot returns WebhookBot instance", () => {
    const bot = newWebhookBot(":8080", newBuilder().withTenant("acme"));
    expect(bot).toBeDefined();
    expect(bot).toBeInstanceOf(WebhookBot);
    expect(bot.addr).toBe(":8080");
    expect(bot.tenant).toBe("acme");
  });

  it("2. async start/stop do not throw (stub)", async () => {
    const bot = newWebhookBot(":0", newBuilder());
    await expect(bot.start()).resolves.toBeUndefined();
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it("3. builder fields copied", () => {
    const bot = newWebhookBot(
      ":9000",
      newBuilder()
        .withTenant("acme")
        .withUniverse("cn-prod")
        .onMessage((_msg) => ({ text: "ok", attachments: [], replyTo: "" })),
    );
    expect(bot.addr).toBe(":9000");
    expect(bot.tenant).toBe("acme");
    expect(bot.universe).toBe("cn-prod");
    expect(bot.handler).not.toBeNull();
  });

  it("4. handler can be invoked directly (simulating webhook trigger)", () => {
    let called = false;
    const bot = newWebhookBot(
      ":0",
      newBuilder().onMessage((_msg) => {
        called = true;
        return { text: "ok", attachments: [], replyTo: "" };
      }),
    );
    if (bot.handler) {
      bot.invokeHandler({ ...defaultIncoming(), text: "hi" });
    }
    expect(called).toBe(true);
  });

  it("5. WebhookBot implements Bot interface (compile-time)", () => {
    const bot: Bot = newWebhookBot(":0", newBuilder());
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
