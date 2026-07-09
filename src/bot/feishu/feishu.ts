/**
 * bot.feishu — Feishu (Lark) Bot SDK 集成(W6.2 Stage 1 native SDK)
 *
 * 实现 @larksuiteoapi/node-sdk 真 SDK Promise API:
 *   - start()   LarkChannel.connect() → 启 WS 长连接 + EventDispatcher
 *   - stop()    LarkChannel.disconnect()
 *   - PostMessage  → LarkChannel.send(to, input)
 *   - UpdateMessage → LarkChannel.editMessage(messageId, text)
 *   - 'message' events → NormalizedMessage → 转 IncomingMessage → handler
 *
 * 对齐 wau-go-sdk/bot/feishu/feishu.go + wau-channel
 * internal/adapter/feishu/feishu_real.go:FeishuRealClient 的语义。
 * Go 的 larkws.NewClient + larkim.Create/Patch 翻译为 LarkChannel Promise 抽象。
 *
 * W6 (2026-07-09) W6.2 Stage 1 任务。
 */

import { createLarkChannel, LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";
import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * FeishuBot — Feishu (Lark) Bot SDK 真集成(@larksuiteoapi/node-sdk)。
 *
 * 字段对齐 wau-go-sdk/bot/feishu/feishu.go:28-38 FeishuBot 字段。
 * Feishu (Lark) 用 AppID + AppSecret 鉴权 + VerificationToken 校验回调。
 */
export class FeishuBot implements Bot {
  public appId: string;
  public appSecret: string;
  public verificationToken: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  // --- 内部状态(LarkChannel 高阶封装) ---
  private channel: LarkChannel | null;
  private unsubscribe: (() => void) | null;
  private running: boolean;

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
    this.channel = null;
    this.unsubscribe = null;
    this.running = false;
  }

  /**
   * 启动 Feishu WS 长连接(LarkChannel.connect())。
   *
   * 步骤:
   *  1. 校验 appId + appSecret 非空
   *  2. 构造 LarkChannel(transport='websocket')
   *  3. 注册 'message' handler → 转 IncomingMessage → invokeHandler
   *  4. LarkChannel.connect() 启 WS(SDK 内部 autoReconnect)
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.appId || !this.appSecret) {
      throw new Error("feishu: empty appId or appSecret");
    }

    // 1. 构造 LarkChannel(高阶封装:WS + EventDispatcher + Send/Edit 全包含)
    this.channel = createLarkChannel({
      appId: this.appId,
      appSecret: this.appSecret,
      transport: "websocket",
      ...(this.verificationToken
        ? { webhook: { verificationToken: this.verificationToken } }
        : {}),
      loggerLevel: 1, // WARN level(per 0 门槛 UX,debug log 默认静音)
    });

    // 2. 注册 message event handler(LarkChannel 在 WS 连上后才会触发)
    // 注:per EventMap,message handler 收 NormalizedMessage。
    this.unsubscribe = this.channel.on("message", (msg: NormalizedMessage) => {
      try {
        const incoming: IncomingMessage = {
          platformMsgId: msg.messageId ?? "",
          channelId: msg.chatId ?? "",
          userId: msg.senderId ?? "",
          username: msg.senderName ?? "",
          text: msg.content ?? "",
          attachments: [],
          replyTo: msg.replyToMessageId ?? "",
          timestamp: msg.createTime ? new Date(msg.createTime) : new Date(),
        };
        this.invokeHandler(incoming);
      } catch (err) {
        // 0 门槛 UX:handler 内部 error 不抛到 SDK 内部事件循环
        console.error("[feishu] message handler error:", err);
      }
    });

    // 3. 启 WS(SDK 内部 autoReconnect 默认开启;失败 reject Promise)
    try {
      await this.channel.connect();
      this.running = true;
    } catch (err) {
      this.running = false;
      this.unsubscribe = null;
      throw new Error(
        `feishu: LarkChannel.connect failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 优雅停止 WS 长连接。
   *
   * 幂等 — 重复调用安全。
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch (err) {
        console.error("[feishu] unsubscribe error:", err);
      }
      this.unsubscribe = null;
    }
    if (this.channel) {
      try {
        await this.channel.disconnect();
      } catch (err) {
        console.error("[feishu] disconnect error:", err);
      }
      this.channel = null;
    }
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
   * PostMessage 通过 LarkChannel.send 发文本到 chat(per Feishu OpenAPI im/v1/messages)。
   *
   * @returns Feishu messageId(用作 UpdateMessage 的 messageID)
   */
  async postMessage(chatID: string, text: string): Promise<string> {
    if (!this.channel) {
      throw new Error("feishu: client not opened (call start first)");
    }
    if (!chatID) {
      throw new Error("feishu: empty chat_id");
    }
    if (!text) {
      throw new Error("feishu: empty text");
    }
    const result = await this.channel.send(chatID, { text });
    return result.messageId ?? "";
  }

  /**
   * UpdateMessage 通过 LarkChannel.editMessage 改文本(per Feishu OpenAPI PATCH .../messages/{id})。
   *
   * @param _chatID Feishu chat_id(保留作 caller 一致性,SDK editMessage 不直接收)
   * @param messageID 原消息 messageId
   * @param newText 新文本
   */
  async updateMessage(
    _chatID: string,
    messageID: string,
    newText: string,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error("feishu: client not opened (call start first)");
    }
    if (!messageID) {
      throw new Error("feishu: empty message_id");
    }
    if (!newText) {
      throw new Error("feishu: empty newText");
    }
    await this.channel.editMessage(messageID, newText);
  }

  /** 已注册的 handler(供测试直接 invoke)。 */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }
}

/** 用 appId + appSecret + verificationToken + builder 创建 Feishu bot。 */
export function newFeishuBot(
  appId: string,
  appSecret: string,
  verificationToken: string,
  builder: BotBuilder,
): FeishuBot {
  return new FeishuBot(appId, appSecret, verificationToken, builder);
}