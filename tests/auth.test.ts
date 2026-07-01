/**
 * Auth 单测 — HS256 JWT 签发 + exp + jti 唯一性
 *
 * Stage 3.1 #1 修复(2026-07-01):tenant_id 必填 + subject 兜底 + sign 含 2 claim
 * (per [[project-v0-9-0-blocker-fix-1-plus-2-2026-07-01]])
 *
 * 对齐 wau-go-sdk auth_test.go + wau-python-sdk tests/test_auth.py
 */

import { describe, it, expect } from "vitest";
import * as jwt from "jsonwebtoken";
import { Signer } from "../src/auth";
import { AuthConfig, Role } from "../src/options";

const TEST_SECRET = "test-secret-32-bytes-long-xxxxx";

// authBuilder 统一构造测试 AuthConfig,避免每个 case 重复 tenantId 字段。
// 注意:tenantId 是必填(per Stage 3.1 #1 修复),空字符串会被 Signer 拒。
function authBuilder(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    agentName: "test",
    tenantId: "test-tenant",
    role: Role.EXTERNAL_AGENT,
    sharedSecret: TEST_SECRET,
    ...overrides,
  };
}

describe("Signer 构造校验", () => {
  it("空 sharedSecret 抛错", () => {
    expect(() => new Signer(authBuilder({ sharedSecret: "" }))).toThrow(/sharedSecret/);
  });

  it("空 agentName 抛错", () => {
    expect(() => new Signer(authBuilder({ agentName: "" }))).toThrow(/agentName/);
  });

  // Stage 3.1 #1 新增(2026-07-01)
  //
  // wau-edge Claims 必填 tenant_id(per wau-edge/internal/auth/jwt.go:96-98)。
  // SDK 必须强制租户非空,否则下游永远 401。
  it("空 tenantId 抛错", () => {
    expect(() => new Signer(authBuilder({ tenantId: "" }))).toThrow(/tenantId/);
  });
});

describe("Signer 默认值", () => {
  it("默认 role = external_agent", () => {
    const s = new Signer(authBuilder());
    expect(s.role$).toBe(Role.EXTERNAL_AGENT);
  });

  it("自定义 role", () => {
    const s = new Signer(authBuilder({ agentName: "kernel", role: Role.KERNEL_CORE }));
    expect(s.role$).toBe(Role.KERNEL_CORE);
  });
});

describe("Signer Subject 兜底", () => {
  // Stage 3.1 #1 新增
  it("Subject 空时兜底用 agentName", () => {
    const s = new Signer(authBuilder({ agentName: "my-agent" }));
    // 通过 sign() 拿到 JWT 验(内部字段不直接暴露)
    const tok = s.sign();
    const decoded = jwt.decode(tok) as jwt.JwtPayload;
    expect(decoded.sub).toBe("my-agent");
  });

  // Stage 3.1 #1 新增
  it("Subject 显式时用之", () => {
    const s = new Signer(authBuilder({ agentName: "agent-x", subject: "user-y" }));
    const tok = s.sign();
    const decoded = jwt.decode(tok) as jwt.JwtPayload;
    expect(decoded.sub).toBe("user-y");
  });
});

describe("Signer.sign() JWT 结构", () => {
  it("返回 3 段 JWT", () => {
    const s = new Signer(authBuilder());
    const tok = s.sign();
    expect(tok.split(".").length).toBe(3);
  });

  // Stage 3.1 #1 扩展(2026-07-01):加 sub / tenant_id 校验
  it("JWT 含 agent/role/sub/tenant_id/iat/exp/jti 7 字段", () => {
    const s = new Signer(
      authBuilder({ agentName: "test-agent", tenantId: "tenant-42", subject: "user-7" })
    );
    const tok = s.sign();
    const decoded = jwt.decode(tok) as jwt.JwtPayload;
    for (const k of ["agent", "role", "sub", "tenant_id", "iat", "exp", "jti"]) {
      expect(decoded).toHaveProperty(k);
    }
    expect(decoded.agent).toBe("test-agent");
    expect(decoded.tenant_id).toBe("tenant-42");
    expect(decoded.sub).toBe("user-7");
  });

  it("默认 5 分钟过期", () => {
    const s = new Signer(authBuilder());
    const tok = s.sign();
    const decoded = jwt.decode(tok) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(300);
  });

  it("自定义 ttl", () => {
    const s = new Signer(authBuilder());
    const tok = s.sign(60);
    const decoded = jwt.decode(tok) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(60);
  });

  it("JTI 唯一性 100 次", () => {
    const s = new Signer(authBuilder());
    const jtis = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const tok = s.sign();
      const decoded = jwt.decode(tok) as jwt.JwtPayload;
      expect(jtis.has(decoded.jti!)).toBe(false);
      jtis.add(decoded.jti!);
    }
  });

  it("alg = HS256", () => {
    const s = new Signer(authBuilder());
    const tok = s.sign();
    const decoded = jwt.decode(tok, { complete: true });
    expect(decoded?.header.alg).toBe("HS256");
    expect(decoded?.header.typ).toBe("JWT");
  });
});
