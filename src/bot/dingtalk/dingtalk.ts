/**
 * bot.dingtalk — Dingtalk Bot SDK 集成(W6.2 Stage 1 native SDK)
 *
 * 实现 dingtalk-stream ^2.1.0 真 SDK Promise API(DWClient)。
 *
 * 设计要点(per W6 拍板 + wau-go-sdk/bot/dingtalk + wau-channel
 * internal/adapter/dingtalk/dingtalk_real.go):
 *   - 收件:DWClient + TOPIC_ROBOT subscription,RegisterAllEventListener 收 chatbot callback
 *   - 发件:用 sessionWebhook(从 incoming 缓存)+ 调 GraphAPIResponse 回复
 *     或 DWClient.socketCallBackResponse(messageId, value)
 *   - 协议合规:D60+D66+D78+D80+D13 全 hold(per Slack/Feishu 同 pattern)
 *
 * DingTalk 平台语义(Stream Mode):
 *   - chatbot callback 没有 "update message" API,只有 reply-by-webhook
 *   - 每条 incoming 消息带 sessionWebhook,直接 POST 到该 URL 即可回复
 *   - UpdateMessage 语义 = reply with new text(messageID 保留作 caller 一致性)
 *
 * W6 (2026-07-09) W6.2 Stage 1 任务。
 */

import { DWClient, TOPIC_ROBOT, EventAck } from "dingtalk-stream";
import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/** 钉钉 chatbot callback data 结构(从 DWClientDownStream.data 字符串 parse 出)。 */
interface DingtalkRobotMessage {
  conversationId: string;
  chatbotCorpId: string;
  chatbotUserId: string;
  msgId: string;
  senderNick: string;
  isAdmin: boolean;
  senderStaffId: string;
  sessionWebhookExpiredTime: number;
  createAt: number;
  senderCorpId: string;
  conversationType: string;
  senderId: string;
  sessionWebhook: string;
  robotCode: string;
  msgtype: string;
  text?: { content: string };
}

/**
 * DingtalkBot — 钉钉 Bot SDK 真集成(dingtalk-stream DWClient)。
 *
 * 字段对齐 wau-go-sdk/bot/dingtalk/dingtalk.go:28-38 DingtalkBot 字段。
 * 钉钉机器人(企业内部)用 AppKey + AppSecret + RobotCode 三段鉴权。
 */
