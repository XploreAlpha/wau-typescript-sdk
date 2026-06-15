# Changelog

## v1.0.0 (2026-06-25) — GA

> 🟢 **Amber W3 Day 4: TypeScript SDK 1.0 GA**
> 57/57 tests pass · 94.98% 覆盖率 · 0 breaking changes vs 0.6.0-preview.1

### 升级说明

- 0.6.0-preview.1 → 1.0.0:无 API 变化,只是去掉 preview 标签
- 1.0.0 = 稳定 API 保证(以后 1.x.y 只做 bug fix,1.x.0+ 才加新功能)
- npm install: `npm install wau-sdk@1.0.0`

### 已就位(从 v0.6.0-preview.1 继承)

- HTTP API 11 端点 × 2 同步/异步 = 22 方法
- 4 场景契约 25/25 过
- 装饰器链(translate / agentrec / circuit)
- 4 service 客户端(Kernel / Registry / Intent / Circuit)
- 5 场景契约 + 8 服务单测
- 4 examples(basic / async / decorators / circuit-breaker)
- docs/ 全套

## v0.6.0-preview.1 (2026-06-14)

> 🔶 Carnelian M3 W6 — 完整 TypeScript SDK
> 翻译 wau-python-sdk 0.6.0-preview.1 → TypeScript / JavaScript 双生态
