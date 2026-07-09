/**
 * bot.email — Email (IMAP/SMTP) Bot SDK 集成(W6.2 Stage 1 native SDK)
 *
 * 实现 imap (node-imap) + nodemailer 真 SDK Promise API:
 *   - start()   imap.connect() + openBox(INBOX) + listen 'mail' event
 *   - stop()    imap.end() (close connection)
 *   - fetchMessage(imap.fetch promise wrapper) → 转 IncomingMessage → handler
 *   - postMessage(to, subject, body) → nodemailer SMTP 发件
 *
 * 设计要点(per wau-go-sdk/bot/email + wau-channel
 * internal/adapter/email/email_real.go):
 *   - 收件:node-imap 的 'mail' event 触发 fetch + 解析
 *     (per Go 的 idleLoop → fetchNew pattern,但用回调替代 goroutine)
 *   - 发件:nodemailer SMTP(0 门槛 UX:用 sendMail Promise wrapper)
 *   - 邮件 thread 单向性保留:Message-ID → ChannelID / From → UserID
 *
 * 注:node-imap 用 EventEmitter + callback API,我们 wrap 成 Promise。
 *
 * W6 (2026-07-09) W6.2 Stage 1 任务。
 */

// imap is CJS module with module.exports = Connection; use require() to bypass
// ES module import restriction. Typed via @types/imap.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ImapCtor = require("imap") as { new (config: unknown): ImapType };
import type Imap = require("imap");
import nodemailer, { Transporter } from "nodemailer";

// 类型别名(@types/imap 把所有类型挂在 namespace Connection 上)
type ImapType = InstanceType<typeof Imap>;
type ImapMsgType = Imap.ImapMessage;
type ImapBox = Imap.Box;
import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/** Email 邮件字段(per wau-go-sdk/bot/email/email.go)。 */
interface EmailFields {
  messageId: string;
  subject: string;
  from: string;
  fromName: string;
  to: string;
  text: string;
  date: Date;
}

/**
 * EmailBot — Email Bot SDK 真集成(node-imap + nodemailer)。
 *
 * 字段对齐 wau-go-sdk/bot/email/email.go:28-38 EmailBot 字段。
 * Email Bot 用 IMAP 拉收 + SMTP 发送,故构造器收 IMAP 与 SMTP 两套 creds。
 */
export class EmailBot implements Bot {
  public imapHost: string;
  public imapUser: string;
  public imapPassword: string;
  public smtpHost: string;
  public smtpUser: string;
  public smtpPassword: string;
  public tenant: string;
  public universe: string;
  public handler: MessageHandler | null;

  // --- 内部状态(imap + nodemailer) ---
  private imap: ImapType | null;
  private transporter: Transporter | null;
  private fromAddress: string;
  private mailbox: string;
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null;
  private lastUid: number;
  private running: boolean;

  constructor(
    imapHost: string,
    imapUser: string,
    imapPassword: string,
    smtpHost: string,
    smtpUser: string,
    smtpPassword: string,
    builder: BotBuilder,
  ) {
    this.imapHost = imapHost;
    this.imapUser = imapUser;
    this.imapPassword = imapPassword;
    this.smtpHost = smtpHost;
    this.smtpUser = smtpUser;
    this.smtpPassword = smtpPassword;
    this.tenant = builder.tenantId();
    this.universe = builder.universe();
    this.handler = builder.handler();
    this.imap = null;
    this.transporter = null;
    this.fromAddress = smtpUser;
    this.mailbox = "INBOX";
    this.pollIntervalMs = 30_000; // 30s 轮询 (per 0 门槛 UX;Stage 2 IDLE 升级)
    this.pollTimer = null;
    this.lastUid = 0;
    this.running = false;
  }

