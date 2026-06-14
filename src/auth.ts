/**
 * HS256 鉴权 — 对齐 wau-a2a-gateway + wau-go-sdk auth.go + wau-python-sdk _auth.py
 *
 * JWT 结构:
 * {
 *   "agent": "my-agent",
 *   "role":  "trusted_agent",
 *   "iat":   1718342400,
 *   "exp":   1718342700,    # iat + 300s (5 min)
 *   "jti":   "uuid-v4"
 * }
 */

import * as jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { AuthConfig, Role } from "./options";

/**
 * HS256 JWT 签发器(对齐 wau-go-sdk signer + wau-python-sdk Signer)
 */
export class Signer {
  private readonly secret: Buffer;
  private readonly agentName: string;
  private readonly role: Role;

  constructor(auth: AuthConfig) {
    if (!auth.sharedSecret) {
      throw new Error("wau: auth.sharedSecret is required for HS256");
    }
    if (!auth.agentName) {
      throw new Error("wau: auth.agentName is required");
    }
    this.secret = Buffer.isBuffer(auth.sharedSecret)
      ? auth.sharedSecret
      : Buffer.from(auth.sharedSecret);
    this.agentName = auth.agentName;
    this.role = auth.role;
  }

  get role$(): Role {
    return this.role;
  }

  /**
   * 签一个新 JWT
   * @param ttlSeconds 过期秒数(默认 300 = 5 min)
   * @returns 编码后的 JWT 字符串
   */
  sign(ttlSeconds: number = 300): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      agent: this.agentName,
      role: this.role,
      iat: now,
      exp: now + ttlSeconds,
      jti: randomUUID(),
    };
    return jwt.sign(payload, this.secret, { algorithm: "HS256" });
  }
}
