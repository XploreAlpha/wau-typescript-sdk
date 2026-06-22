/**
 * v0.8.0 M3-2C — Universe Labels 校验
 *
 * 跟 wau-go-sdk universe_labels.go 语义对齐
 * 跟 WAU-core-kernel internal/registry/universe_labels.go 语义对齐
 * 跟 afp-protocol 端 src/universe_labels.ts 语义对齐
 *
 * 关键约束(per v0.8.0 M3 B 计划决策 2 软警告):
 *   - SDK 端只预校验(减少 round-trip),server 端是 source of truth
 *   - 软警告不阻断,只 console.warn
 *   - 老 client 不传 labels → undefined/空 Record,无 warning
 *   - 4 SDK 漂移风险:kernel 公开 ReservedLabelKeys 常量作 source of truth
 *     (本文件直接复制,未来可改成代码生成)
 */

// =============================================================================
// 6 个 reserved labels 白名单
// =============================================================================
//
// 跟 WAU-core-kernel + wau-go-sdk + wau-python-sdk + afp-protocol 1:1
// server 是 source of truth,SDK 端复制(漂移风险 M5 联调时校对)

const RESERVED_LABELS_ALL_VALUES: Record<string, ReadonlySet<string>> = {
  region: new Set(), // 自由字符串
  gpu: new Set(["true", "false"]),
  tier: new Set(["low", "medium", "high-performance"]),
  security_level: new Set(["trusted", "untrusted"]),
  load: new Set(["idle", "low", "medium", "high", "overloaded"]),
  universe_role: new Set(["business", "compute-pool"]),
};

const RESERVED_LABEL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(RESERVED_LABELS_ALL_VALUES)
);

// 公开常量(供 caller 引用,避免各自维护漂移)
export const RESERVED_UNIVERSE_LABEL_KEYS: ReadonlyArray<string> = Array.from(
  RESERVED_LABEL_KEYS
).sort();

/** 检查 key 是否在 reserved 白名单 */
export function isReservedLabelKey(key: string): boolean {
  return RESERVED_LABEL_KEYS.has(key);
}

// =============================================================================
// 校验结果类型
// =============================================================================

/** 校验结果(跟 kernel + AFP 字段 1:1) */
export interface LabelsValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

// =============================================================================
// 核心校验函数
// =============================================================================

/**
 * 校验单个 labels map
 *
 * 永远不抛,返 LabelsValidationResult
 * SDK 端调用方应检查 r.ok,warnings 走 console.warn,errors 走 console.error
 */
export function validateUniverseLabels(
  labels: Record<string, string> | null | undefined
): LabelsValidationResult {
  const result: LabelsValidationResult = { ok: true, warnings: [], errors: [] };

  if (!labels || Object.keys(labels).length === 0) {
    return result;
  }

  for (const [key, value] of Object.entries(labels)) {
    // 自由 label key 命名 warning
    if (
      !RESERVED_LABEL_KEYS.has(key) &&
      !SNAKE_CASE_REGEX.test(key)
    ) {
      result.warnings.push(
        `free label "${key}" should be snake_case (e.g. "${toSnakeCase(key)}")`
      );
    }

    // reserved label 校验
    if (RESERVED_LABEL_KEYS.has(key)) {
      const allowed = RESERVED_LABELS_ALL_VALUES[key];
      if (value === "") {
        result.warnings.push(
          `reserved label "${key}" has empty value (consider removing or setting valid value)`
        );
      } else if (allowed.size > 0 && !allowed.has(value)) {
        const sortedAllowed = Array.from(allowed).sort().join(", ");
        result.warnings.push(
          `reserved label "${key}"="${value}" not in allowed values [${sortedAllowed}]`
        );
      }
      continue;
    }

    // 自由 label 空 value warning
    if (value === "") {
      result.warnings.push(`free label "${key}" has empty value`);
    }
  }

  return result;
}

/**
 * 把校验结果走 console 输出
 *
 *   - warnings → console.warn(前缀 [WAU SDK warn])
 *   - errors → console.error(前缀 [WAU SDK error])
 *
 * 调用方应在 RegisterCard / RegisterAgent / RegisterPeer 前调
 */
export function logLabelsValidation(
  result: LabelsValidationResult,
  context: string = "register"
): void {
  if (result.ok && result.warnings.length === 0 && result.errors.length === 0) {
    return;
  }
  for (const w of result.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[WAU SDK ${context} warn] ${w}`);
  }
  for (const e of result.errors) {
    // eslint-disable-next-line no-console
    console.error(`[WAU SDK ${context} error] ${e}`);
  }
}

// =============================================================================
// 内部工具
// =============================================================================

const SNAKE_CASE_REGEX = /^[a-z][a-z0-9_]*$/;

/** camelCase / kebab-case → snake_case */
function toSnakeCase(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (i > 0 && ch >= "A" && ch <= "Z") {
      out += "_";
    }
    if (ch === "-" || ch === " ") {
      out += "_";
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}
