/**
 * v0.8.0 M3-2C Universe Labels 校验函数测试
 *
 * 跟 afp-protocol + wau-go-sdk universe_labels_test 语义对齐
 * 用 vitest 跑(per ts-sdk package.json scripts.test)
 */

import { describe, it, expect } from "vitest";
import { Agent, AgentRegisterRequest } from "../src/types.js";
import {
  RESERVED_UNIVERSE_LABEL_KEYS,
  isReservedLabelKey,
  validateUniverseLabels,
  logLabelsValidation,
  type LabelsValidationResult,
} from "../src/universe_labels.js";

// =============================================================================
// backward compat
// =============================================================================

describe("validateUniverseLabels backward compat", () => {
  it("undefined labels → OK, no warnings", () => {
    const r = validateUniverseLabels(undefined);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("null labels → OK, no warnings", () => {
    const r = validateUniverseLabels(null);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("empty Record → OK, no warnings", () => {
    const r = validateUniverseLabels({});
    expect(r.ok).toBe(true);
  });
});

// =============================================================================
// 6 reserved labels
// =============================================================================

describe("reserved labels 白名单", () => {
  it("region=cn-shanghai → OK (自由字符串)", () => {
    const r = validateUniverseLabels({ region: "cn-shanghai" });
    expect(r.warnings).toHaveLength(0);
  });

  it("gpu=true/false → OK", () => {
    expect(validateUniverseLabels({ gpu: "true" }).warnings).toHaveLength(0);
    expect(validateUniverseLabels({ gpu: "false" }).warnings).toHaveLength(0);
  });

  it("gpu=yes → warning (不在 enum)", () => {
    const r = validateUniverseLabels({ gpu: "yes" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/not in allowed values/);
  });

  it("tier=high-performance → OK", () => {
    expect(
      validateUniverseLabels({ tier: "high-performance" }).warnings
    ).toHaveLength(0);
  });

  it("tier=ultra → warning", () => {
    expect(validateUniverseLabels({ tier: "ultra" }).warnings).toHaveLength(1);
  });

  it("security_level=trusted → OK", () => {
    expect(
      validateUniverseLabels({ security_level: "trusted" }).warnings
    ).toHaveLength(0);
  });

  it("security_level=invalid → warning", () => {
    expect(
      validateUniverseLabels({ security_level: "invalid" }).warnings
    ).toHaveLength(1);
  });

  it("load=idle → OK", () => {
    expect(validateUniverseLabels({ load: "idle" }).warnings).toHaveLength(0);
  });

  it("universe_role=compute-pool → OK", () => {
    expect(
      validateUniverseLabels({ universe_role: "compute-pool" }).warnings
    ).toHaveLength(0);
  });

  it("reserved label 空 value → warning", () => {
    const r = validateUniverseLabels({ tier: "" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/empty value/);
  });
});

// =============================================================================
// 自由 labels 命名规范
// =============================================================================

describe("自由 labels", () => {
  it("snake_case 合法", () => {
    expect(
      validateUniverseLabels({ department: "healthcare" }).warnings
    ).toHaveLength(0);
  });

  it("kebab-case → warning + 建议 snake_case", () => {
    const r = validateUniverseLabels({ "cost-center": "eng-001" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/cost_center/);
  });

  it("camelCase → warning + 建议 snake_case", () => {
    const r = validateUniverseLabels({ myLabel: "value" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/my_label/);
  });

  it("空 value → warning", () => {
    const r = validateUniverseLabels({ department: "" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/empty value/);
  });
});

// =============================================================================
// 多 labels 组合
// =============================================================================

describe("多 labels 组合", () => {
  it("4 reserved 合法 → OK, no warnings", () => {
    const r = validateUniverseLabels({
      region: "cn-shanghai",
      gpu: "true",
      tier: "high-performance",
      load: "idle",
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("混合 3 warnings", () => {
    const r = validateUniverseLabels({
      region: "cn-shanghai",
      tier: "ultra",
      department: "rnd",
      "non-standard": "x",
      myCustomLabel: "y",
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(3);
  });
});

// =============================================================================
// 白名单常量完整性
// =============================================================================

describe("白名单常量", () => {
  it("RESERVED_UNIVERSE_LABEL_KEYS 含 6 key", () => {
    for (const k of [
      "region",
      "gpu",
      "tier",
      "security_level",
      "load",
      "universe_role",
    ]) {
      expect(RESERVED_UNIVERSE_LABEL_KEYS).toContain(k);
    }
  });

  it("isReservedLabelKey 正确", () => {
    expect(isReservedLabelKey("region")).toBe(true);
    expect(isReservedLabelKey("tier")).toBe(true);
    expect(isReservedLabelKey("department")).toBe(false);
    expect(isReservedLabelKey("myCustomLabel")).toBe(false);
  });
});

// =============================================================================
// Agent + AgentRegisterRequest class 集成
// =============================================================================

describe("Agent class universeLabels 字段", () => {
  it("老 client 不传 → undefined", () => {
    // Agent 构造函数: name, id, url, description, skills, universes, universeLabels, trust, status, lastSeen
    const a = new Agent("test");
    expect(a.universeLabels).toBeUndefined();
  });

  it("新 client 传 Record", () => {
    const a = new Agent(
      "test2",                                                  // name
      "",                                                       // id
      "",                                                       // url
      "",                                                       // description
      [],                                                       // skills
      [],                                                       // universes
      { region: "cn-shanghai", gpu: "true" }                    // universeLabels
    );
    expect(a.universeLabels?.["region"]).toBe("cn-shanghai");
    expect(a.universeLabels?.["gpu"]).toBe("true");
  });
});

describe("AgentRegisterRequest class universeLabels 字段", () => {
  it("可传 Record", () => {
    // AgentRegisterRequest 构造函数: name, url, description, skills, universes, universeLabels
    const req = new AgentRegisterRequest(
      "agent1",                              // name
      "https://example.com",                 // url
      "",                                    // description
      [],                                    // skills
      ["universe-a"],                        // universes
      { tier: "high-performance" }            // universeLabels
    );
    expect(req.universeLabels?.["tier"]).toBe("high-performance");
  });
});

// =============================================================================
// logLabelsValidation
// =============================================================================

describe("logLabelsValidation 便捷方法", () => {
  it("全 OK 不输出", () => {
    const r: LabelsValidationResult = { ok: true, warnings: [], errors: [] };
    logLabelsValidation(r, "test");
  });

  it("有 warnings → 不抛", () => {
    const r: LabelsValidationResult = {
      ok: true,
      warnings: ["warn1", "warn2"],
      errors: [],
    };
    logLabelsValidation(r, "test");
  });

  it("有 errors → 不抛", () => {
    const r: LabelsValidationResult = {
      ok: false,
      warnings: [],
      errors: ["err1"],
    };
    logLabelsValidation(r, "test");
  });
});
