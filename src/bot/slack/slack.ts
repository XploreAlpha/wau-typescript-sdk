/**
 * bot.slack — Slack Bot SDK 集成(W6.2 Stage 1 native SDK)
 *
 * 实现 @slack/web-api + @slack/socket-mode 真 SDK Promise API:
 *   - start()   SocketModeClient.start() → 启 WS 长连接
 *   - stop()    SocketModeClient.disconnect()
 *   - PostMessage  → WebClient.chat.postMessage  (chat.postMessage API)
 *   - UpdateMessage → WebClient.chat.update    (chat.update API)
 *   - Socket Mode events(events_api:message) → 转 IncomingMessage → handler
 *
 * 对齐 wau-go-sdk/bot/slack/slack_real.go:SlackRealClient + wau-channel
 * internal/adapter/slack/slack_real.go 的语义。Go 的同步调用翻译为 Promise。
 *
 * W6 (2026-07-09) W6.2 Stage 1 任务。
 */

import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * SlackBot — Slack Bot SDK 真集成(@slack/web-api + @slack/socket-mode)。
 *
 * 字段对齐 wau-go-sdk/bot/slack/slack.go:28-38 SlackBot 字段。
 * Slack 同时需要 Bot User OAuth Token (xoxb-) 和 App-Level Token (xapp-) —
 * 故构造器收两个 token。
 */
export class SlackBot implements Bot {
  public botToken: string;
  public appToken: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  // --- 内部状态(Socket Mode + Web API client) ---
  private webClient: WebClient | null;
  private socketClient: SocketModeClient | null;
  private running: boolean;

  constructor(botToken: string, appToken: string, builder: BotBuilder) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
    this.webClient = null;
    this.socketClient = null;
    this.running = false;
  }

  /**
   * 启动 Socket Mode 长连接。
   *
   * 步骤:
   *  1. 校验 token 非空(0 门槛 UX:空 token 立即返 error)
   *  2. 构造 WebClient(botToken) + SocketModeClient(appToken)
   *  3. SocketModeClient.start() 启 WS 连接 + AuthTest(内部)
   *  4. 注册 events_api message handler → 转 IncomingMessage → invokeHandler
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.botToken) {
      throw new Error("slack: empty bot token (xoxb-)");
    }
    if (!this.appToken) {
      throw new Error("slack: empty app token (xapp-, Socket Mode requires)");
    }

    // 1. REST API client (chat.postMessage / chat.update / auth.test)
    this.webClient = new WebClient(this.botToken);

    // 2. Socket Mode client(长连接 + 事件分发)
    this.socketClient = new SocketModeClient({
      appToken: this.appToken,
      autoReconnectEnabled: true,
    });

    // 3. 注册 message event handler(SocketModeClient.start() 后会触发)
    // 注:SocketModeClient 用 EventEmitter 模式;事件 'events_api' 是内部事件类型,
    // type='message' 的事件需要再过滤一次(per Go 的 slackevents.Message 过滤)。
    this.socketClient.on("events_api", async (args: any) => {
      try {
        const ev = args?.event;
        if (!ev || ev.type !== "message") {
          return;
        }
        // 忽略 bot 自身消息(subtype === 'bot_message')
        if (ev.subtype === "bot_message") {
          return;
        }
        const incoming: IncomingMessage = {
          platformMsgId: ev.ts ?? "",
          channelId: ev.channel ?? "",
          userId: ev.user ?? "",
          username: ev.username ?? "",
          text: ev.text ?? "",
          attachments: [],
          replyTo: ev.thread_ts ?? "",
          timestamp: new Date(),
        };
        // ACK 必发(per Slack Socket Mode protocol)
        if (args?.envelope_id && this.socketClient) {
          // @ts-expect-error send 是 private but 文档示例调它
          this.socketClient.send?.(args.envelope_id, {});
        }
        this.invokeHandler(incoming);
      } catch (err) {
        // 0 门槛 UX:handler 内部 error 不抛到 SDK 内部事件循环
        console.error("[slack] events_api handler error:", err);
      }
    });

    // 4. 启 WS(SDK 内部 autoReconnect 默认开启)
    try {
      await this.socketClient.start();
      this.running = true;
    } catch (err) {
      this.running = false;
      throw new Error(
        `slack: SocketModeClient.start failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 优雅停止 Socket Mode + REST client。
   *
   * 幂等 — 重复调用安全。
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.socketClient) {
      try {
        await this.socketClient.disconnect();
      } catch (err) {
        console.error("[slack] disconnect error:", err);
      }
      this.socketClient = null;
    }
    this.webClient = null;
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

  /**
   * PostMessage 通过 @slack/web-api 调 chat.postMessage。
   *
   * @returns Slack ts(消息时间戳,用作 UpdateMessage 的 messageID)
   */
  async postMessage(channelID: string, text: string): Promise<string> {
    if (!this.webClient) {
      throw new Error("slack: client not opened (call start first)");
    }
    if (!channelID) {
      throw new Error("slack: empty channel ID");
    }
    if (!text) {
      throw new Error("slack: empty text");
    }
    const resp = await this.webClient.chat.postMessage({
      channel: channelID,
      text,
    });
    if (!resp.ok) {
      throw new Error(`slack: chat.postMessage failed: ${resp.error ?? "unknown"}`);
    }
    return resp.ts ?? "";
  }

  /**
   * UpdateMessage 通过 @slack/web-api 调 chat.update。
   *
   * @param channelID Slack channel ID
   * @param ts 原消息 ts(per Slack messageID 语义)
   * @param newText 新文本
   */
  async updateMessage(
    channelID: string,
    ts: string,
    newText: string,
  ): Promise<string> {
    if (!this.webClient) {
      throw new Error("slack: client not opened (call start first)");
    }
    if (!channelID || !ts) {
      throw new Error("slack: empty channelID or ts");
    }
    if (!newText) {
      throw new Error("slack: empty newText");
    }
    const resp = await this.webClient.chat.update({
      channel: channelID,
      ts,
      text: newText,
    });
    if (!resp.ok) {
      throw new Error(`slack: chat.update failed: ${resp.error ?? "unknown"}`);
    }
    return resp.ts ?? ts;
  }

  /** 已注册的 handler(供测试直接 invoke)。 */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }
}

/** 用 botToken + appToken + builder 创建 Slack bot。 */
export function newSlackBot(
  botToken: string,
  appToken: string,
  builder: BotBuilder,
): SlackBot {
  return new SlackBot(botToken, appToken, builder);
}