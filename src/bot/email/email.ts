/**
 * bot.email — Email (IMAP/SMTP) Bot SDK 集成(stub,Stage 0 脚手架)
 *
 * Stage 0 脚手架:EmailBot stub + 编译期 interface 断言。
 * Stage 1 M1 子项 11 实装 imap (node-imap) 拉收 + nodemailer 发件。
 *
 * W5 (2026-07-13) OSS-onboarding closure:4 SDK 5 平台 bot/ 完整 SDK 端实现。
 * 公共 Bot interface 沿用 M10 N1 拍板(start/stop/onMessage/withTenant/withUniverse)。
 * 注册走 wau-edge POST /v1/bots/{bot_id}/messages(per M10 N3)。
 */

import type { Bot, MessageHandler } from "../common/bot";
import { BotBuilder } from "../common/options";
import type { IncomingMessage, OutgoingMessage } from "../common/message";

/**
 * EmailBot stub
 *
 * 对齐 wau-go-sdk/bot/email/email.go:28-38 EmailBot 字段。
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
  }

  /** 启动 bot(stub)。Stage 1 实装:imap ImapSimple 拉收 + nodemailer SMTP 发件。 */
  async start(): Promise<void> {
    // TODO(stage1-m1): import imap (node-imap) + nodemailer,IDLE 监听 + SMTP 发送
  }

  /** 优雅停止(stub) */
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

  /** 已注册的 handler(供测试直接 invoke) */
  invokeHandler(msg: IncomingMessage): OutgoingMessage {
    if (!this.handler) {
      return { text: "", attachments: [], replyTo: "" };
    }
    return this.handler(msg);
  }
}

/** 用 IMAP/SMTP creds + builder 创建 Email bot(stub)。对齐 Go/Python 的 New()。 */
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