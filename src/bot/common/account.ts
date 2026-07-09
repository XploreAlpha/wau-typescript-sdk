/**
 * bot.common.account — Account / BotRegistry 公共 DTO (per M10 / D82=A)
 *
 * 公开 bot id 格式:"bot:<tenant>:<botid>"
 * 例:tenant=acme, botID=weather-cn → publicBotId="bot:acme:weather-cn"
 *
 * 4 SDK 必须保持字段名 + 类型 100% 一致 (per D13 拍板)。
 * wau-go-sdk/bot/common/account.go
 * wau-python-sdk/src/wau_sdk/bot/common/account.py
 * wau-rust-sdk/src/bot/common/account.rs
 * 必须随时保持同步,字段一字不差。
 *
 * v1.3.0 (W7.1, 2026-07-09) — 新加 botUuid (UUID v4, server-assigned)
 * per D78/D79/D80 拍板;D60 additive,0 改老字段。老 botId slug 语义不变。
 */

export interface Account {
  /** registry 服务端分配的 UUID(空 = 待注册) */
  accountId: string;

  /** 多租户 ID(必填,例 "acme") */
  tenantId: string;

  /** 本地名 / slug(必填,例 "weather-cn"),tenant 内唯一 */
  botId: string;

  /** 服务端分配的 UUID v4(per D78,per tenant 全局唯一)。
   *  与 botId slug 不同:botId = human-readable client-supplied,botUuid = machine-friendly server-assigned。
   *  用途:wau-edge route 寻址 / wau-channel 8 平台 adapter 寻址 / D79 JWT 4 claims 之一。
   *  Register 响应返回(服务端决定,不接受 client 上传)。undefined = 老 SDK v1.2.0 兼容降级路径。*/
  botUuid?: string;

  /** 全局公开 ID = "bot:<tenant>:<botid>" (D82=A 服务端回填校验) */
  publicBotId: string;

  /** 注册人 user_id(C 端 或 B 端 owner) */
  ownerUserId: string;

  /** IM 平台类型 "telegram"|"discord"|"slack"|"feishu"|"dingtalk"|"qq"|"email"|"webhook" */
  channelType: string;

  /** wau-channel 内的 config ID (platform credentials 索引) */
  channelConfigId: string;

  /** UTC timestamp (服务端回填,客户端只读) */
  createdAt: Date;
  updatedAt: Date;
}

/** 纯函数:tenant + bot → publicBotId (D82=A) */
export function publicBotIdOf(tenantId: string, botId: string): string {
  return `bot:${tenantId}:${botId}`;
}

/** 工厂:构造 Account 并填充 publicBotId + 时间戳 */
export function newAccount(
  tenantId: string,
  botId: string,
  ownerUserId: string,
  channelType: string,
  channelConfigId: string,
): Account {
  const now = new Date();
  return {
    accountId: "", // server-assigned
    tenantId,
    botId,
    publicBotId: publicBotIdOf(tenantId, botId),
    ownerUserId,
    channelType,
    channelConfigId,
    createdAt: now,
    updatedAt: now,
  };
}

export interface RegisterBotRequest {
  tenantId: string;
  botId: string;
  /** v1.3.0 (W7.1, D78) — 可选,server-assigned。不传 = 老 SDK v1.2.0 兼容路径,server 自动从 botId slug 寻址并生成。*/
  botUuid?: string;
  ownerUserId: string;
  channelType: string;
  channelConfigId: string;
}

export interface UpdateBotRequest {
  ownerUserId?: string;
  channelType?: string;
  channelConfigId?: string;
}

export interface ListBotsFilter {
  tenantId?: string;
  ownerUserId?: string;
  channelType?: string;
  limit?: number;
}