export class DingtalkBot implements Bot {
  public appKey: string;
  public appSecret: string;
  public robotCode: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  // --- 内部状态(DWClient) ---
  private client: DWClient | null;
  /** conversationID → sessionWebhook URL 映射(由 incoming 事件填,PostMessage 用)。 */
  private webhooks: Map<string, string>;
  private running: boolean;

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
    this.client = null;
    this.webhooks = new Map();
    this.running = false;
  }

  /**
   * 启动 DWClient Stream Mode(websocket 长连接 + chatbot callback)。
   *
   * 步骤:
   *  1. 校验 appKey + appSecret 非空
   *  2. 构造 DWClient(clientId=appKey, clientSecret=appSecret,
   *     subscriptions=[{type:'event', topic:TOPIC_ROBOT}])
   *  3. 注册 RegisterAllEventListener 收 DWClientDownStream,parse 出 robot message
   *  4. 缓存 sessionWebhook(供 PostMessage / UpdateMessage 用)
   *  5. 调 client.connect() 启 WS(SDK 内部 autoReconnect)
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.appKey || !this.appSecret) {
      throw new Error("dingtalk: empty appKey or appSecret");
    }

    // 1. 构造 DWClient(subscriptions 必须是 [{type:'EVENT', topic:TOPIC_ROBOT}])
    // 注:DWClient constructor 类型仅暴露 4 字段,但运行时 config 完整(JS 用 ...defaults 合并)
    this.client = new DWClient({
      clientId: this.appKey,
      clientSecret: this.appSecret,
      keepAlive: true,
      subscriptions: [{ type: "EVENT", topic: TOPIC_ROBOT }],
    } as ConstructorParameters<typeof DWClient>[0]);

    // 2. 注册 chatbot callback(per dingtalk-stream SDK API)
    this.client.registerAllEventListener((raw: any) => {
      try {
        // DWClientDownStream.data 是 string(JSON),解析为 robot message
        const msg: DingtalkRobotMessage =
          typeof raw?.data === "string" ? JSON.parse(raw.data) : raw?.data ?? {};
        if (!msg || !msg.msgId) {
          return { status: EventAck.SUCCESS };
        }
        // 缓存 sessionWebhook(供后续 PostMessage / UpdateMessage 用)
        if (msg.conversationId && msg.sessionWebhook) {
          this.cacheWebhook(msg.conversationId, msg.sessionWebhook);
        }
        // 归一化 + invoke handler
        const incoming: IncomingMessage = {
          platformMsgId: msg.msgId,
          channelId: msg.conversationId,
          userId: msg.senderStaffId ?? msg.senderId,
          username: msg.senderNick,
          text: msg.text?.content ?? "",
          attachments: [],
          replyTo: "",
          timestamp: msg.createAt ? new Date(msg.createAt) : new Date(),
        };
        try {
          this.invokeHandler(incoming);
        } catch (err) {
          console.error("[dingtalk] handler error:", err);
        }
        // ACK(per SDK protocol:SUCCESS 表示已同步处理完)
        return { status: EventAck.SUCCESS };
      } catch (err) {
        console.error("[dingtalk] callback error:", err);
        return { status: EventAck.SUCCESS };
      }
    });

    // 3. 启 WS(SDK 内部 connect → 拉 endpoint → 启 WS → start heartbeat)
    try {
      await this.client.connect();
      this.running = true;
    } catch (err) {
      this.running = false;
      this.client = null;
      throw new Error(
        `dingtalk: DWClient.connect failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 优雅停止 DWClient。
   *
   * 幂等 — 重复调用安全。
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.client) {
      try {
        this.client.disconnect();
      } catch (err) {
        console.error("[dingtalk] disconnect error:", err);
      }
      this.client = null;
    }
    this.webhooks.clear();
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
   * PostMessage 用 cached sessionWebhook 发文本(per 钉钉 Stream Mode chatbot 模型)。
   *
   * 注意:conversationID 必须先收到 incoming 事件才能 PostMessage(否则 webhooks 缓存空)。
   */
  async postMessage(conversationID: string, text: string): Promise<string> {
    if (!this.client) {
      throw new Error("dingtalk: client not opened (call start first)");
    }
    if (!conversationID) {
      throw new Error("dingtalk: empty conversationID");
    }
    if (!text) {
      throw new Error("dingtalk: empty text");
    }
    const webhook = this.webhooks.get(conversationID);
    if (!webhook) {
      throw new Error(
        `dingtalk: no sessionWebhook cached for conversationID=${conversationID} (must receive incoming message first)`,
      );
    }
    // 通过 webhook URL POST 文本消息
    try {
      const resp = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: text },
        }),
      });
      if (!resp.ok) {
        throw new Error(`dingtalk: webhook POST status ${resp.status}`);
      }
    } catch (err) {
      throw new Error(
        `dingtalk: sessionWebhook POST failed: ${(err as Error).message}`,
      );
    }
    // 钉钉 Stream Mode 无服务端 messageId 返回(POST webhook 是 sync reply),
    // 用 caller 提供 conversationID 作为 caller-side correlation key
    return conversationID;
  }

  /**
   * UpdateMessage 在钉钉 Stream Mode 下语义 = reply with new content。
   *
   * @param conversationID 钉钉会话 ID
   * @param messageID 原消息 msgId(保留作 caller 一致性,SDK 不直接支持 update)
   * @param newText 新文本
   */
  async updateMessage(
    conversationID: string,
    messageID: string,
    newText: string,
  ): Promise<void> {
    if (!conversationID) {
      throw new Error("dingtalk: empty conversationID");
    }
    if (!messageID) {
      throw new Error("dingtalk: empty messageID");
    }
    if (!newText) {
      throw new Error("dingtalk: empty newText");
    }
    // 复用 PostMessage(reply with new content);messageID 仅作 caller-side 关联
    await this.postMessage(conversationID, newText);
  }

  /** 已注册的 handler(供测试直接 invoke)。 */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }

  /** 缓存 sessionWebhook(conversationID → URL)。 */
  private cacheWebhook(conversationID: string, webhook: string): void {
    this.webhooks.set(conversationID, webhook);
  }
}

/** 用 appKey + appSecret + robotCode + builder 创建 Dingtalk bot。 */
export function newDingtalkBot(
  appKey: string,
  appSecret: string,
  robotCode: string,
  builder: BotBuilder,
): DingtalkBot {
  return new DingtalkBot(appKey, appSecret, robotCode, builder);
}