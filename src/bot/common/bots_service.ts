/**
 * bot.common.bots_service — BotsService 公共 interface (per M10 N1 / D82=A)
 *
 * 4 SDK 必须保持签名 100% 一致 (per D13):
 *   - register(req): Promise<Account>
 *   - get(publicBotId): Promise<Account>
 *   - update(publicBotId, req): Promise<Account>
 *   - list(filter): Promise<Account[]>
 *   - delete(publicBotId): Promise<void>
 */

import type {
  Account,
  ListBotsFilter,
  RegisterBotRequest,
  UpdateBotRequest,
} from "./account";

export interface BotsService {
  /** 注册新 bot。服务端分配 accountId + 时间戳,客户端不传。 */
  register(req: RegisterBotRequest): Promise<Account>;

  /** 按公开 ID 获取 bot 信息。bot 不存在 → throw BotNotFoundError。 */
  get(publicBotId: string): Promise<Account>;

  /** 更新 bot 可变字段。bot 不存在 → throw BotNotFoundError。 */
  update(publicBotId: string, req: UpdateBotRequest): Promise<Account>;

  /** 按 filter 列出 bot(per B 端 RBAC)。 */
  list(filter?: ListBotsFilter): Promise<Account[]>;

  /** 按公开 ID 注销 bot。bot 不存在 → throw BotNotFoundError。 */
  delete(publicBotId: string): Promise<void>;
}

/** sentinel error types(实现方 throw 时保留类型) */
export class BotNotFoundError extends Error {
  constructor(publicBotId: string) {
    super(`bot not found: ${publicBotId}`);
    this.name = "BotNotFoundError";
  }
}

export class BotAlreadyExistsError extends Error {
  constructor(publicBotId: string) {
    super(`bot already exists: ${publicBotId}`);
    this.name = "BotAlreadyExistsError";
  }
}