  /**
   * 启动 IMAP 收件 + SMTP transporter。
   *
   * 步骤:
   *  1. 校验 host/user/password 非空
   *  2. 构造 imap Connection + transporter
   *  3. imap.once('ready') → openBox(INBOX) → 记 lastUid = uidnext-1(只收新邮件)
   *  4. imap.on('mail', fetchNew) 监听新邮件 + 起轮询 fallback
   *  5. 第一次 ready 后 resolve(让 caller 知道 start 完成)
   *
   * 注:node-imap 无原生 IDLE promise 包装,Stage 1 用 'mail' event + 30s 轮询兜底。
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    if (!this.imapHost || !this.imapUser || !this.imapPassword) {
      throw new Error("email: empty IMAP credentials");
    }
    if (!this.smtpHost || !this.smtpUser || !this.smtpPassword) {
      throw new Error("email: empty SMTP credentials");
    }

    // 1. 构造 SMTP transporter(nodemailer)
    this.transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: 587, // STARTTLS 默认;per 0 门槛 UX 简化
      secure: false,
      auth: {
        user: this.smtpUser,
        pass: this.smtpPassword,
      },
    });

    // 2. 构造 IMAP connection
    this.imap = new ImapCtor({
      user: this.imapUser,
      password: this.imapPassword,
      host: this.imapHost,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }, // 0 门槛 UX:自签证书不拒
      keepalive: true,
    });

    // 3. 等 ready + openBox(INBOX)
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.imap?.off("ready", onReady);
        reject(err);
      };
      const onReady = () => {
        this.imap?.off("error", onError);
        this.openBox()
          .then(() => resolve())
          .catch((err) => reject(err));
      };
      this.imap?.once("ready", onReady);
      this.imap?.once("error", onError);
      try {
        this.imap?.connect();
      } catch (err) {
        reject(err);
      }
    });

    // 4. 监听 'mail' 事件(新邮件到达)+ 轮询兜底
    this.imap.on("mail", () => {
      this.fetchNewEmails().catch((err) => {
        console.error("[email] fetchNewEmails error:", err);
      });
    });
    this.imap.on("error", (err: Error) => {
      console.error("[email] IMAP error:", err);
    });
    this.imap.on("end", () => {
      console.log("[email] IMAP connection ended");
      this.running = false;
    });

    // 5. 起轮询兜底(per wau-go-sdk 模式:即使 'mail' event 漏触发也 OK)
    this.pollTimer = setInterval(() => {
      if (this.running) {
        this.fetchNewEmails().catch((err) => {
          console.error("[email] poll fetchNewEmails error:", err);
        });
      }
    }, this.pollIntervalMs);

    this.running = true;
  }

  /**
   * 优雅停止 IMAP connection + SMTP transporter。
   *
   * 幂等 — 重复调用安全。
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.imap) {
      try {
        this.imap.end();
      } catch (err) {
        console.error("[email] imap.end error:", err);
      }
      this.imap = null;
    }
    if (this.transporter) {
      try {
        this.transporter.close();
      } catch (err) {
        console.error("[email] transporter.close error:", err);
      }
      this.transporter = null;
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
   * SendMessage 通过 nodemailer SMTP 发邮件。
   *
   * @param to 收件人邮箱地址
   * @param subject 邮件主题
   * @param body 邮件正文(text/plain)
   * @param inReplyTo 可选:原邮件 Message-ID(维持 thread 链路)
   */
  async sendMessage(
    to: string,
    subject: string,
    body: string,
    inReplyTo?: string,
  ): Promise<string> {
    if (!this.transporter) {
      throw new Error("email: transporter not opened (call start first)");
    }
    if (!to) {
      throw new Error("email: empty recipient");
    }
    let finalSubject = subject || "(no subject)";
    const headers: Record<string, string> = {};
    if (inReplyTo) {
      if (!finalSubject.toLowerCase().startsWith("re:")) {
        finalSubject = `Re: ${finalSubject}`;
      }
      headers["In-Reply-To"] = inReplyTo;
      headers["References"] = inReplyTo;
    }
    const info = await this.transporter.sendMail({
      from: this.fromAddress,
      to,
      subject: finalSubject,
      text: body,
      headers,
    });
    // nodemailer 返回 messageId(per SMTP server);用作 caller correlation key
    return info.messageId ?? "";
  }

  /**
   * postMessage 简化入口(text-only,per Bot interface 5-method 签名约定)。
   *
   * 注:Email 与 chat platform 不同,需 to/subject/body 三段。
   * 这里把 text 同时放到 subject + body(0 门槛 UX,Stage 2 让 caller 提供 subject)。
   */
  async postMessage(channelID: string, text: string): Promise<string> {
    // channelID 即 to(email address)
    return this.sendMessage(channelID, text, text);
  }

  /**
   * updateMessage 在 Email 语义下 = reply with new body(In-Reply-To 原 Message-ID)。
   *
   * @param channelID 收件人邮箱
   * @param messageID 原邮件 Message-ID
   * @param newText 新正文
   */
  async updateMessage(
    channelID: string,
    messageID: string,
    newText: string,
  ): Promise<void> {
    await this.sendMessage(channelID, "", newText, messageID);
  }

