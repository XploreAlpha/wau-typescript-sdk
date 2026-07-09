/**
 * bot.qq — QQ Bot SDK 集成(W6.2 Stage 1 native SDK fallback)
 *
 * 官方 TS SDK 暂缺,fallback 实现:axios + QQ OpenAPI v2 自实现 WebSocket。
 *
 * 设计要点(per W6 拍板):
 *   - HTTP API:axios 调 QQ 开放平台 OpenAPI v2
 *     - getAccessToken POST /app/getAppAccessToken
 *     - sendMessage  POST /v2/channels/{channel_id}/messages
 *     - patchMessage PATCH /v2/channels/{channel_id}/messages/{message_id}
 *   - WSS Gateway:用 `ws` 包 dial api.sgroup.qq.com/gateway/bot,
 *     实现 hello/heartbeat/dispatch/ack 4 类 opcode(per Discord-style gateway),
 *     不过这层 Stage 1 只做基础(WS connect + ping/pong + 转发 dispatch 到本地 events)
 *   - Promise API:全部 SDK 调用返回 Promise(替代 Go 的同步接口)
 *
 * 对齐 wau-go-sdk/bot/qq/qq_real.go:QQRealClient + wau-channel
 * internal/adapter/qq/qq_real.go 的语义(用 botgo SDK 等价的 OpenAPI 操作)。
 *
 * W6 (2026-07-09) W6.2 Stage 1 任务。
 */

import axios, { AxiosInstance } from "axios";
import WebSocket from "ws";
import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

// --- QQ OpenAPI v2 endpoints(per https://bot.q.qq.com/wiki/develop/api/) ---

const QQ_API_BASE = "https://api.sgroup.qq.com";
const QQ_AUTH_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_SANDBOX_API_BASE = "https://sandbox.api.sgroup.qq.com";

/** QQ Bot gateway opcode(per QQ WSS protocol)。 */
const QQ_OP_DISPATCH = 0;
const QQ_OP_HEARTBEAT = 1;
const QQ_OP_IDENTIFY = 2;
const QQ_OP_RECONNECT = 7;
const QQ_OP_INVALID_SESSION = 9;
const QQ_OP_HELLO = 10;
const QQ_OP_HEARTBEAT_ACK = 11;

/** QQ Bot dispatch event type(per QQ 开放平台)。 */
const QQ_EVENT_MESSAGE_CREATE = "MESSAGE_CREATE";
const QQ_EVENT_AT_MESSAGE_CREATE = "AT_MESSAGE_CREATE";
const QQ_EVENT_GROUP_AT_MESSAGE_CREATE = "GROUP_AT_MESSAGE_CREATE";
const QQ_EVENT_C2C_MESSAGE_CREATE = "C2C_MESSAGE_CREATE";

/** Incoming event 内部归一化结构。 */
interface QQEventPayload {
  type: string;
  messageId: string;
  channelId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

/**
 * QQBot — QQ Bot 自实现(axios + OpenAPI v2 + ws 自实现 WebSocket)。
 *
 * 字段对齐 wau-go-sdk/bot/qq/qq.go:28-38 QQBot 字段。
 * QQ 频道 Bot 用 AppID + AppSecret (client credentials) + 频道鉴权。
 */
export class QQBot implements Bot {
  public appId: string;
  public appSecret: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  // --- 内部状态 ---
  private httpClient: AxiosInstance;
  private ws: WebSocket | null;
  private accessToken: string | null;
  private tokenExpiresAt: number; // unix sec
  private events: QQEventPayload[];
  private eventsResolve: ((v: QQEventPayload | null) => void) | null;
  private heartbeatTimer: NodeJS.Timeout | null;
  private heartbeatIntervalMs: number;
  private running: boolean;
  private sandbox: boolean;

  constructor(appId: string, appSecret: string, builder: BotBuilder) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
    this.httpClient = axios.create({
      baseURL: QQ_API_BASE,
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });
    this.ws = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.events = [];
    this.eventsResolve = null;
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = 30_000;
    this.running = false;
    this.sandbox = false;
  }

