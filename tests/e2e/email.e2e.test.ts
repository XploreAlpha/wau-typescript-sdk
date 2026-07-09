/**
 * W7.2 e2e — EmailBot postMessage mock e2e (D60 additive, 2026-07-09)
 *
 * 3 cases 镜像 wau-channel/internal/adapter/email/email_real_test.go:
 *   1. success: fake transporter.sendMail → {messageId:'msg-001'}
 *   2. APIErr:  fake transporter.sendMail throw SMTP error
 *   3. auth_fail: fake transporter.sendMail throw SMTP auth error (EAUTH / 535)
 *
 * 关键设计:
 *   - 跳过 start() 的 IMAP connect + SMTP createTransport,直接注入 transporter 字段
 *     (TypeScript private 仅编译期,RUNTIME 仍可写),避免真连 imap/smtp server
 *   - EmailBot 内部 postMessage → sendMessage → transporter.sendMail()
 *   - 注入 fake transporter(用 vi.fn() 替 sendMail),可控制 success / error / auth fail
 *   - nock.disableNetConnect() 防止 nodemailer 漏到真网络(但我们用 fake transporter,无网络)
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import nock from "nock";
import { EmailBot } from "../../src/bot/email/email";
import { newBuilder } from "../../src/bot/common";

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
  vi.restoreAllMocks();
});

/**
 * 构造 EmailBot 并注入 fake transporter(skip start() 的 IMAP connect + SMTP create)。
 * sendMailFn 由 caller 提供,以控制 success / APIErr / auth_fail 行为。
 */
function makeEmailBot(sendMailFn: any): EmailBot {
  const bot = new EmailBot(
    "imap.test.local", // imapHost
    "user@test.local", // imapUser
    "imap-pass-fake", // imapPassword
    "smtp.test.local", // smtpHost
    "user@test.local", // smtpUser
    "smtp-pass-fake", // smtpPassword
    newBuilder()
  );
  // 注入 fake transporter(nodemailer transporter 兼容 sendMail)
  (bot as any).transporter = {
    sendMail: sendMailFn,
    close: () => {},
  };
  return bot;
}

describe("email e2e (D60)", () => {
  // -------- Case 1: success --------
  it("email success", async () => {
    const sendMailMock = vi.fn(async (opts: any) => {
      // 验证 nodemailer 收到的 options
      expect(opts.from).toBe("user@test.local");
      expect(opts.to).toBe("recipient@example.com");
      // postMessage 把 text 同时放到 subject + body(per SDK 设计)
      expect(opts.subject).toBe("hello email");
      expect(opts.text).toBe("hello email");
      return { messageId: "<msg-001@test.local>" };
    });

    const bot = makeEmailBot(sendMailMock);
    const msgId = await bot.postMessage("recipient@example.com", "hello email");

    expect(msgId).toBe("<msg-001@test.local>");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  // -------- Case 2: APIErr --------
  it("email APIErr", async () => {
    const sendMailMock = vi.fn(async (_opts: any) => {
      // 模拟 SMTP server 错误(per nodemailer 错误语义)
      const err: any = new Error("SMTP server error: 550 Mailbox unavailable");
      err.code = "EENVELOPE";
      err.responseCode = 550;
      throw err;
    });

    const bot = makeEmailBot(sendMailMock);
    let caught: Error | null = null;
    try {
      await bot.postMessage("bad@example.com", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/550|Mailbox unavailable/);
    // 验证 no retry — 只调了一次 sendMail
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  // -------- Case 3: auth_fail --------
  it("email auth_fail", async () => {
    const sendMailMock = vi.fn(async (_opts: any) => {
      // 模拟 SMTP auth 错误(per nodemailer EAUTH 语义)
      const err: any = new Error("Invalid login: 535 Authentication failed");
      err.code = "EAUTH";
      err.responseCode = 535;
      throw err;
    });

    const bot = makeEmailBot(sendMailMock);
    let caught: Error | null = null;
    try {
      await bot.postMessage("recipient@example.com", "hi");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/535|Authentication failed|EAUTH/);
    // 验证 no retry
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