  /** 已注册的 handler(供测试直接 invoke)。 */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }

  // --- 内部 helpers ---

  /** openBox(INBOX) → resolve(记录 lastUid = uidnext-1,只收新邮件)。 */
  private openBox(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.imap) {
        reject(new Error("email: imap not connected"));
        return;
      }
      this.imap.openBox(this.mailbox, false, (err: Error, box: ImapBox) => {
        if (err) {
          reject(err);
          return;
        }
        // uidnext 是下一封新邮件的 UID;lastUid = uidnext - 1 表示"已处理到 uidnext-1"
        this.lastUid = (box?.uidnext ?? 1) - 1;
        resolve();
      });
    });
  }

  /** 拉新邮件 + parse + invoke handler。 */
  private fetchNewEmails(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.imap || !this.running) {
        resolve();
        return;
      }
      // 搜索 UID > lastUid 的新邮件
      this.imap.search([["UID", `${this.lastUid + 1}:*`]], (err: Error, uids: number[]) => {
        if (err) {
          reject(err);
          return;
        }
        if (!uids || uids.length === 0) {
          resolve();
          return;
        }
        // 取最大 UID 作下次起点
        const maxUid = Math.max(...uids);
        const f = this.imap!.fetch(uids, {
          bodies: "HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID DATE)",
          struct: false,
          envelope: true,
          markSeen: false,
        });
        const messages: EmailFields[] = [];
        f.on("message", (msg: ImapMsgType, _seqno: number) => {
          let buffer = "";
          let attrs: { uid?: number } | null = null;
          msg.on("body", (stream: NodeJS.ReadableStream) => {
            stream.on("data", (chunk: Buffer) => {
              buffer += chunk.toString("utf8");
            });
            stream.on("end", () => {
              const parsed = parseEmailHeaders(buffer);
              messages.push({
                messageId: parsed.messageId,
                subject: parsed.subject,
                from: parsed.from,
                fromName: parsed.fromName,
                to: parsed.to,
                text: parsed.subject, // 简化:用 subject 当 text 走 handler(per Go pattern)
                date: parsed.date,
              });
            });
          });
          msg.on("attributes", (a: { uid?: number }) => {
            attrs = a;
          });
          msg.once("end", () => {
            // 更新 lastUid
            if (attrs?.uid && attrs.uid > this.lastUid) {
              this.lastUid = attrs.uid;
            }
          });
        });
        f.once("error", (err: Error) => {
          reject(err);
        });
        f.once("end", () => {
          // 全部解析完 → invoke handler
          for (const m of messages) {
            const incoming: IncomingMessage = {
              platformMsgId: m.messageId || `${this.lastUid}`,
              channelId: m.messageId, // 邮件 thread 单向性:Message-ID 用作 channel
              userId: m.from,
              username: m.fromName || m.from,
              text: m.text,
              attachments: [],
              replyTo: "",
              timestamp: m.date,
            };
            try {
              this.invokeHandler(incoming);
            } catch (err) {
              console.error("[email] handler error:", err);
            }
          }
          this.lastUid = Math.max(this.lastUid, maxUid);
          resolve();
        });
      });
    });
  }
}

// --- 头部解析 helpers(0 门槛 UX:简单 regex,不引 mailparser dep) ---

interface ParsedHeaders {
  messageId: string;
  subject: string;
  from: string;
  fromName: string;
  to: string;
  date: Date;
}

/** 从 IMAP HEADER.FIELDS 抓的 raw buffer 解析 5 字段。 */
function parseEmailHeaders(raw: string): ParsedHeaders {
  const get = (name: string): string => {
    const re = new RegExp(`^${name}:\\s*(.+(?:\\n[ \\t].+)*)`, "im");
    const m = raw.match(re);
    if (!m) return "";
    return m[1].replace(/\n[ \t]+/g, " ").trim();
  };
  const fromRaw = get("From");
  const fromMatch = fromRaw.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>/);
  return {
    messageId: get("Message-ID").replace(/^<|>$/g, ""),
    subject: get("Subject"),
    from: fromMatch ? fromMatch[2].trim() : fromRaw,
    fromName: fromMatch ? (fromMatch[1] ?? "").trim() : "",
    to: get("To"),
    date: new Date(get("Date") || Date.now()),
  };
}

/** 用 IMAP/SMTP creds + builder 创建 Email bot。 */
export function newEmailBot(
  imapHost: string,
  imapUser: string,
  imapPassword: string,
  smtpHost: string,
  smtpUser: string,
  smtpPassword: string,
  builder: BotBuilder,
): EmailBot {
  return new EmailBot(
    imapHost,
    imapUser,
    imapPassword,
    smtpHost,
    smtpUser,
    smtpPassword,
    builder,
  );
}