  /**
   * 启动 QQ WSS Gateway 长连接。
   *
   * 步骤:
   *  1. 校验 appId + appSecret 非空
   *  2. 拉 access_token(POST bots.qq.com/app/getAppAccessToken)
   *  3. dial wss://api.sgroup.qq.com/gateway/bot(Bot 鉴权 header)
   *  4. 处理 hello(10) → identify(2) → start heartbeat(1) → 收 dispatch(0)
   *  5. 后台 goroutine 等价:每条 dispatch message event 推本地 events 队列
   *
   * 注:per QQ WSS protocol,完整 reconnect/resume sequence 在 Stage 1 简化。
   *     Stage 2 e2e 用 httptest mock + reconnect 测试覆盖。
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.appId || !this.appSecret) {
      throw new Error("qq: empty appId or appSecret");
    }

    // 1. 拉 access_token(per QQ 开放平台 OAuth2 client credentials)
    await this.refreshAccessToken();

    // 2. dial WSS Gateway(Bot 鉴权 header:Authorization Bot <token>)
    const wsUrl = `${this.sandbox ? QQ_SANDBOX_API_BASE : QQ_API_BASE}/gateway/bot`.replace(
      "https://",
      "wss://",
    );
    this.ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bot ${this.accessToken}` },
      handshakeTimeout: 10_000,
    });

    this.ws.on("open", () => {
      console.log("[qq] WSS gateway connected");
    });

    // 3. 收 server message:处理 hello → identify;其他转发到 eventLoop
    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(raw.toString());
        if (!frame || typeof frame.op !== "number") {
          return;
        }
        switch (frame.op) {
          case QQ_OP_HELLO: {
            // hello(10):server 推 heartbeat_interval + session id 等
            // reply identify(2) + start heartbeat loop
            const intervalMs = (frame.d?.heartbeat_interval ?? 30000) as number;
            this.heartbeatIntervalMs = intervalMs;
            this.sendIdentify();
            this.startHeartbeatLoop();
            break;
          }
          case QQ_OP_HEARTBEAT_ACK: {
            // heartbeat_ack(11):server 确认收到 heartbeat,无 action
            break;
          }
          case QQ_OP_DISPATCH: {
            // dispatch(0):server 推业务事件,关注 4 类 message 事件
            const ev = frame.d ?? {};
            const evType = frame.t ?? "";
            if (
              evType === QQ_EVENT_MESSAGE_CREATE ||
              evType === QQ_EVENT_AT_MESSAGE_CREATE ||
              evType === QQ_EVENT_GROUP_AT_MESSAGE_CREATE ||
              evType === QQ_EVENT_C2C_MESSAGE_CREATE
            ) {
              const payload = this.parseDispatchEvent(evType, ev);
              if (payload) {
                this.dispatchEvent(payload);
              }
            }
            break;
          }
          case QQ_OP_RECONNECT: {
            // reconnect(7):server 要求 client 重连(Stage 1 简化:close 即可)
            console.warn("[qq] server requested reconnect, closing");
            this.ws?.close();
            break;
          }
          case QQ_OP_INVALID_SESSION: {
            console.warn("[qq] invalid session, closing");
            this.ws?.close();
            break;
          }
          default:
            // ignore 其他 opcode
            break;
        }
      } catch (err) {
        console.error("[qq] WSS message error:", err);
      }
    });

    this.ws.on("close", () => {
      console.log("[qq] WSS gateway closed");
      this.stopHeartbeatLoop();
      this.running = false;
      // wake up any pending next()
      if (this.eventsResolve) {
        const r = this.eventsResolve;
        this.eventsResolve = null;
        r(null);
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error("[qq] WSS error:", err);
    });

    // 等 WS open
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.ws?.off("error", onErr);
        resolve();
      };
      const onErr = (err: Error) => {
        this.ws?.off("open", onOpen);
        reject(err);
      };
      this.ws?.once("open", onOpen);
      this.ws?.once("error", onErr);
    });

    this.running = true;
  }

  /**
   * 优雅停止 WSS + 清理状态。
   *
   * 幂等 — 重复调用安全。
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.stopHeartbeatLoop();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        console.error("[qq] WS close error:", err);
      }
      this.ws = null;
    }
    // wake up any pending next()
    if (this.eventsResolve) {
      const r = this.eventsResolve;
      this.eventsResolve = null;
      r(null);
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
   * PostMessage 通过 OpenAPI v2 发送(POST /v2/channels/{channel_id}/messages)。
   *
   * @returns QQ message ID(用作 UpdateMessage 的 messageID)
   */
  async postMessage(channelID: string, text: string): Promise<string> {
    if (!this.accessToken) {
      throw new Error("qq: client not opened (call start first)");
    }
    if (!channelID) {
      throw new Error("qq: empty channelID");
    }
    if (!text) {
      throw new Error("qq: empty text");
    }
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
    const resp = await this.httpClient.post(
      `/v2/channels/${channelID}/messages`,
      { content: text, msg_type: 0 }, // 0 = text
      {
        baseURL: this.sandbox ? QQ_SANDBOX_API_BASE : QQ_API_BASE,
        headers: {
          Authorization: `QQBot ${this.accessToken}`,
        },
      },
    );
    const data = resp.data as { id?: string; message_id?: string };
    return data.message_id ?? data.id ?? "";
  }

