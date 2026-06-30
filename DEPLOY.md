# wau-typescript-sdk 部署(npm 发布)

## 发布流程

```bash
# 1. 打 tag(用户手动)
git tag v1.1.0
git push origin v1.1.0

# 2. npm publish(用户手动)
npm login
npm run build
npm publish
```

## 版本兼容性

- **v1.1.x** ↔ wau-llm-router v0.9.x
- **wire 100% 兼容** v0.8.0

## 配置

```typescript
const bot = new Bot({
  token: process.env.TELEGRAM_BOT_TOKEN!,  // env 占位
  tenantId: "acme",
  address: "127.0.0.1:18431",
});
```

**所有 token 用 `$VAR` 占位**(per 双 feedback)

## 升级路径

- v1.1.0 → v1.0.x:wire 100% 兼容
- v1.1.0 → v1.2.0(roadmap):
  - React hook(useBot)
  - streaming helpers
