# Step 2 · 反向验证（修复方案极端场景推演）

> 审计时间：2026-09-12
> 范围：H1（开发工具区生产隐藏）、H2（馈赠欢迎卡片）、H3（开发者调时工具——用户决策不做）
> 方法：对**将要实施的修复方案**设计极端场景，逐行推演执行路径，确认无歧义后再落地

---

## H1 · 开发工具区按环境隐藏（`IS_DEV = process.env.NODE_ENV !== "production"`）

| # | 场景 | 执行路径推演 | 结论 |
|---|------|--------------|------|
| 1 | 生产构建 `NODE_ENV=production` | `IS_DEV=false` → 条件渲染 `{IS_DEV && …}` 分支被静态消除,区块不渲染;Next.js 客户端组件构建期把 `process.env.NODE_ENV` 静态替换为 `"production"`,SSR/客户端水合一致 | ✅ |
| 2 | 本地 `npm run dev`(development) | `IS_DEV=true` → 区块原样显示,generateEvent 行为不变(测试可达) | ✅ |
| 3 | 生产 + 手动 `ENABLE_DEV_ENDPOINTS=true` | 前端仍隐藏(客户端读不到服务端 env);但 `/api/pet/generate-event` 白名单仍可 curl 调用——后端防线保留,不产生"看不到但可调用"的暴露面 | ✅ 可接受,记为设计说明 |
| 4 | vitest 环境 `NODE_ENV=test` | `IS_DEV=true`;项目无页面级渲染测试,无影响 | ✅ |
| 5 | Vercel Preview 部署(production) | 同上场景 1,隐藏 | ✅ |

**推演结论**：无歧义。唯一注意点（场景 3）——生产加上白名单后前端按钮不显示，但接口可用，符合"白名单=管理员手动通道"语义，已写入汇总报告。

## H2 · 馈赠欢迎卡片（`sync.dailyGrant` 驱动）

| # | 场景 | 执行路径推演 | 结论 |
|---|------|--------------|------|
| 1 | 当日首次登录 | sync 内 `grantDailyItem` granted=true → `dailyGrant.granted=true` + `itemDisplayName` → 首页渲染欢迎卡(物品名 + 「去送礼」CTA → /gifts) | ✅ 仪式感达成 |
| 2 | 刷新页面 / 当天再进 | `already_granted_today` → `granted=false`,`skipped!="empty_pool"` → `setDailyWelcome(null)`,不显示 | ✅ 幂等,零重复打扰 |
| 3 | 物品池空 | `empty_pool` + `fallbackMessage` → 渲染兜底文案条(无 CTA) | ✅ |
| 4 | sync 401(未登录) | `runSyncOnce` 内 `!res.ok → null` → 不显示;随后 timeline 401 → 跳 /login | ✅ |
| 5 | 网络异常 | catch → null → 不显示,页面正常 | ✅ |
| 6 | 并发双开 / StrictMode 双调用 | 模块级 in-flight 去重,单请求单响应 | ✅ |
| 7 | 30 天离线首次回归 | 欢迎卡(跨天馈赠)与聚合入口卡片(`aggregateEntry`)同屏,布局上下排列不冲突 | ✅ |
| 8 | `skipped` 为其它值(reply 相关等) | 落入 else 分支 → null,不显示 | ✅ |
| 9 | 组件在响应前卸载(切页) | React 18 对 unmounted setState 静默丢弃,无警告 | ✅ |

**推演结论**：无歧义。`dailyGrant` 字段名与 `sync/route.ts` 响应完全对齐（`ran/granted/skipped/fallbackMessage/itemId/itemDisplayName`）。

## H3 · 开发者调时工具（用户决策：不做）

按用户决策不实施。验收 4 的 3/30 天场景采用「手动改 `pets.last_activity_ts`」造数据，验收手册描述已不要求开发者页提供该工具（可在验收时手工造数）。

## Raw 推演备注（供复核）

- `page.tsx` load 中 sync 消费代码：`const sync = await runSyncOnce();` 后续 `if (sync?.dailyGrant)` 三段分支（granted / empty_pool / else）与上表一一对应。
- `sync-client.ts` 返回值语义：2xx→透传 `{ dailyGrant }`；`!res.ok`/异常→`null`（调用方不抛异常）。
- 时间线页仅 `await runSyncOnce()` 不消费返回值，类型变更对其无影响。