  /**
   * UpdateMessage 通过 OpenAPI v2 编辑消息(PATCH /v2/channels/{channel_id}/messages/{message_id})。
   */
  async updateMessage(
    channelID: string,
    messageID: string,
    newText: string,
  ): Promise<void> {
    if (!this.accessToken) {
      throw new Error("qq: client not opened (call start first)");
    }
    if (!channelID || !messageID) {
      throw new Error("qq: empty channelID or messageID");
    }
    if (!newText) {
      throw new Error("qq: empty newText");
    }
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
    await this.httpClient.patch(
      `/v2/channels/${channelID}/messages/${messageID}`,
      { content: newText, msg_type: 0 },
      {
        baseURL: this.sandbox ? QQ_SANDBOX_API_BASE : QQ_API_BASE,
        headers: {
          Authorization: `QQBot ${this.accessToken}`,
        },
      },
    );
  }

  /** 已注册的 handler(供测试直接 invoke)。 */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }

  // --- 内部 helpers ---

  /** 拉 access_token(per QQ OAuth2 client credentials grant)。 */
  private async refreshAccessToken(): Promise<void> {
    try {
      const resp = await axios.post(
        QQ_AUTH_URL,
        { appId: this.appId, clientSecret: this.appSecret },
        { headers: { "Content-Type": "application/json" }, timeout: 10_000 },
      );
      const data = resp.data as {
        access_token?: string;
        expires_in?: number;
        token_type?: string;
      };
      if (!data.access_token) {
        throw new Error("qq: access_token missing in response");
      }
      this.accessToken = data.access_token;
      // expires_in 单位 sec;留 60s 余量
      this.tokenExpiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 7200) - 60;
    } catch (err) {
      throw new Error(`qq: refreshAccessToken failed: ${(err as Error).message}`);
    }
  }

  private isTokenExpired(): boolean {
    return Math.floor(Date.now() / 1000) >= this.tokenExpiresAt;
  }

  /** 发 identify frame(op=2)。 */
  private sendIdentify(): void {
    if (!this.ws || !this.accessToken) {
      return;
    }
    this.sendWsFrame({
      op: QQ_OP_IDENTIFY,
      d: {
        token: `Bot ${this.accessToken}`,
        intents: 0, // intents 字段对纯发文本不重要;Stage 1 用 0 = 无订阅
        shard: [0, 1],
      },
    });
  }

  /** 启 heartbeat 循环(op=1)。 */
  private startHeartbeatLoop(): void {
    this.stopHeartbeatLoop();
    this.heartbeatTimer = setInterval(() => {
      this.sendWsFrame({ op: QQ_OP_HEARTBEAT, d: null });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendWsFrame(frame: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  /** 解析 dispatch 事件为归一化 payload。 */
  private parseDispatchEvent(evType: string, d: any): QQEventPayload | null {
    if (!d) {
      return null;
    }
    // 频道:channelID;群:group_openid;C2C:openid(Stage 1 用 channelID 字段统一)
    const channelID = d.channel_id ?? d.group_openid ?? d.openid ?? "";
    return {
      type: evType,
      messageId: d.id ?? "",
      channelId: channelID,
      userId: d.author?.id ?? "",
      username: d.author?.username ?? "",
      text: typeof d.content === "string" ? d.content : JSON.stringify(d.content ?? ""),
      timestamp: typeof d.timestamp === "string" ? parseInt(d.timestamp, 10) : 0,
    };
  }

  /** 推入 events 队列 + 唤醒 pending waiter + 调 handler。 */
  private dispatchEvent(payload: QQEventPayload): void {
    if (this.eventsResolve) {
      const r = this.eventsResolve;
      this.eventsResolve = null;
      r(payload);
    } else {
      this.events.push(payload);
    }
    // invoke handler
    const incoming: IncomingMessage = {
      platformMsgId: payload.messageId,
      channelId: payload.channelId,
      userId: payload.userId,
      username: payload.username,
      text: payload.text,
      attachments: [],
      replyTo: "",
      timestamp: payload.timestamp ? new Date(payload.timestamp * 1000) : new Date(),
    };
    try {
      this.invokeHandler(incoming);
    } catch (err) {
      console.error("[qq] handler error:", err);
    }
  }
}

/** 用 appId + appSecret + builder 创建 QQ bot。 */
export function newQQBot(
  appId: string,
  appSecret: string,
  builder: BotBuilder,
): QQBot {
  return new QQBot(appId, appSecret, builder);
}