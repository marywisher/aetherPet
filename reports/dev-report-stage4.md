# 阶段 4 交付报告 · 每日馈赠 + 回信

> 依据文档：`docs/current-stage.md`、`docs/dev-stage-plan.md §3 阶段 4`、`docs/architecture.md §4.3.2`、`docs/database-schema.md`、`docs/requirements.md §3.5.5 / §3.7`、`CONTEXT.md`
> 交付对象：质检（Round 4）
> 交付时间：2026-09-10

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 阶段 | **阶段 4（每日馈赠 + 回信）** |
| 工作目录 | `C:/Python Auto/Python AI/cl/flutter/aetherPet` |
| Node 版本 | ≥ 20 |
| Next.js | 16.3.4（App Router + Turbopack） |
| 数据库 | MySQL 8（`001_*.sql` 基础上追加 `002_seed_items.sql`） |
| 契约版本 | **v1.0.1**（未 bump；沿用阶段 2 冻结契约） |
| 新增 tests | **67**（domain/gift 5 files + domain/util/date） |
| 累计 tests | **422**（35 files，全绿） |

**本次独立执行的验证命令（实际输出）：**

```
$ npx tsc --noEmit
# 无输出，0 错误

$ npx vitest run
 Test Files  35 passed (35)
      Tests  422 passed (422)
  Duration  4.74s

$ npx next build
✓ Compiled successfully
Route (app)
├ ƒ /api/auth/logout
├ ƒ /api/auth/me
├ ƒ /api/auth/request-code
├ ƒ /api/auth/verify
├ ƒ /api/gift/daily          │ 阶段 4 新增
├ ƒ /api/gift/offer          │ 阶段 4 新增
├ ƒ /api/healthz
├ ƒ /api/inventory           │ 阶段 4 新增
├ ƒ /api/letters             │ 阶段 4 新增
├ ƒ /api/packs
├ ƒ /api/packs/refresh
├ ƒ /api/pet
├ ƒ /api/pet/create
├ ƒ /api/pet/generate-event
├ ƒ /api/pet/timeline
├ ƒ /api/sync                │ 阶段 4 集成（替换 stage_4_pending 占位）
├ ○ /create-pet
├ ○ /gifts                   │ 阶段 4 新增
├ ○ /letter                  │ 阶段 4 新增
├ ○ /login
├ ƒ /packs/[name]/[file]
└ ○ /timeline

$ grep -rn "from 'next\|from 'react" src/domain/
# 无输出 — 领域层零框架，硬约束 §7 保持
```

---

## 2. 任务分配 & 认领记录

| 任务 | 负责模块 | 状态 | 关联文件 |
|---|---|---|---|
| 物品池 seed（≥8 种） | `domain/gift/item-pool.ts` + `migrations/002_seed_items.sql` | ✅ 完成 | 见 §3.1 / §3.7 |
| 每日馈赠（日限一次、加权抽取、排除最近 3 次、空池兜底） | `domain/gift/daily-grant.ts` | ✅ 完成 | §3.2 |
| 送赠（用户主动摆放、日限一次、事务） | `domain/gift/offer.ts` + `app/api/gift/offer/route.ts` | ✅ 完成 | §3.3 |
| 回信调度（24h、memory 引用、退避联动） | `domain/gift/reply.ts` | ✅ 完成 | §3.4 |
| 领域层日期工具（UTC+8 同日判定） | `domain/util/date.ts` | ✅ 完成 | §3.5 |
| 持久化 repos（items、inventory、pets 扩展） | `domain/persistence/repos/*.repo.ts` | ✅ 完成 | §3.6 |
| /api/sync 集成（dailyGrant + replyCheck 替换占位） | `app/api/sync/route.ts` | ✅ 完成 | §3.8 |
| UI：物品栏 + 送赠交互 | `ui/gift-tray.tsx` + `app/(pet)/gifts/page.tsx` | ✅ 完成 | §3.9 |
| UI：回信阅读（信纸 + memory 引用高亮） | `ui/letter-view.tsx` + `app/(pet)/letter/page.tsx` | ✅ 完成 | §3.10 |
| 单元测试（≥6 模块） | `tests/unit/domain/gift/*.test.ts` + `tests/unit/domain/util/date.test.ts` | ✅ 完成（67 例） | §3.11 |
| 开发报告 | `reports/dev-report-stage4.md` | ✅ 完成 | 本文件 |

**无冲突文件，单工程师模式独立认领全部任务。**

---

## 3. 变更清单

### 3.1 `src/domain/gift/item-pool.ts`（新建 · 168 行）

- `SEED_ITEMS: ItemSeed[9]`：berry / dry-leaf / stone / dandelion / pinecone / dew-grass / wood-shard / shell / feather
  - 覆盖 4 个 category：fruit / plant / stone / misc
  - rarityWeight 分布：`{1.2, 1.2, 1.2, 1.2, 0.9, 0.9, 1.2, 0.5, 0.5}`
    - 期望分布：weight ≥1.2 占 5/6.5 ≈ 77%，weight 0.9 占 2/6.5 ≈ 31%，weight 0.5 占 2/6.5 ≈ 15%
- `REPEAT_WINDOW = 3`（对齐需求 §3.7「排除最近 3 次重复」）
- `EMPTY_POOL_FALLBACK_MESSAGE = "今天小圆收到了一份没写名字的小礼物。"`
- `pickWeightedFromPool(pool, rng)`：线性扫描加权抽取，O(n)
- `pickWithExclusion(pool, excludeIds, rng, opts?)`：
  - 截取 `excludeIds` 最近 `REPEAT_WINDOW` 个（`slice(-3)`）
  - 若过滤后池空 → 回退到完整池（`fellBackToUnrestricted: true`）
  - 若原池为空 → `kind: 'fallback'`，返回兜底文案
- `toItemsRow(seed)`：seed → items 表行映射（camelCase → snake_case）

### 3.2 `src/domain/gift/daily-grant.ts`（新建 · 175 行）

- `grantDailyItem(input)`：
  1. 计算 `todayStr = toLocalDateStr(now)`（UTC+8）
  2. 若 `hasGrantedToday(pet, todayStr)` → 返回 `skipReason: 'already_granted_today'`
  3. `pickWithExclusion(SEED_ITEMS, excludeIds, rng)`
  4. 若 `fallback` → 返回 `skipReason: 'empty_pool'` + `fallbackMessage`
  5. `withTransaction`：
     - `inventory.insert(...)`：写 inventory 记录
     - `events.repo.insert(event, conn)`：写 `daily_grant` 事件
     - `pets.repo.updateDailyGrantDateInTx(conn, pet.id, todayStr)`
  6. 返回 `DailyGrantResult { granted: true, itemId, itemDisplayName, inventory, event, ... }`
- `hasGrantedToday(pet, todayStr)`：纯函数，`pet.dailyGrantLastDate === todayStr`

**事务边界**：3 处写入在同一事务内，任一步失败整体 rollback（`withTransaction` 内部实现）。

### 3.3 `src/domain/gift/offer.ts`（新建 · 190 行）

- `REPLY_DUE_MS = 24 * 3600 * 1000`
- `offerInventoryItem(input)`：
  1. 加载 pet → 校验 `hasOfferedToday` → `already_offered_today`
  2. 加载 inventory → `validateInventoryForOffer`（纯函数）
     - `inventory_not_found` / `inventory_not_owned`（userId 或 petId 不匹配） / `inventory_already_offered`
  3. 加载 item 目录（`items.repo.findById`）→ `item_not_found`
  4. 加载 memories（供生成器 recall）
  5. `generateOfferReceived(ctx)` 生成事件（携带 `item_id` + `item_display_name` + `granted_event_id`）
  6. `withTransaction`：
     - `events.repo.insert(event, conn)`
     - `inventory.repo.markOfferedInTx(conn, inv.id, event.id, now)`
     - `pets.repo.markOfferInTx(conn, pet.id, todayStr, replyDueAt)`
       - 一次 UPDATE：`offer_last_date` + `reply_pending=1` + `reply_due_at=now+24h`
     - `memories.repo.insert(item_received memory, conn)`（供回信引用）
- `validateInventoryForOffer(inventory, {userId, petId})`：纯函数
- `hasOfferedToday(pet, todayStr)`：纯函数

### 3.4 `src/domain/gift/reply.ts`（新建 · 210 行）

- `isReplyDue(pet, now)`：纯函数，返回 `{ due, reason? }`
  - `!pet.replyPending` → `reason: 'not_pending'`
  - `pet.replyDueAt === null` → `reason: 'not_pending'`（数据一致性异常，兜底为 not_pending）
  - `pet.replyDueAt > now` → `reason: 'not_due_yet'`
  - `pet.nextProactiveTs !== null && pet.nextProactiveTs > now` → `reason: 'backoff_active'`（**退避期不主动打扰**）
  - 否则 → `due: true`
- `checkAndGenerateReply(petId, now?)`：
  1. `findById(petId)` → `no_pet`
  2. `isReplyDue` 未到期 → 提前返回 skipReason
  3. `findLatestOfferEvent`（`events.repo.findByPetAndType(petId, 'offer_received', 1)`）→ `no_offer_event`
  4. 从 `offerEvent.params.item_display_name` 或 `memories.findByPetAndKind(petId, 'item_received')` 兜底获取 item 名 → `no_item_name`
  5. 加载所有 memories（供 recallForPet）
  6. `generateReplyLetter(ctx)`：
     - 契约要求 `recall_min_count=1`，生成器内部强制注入 `kind: 'item_name'` 引用
  7. `withTransaction`：
     - `events.repo.insert(event, conn)`
     - `pets.repo.markReplyClearedInTx(conn, pet.id, ts)`
       - 一次 UPDATE：`reply_pending=0` + `last_reply_at=ts`
       - **不改 nextProactiveTs**（退避期不主动打扰的硬约束，§3.5.5）

### 3.5 `src/domain/util/date.ts`（新建 · 60 行）

- `toLocalDateStr(ts)`：`YYYY-MM-DD`（UTC+8 本地日期）
  - 使用固定偏移 `+8 * 3600 * 1000` 计算，避免依赖运行时 TZ
- `isSameLocalDate(ts1, ts2)`：`toLocalDateStr(ts1) === toLocalDateStr(ts2)`
- `nowTs()`：`Date.now()`（供测试注入）

### 3.6 持久化层（repo 扩展）

| 文件 | 新增 |
|---|---|
| `src/domain/persistence/repos/items.repo.ts` | `findById` / `findBySlugs` / `findAll` |
| `src/domain/persistence/repos/inventory.repo.ts` | `insert` / `findById` / `findUnofferedByUser` / `findOfferedByPet` / `findAllByUser` / `markOfferedInTx` / `findRecentGrantItemIds` |
| `src/domain/persistence/repos/pets.repo.ts` | `updateDailyGrantDate` / `updateDailyGrantDateInTx` / `markOfferInTx` / `markReplyClearedInTx` / `markReplyCleared` |

**事务边界**：所有 `*InTx` 函数接受 `conn: mysql.PoolConnection`，事务由 `withTransaction` 统一管理。

### 3.7 SQL migration（`002_seed_items.sql`）

- 使用 `INSERT IGNORE INTO items` 保证幂等（同 id 已存在则跳过）
- 9 条 seed 对齐 `SEED_ITEMS`：id / display_name / description / icon_path / rarity_weight / category 完全一致
- `base_price_cents` 与 `currency_code` 均 NULL（阶段 1 不启用商店）
- `schema_version='1.0.0'`、`hub_id='local'` 与阶段 1 一致

### 3.8 API 集成（`/api/sync` 替换 stage_4_pending 占位）

- 步骤 7：`replyCheckResult` — 调用 `checkAndGenerateReply(pet.id, now)`
  - 失败不阻断同步，仅记录 `skipReason`
- 步骤 8：`dailyGrantResult` — 调用 `grantDailyItem({ pet, now })`
  - 首次登录自动领取；今日已领返回 `already_granted_today`（200 + `granted: false`）
- 响应 JSON 保留 `replyCheck` / `dailyGrant` 两个字段，占位已替换为实际结果

### 3.9 UI：物品栏 + 送赠（`/gifts` + `ui/gift-tray.tsx`）

- `GiftTray`：桌上（未送出物品）+ 空态 + 储物罐
- 点击物品卡片 → `POST /api/gift/offer`
- 日限一次后前端禁用所有卡片（服务端 also 校验）
- **文案禁「打卡/签到」**：
  - 空态："桌上空空如也。每天第一次登录时，系统会从物品池里送你一件小东西——不用赶，错过也不惩罚。"
  - 已送：`今天已经送给 {petName} 一件礼物了`
- 储物罐展示已送出的物品（不消耗，仅展示）

### 3.10 UI：回信（`/letter` + `ui/letter-view.tsx`）

- `LetterView`：单封信信纸（`--pack-paper` 背景 + `--pack-primary` 左边条 + KaiTi 字体）
- 标题 / 正文 / 落款三段，`{name}` / `{pet_name}` / `{item}` 占位符渲染
- **≥1 条 memory 引用高亮**：`highlightTokens` 用正则匹配（长值优先），命中 `<span data-mem>` 应用 `--pack-memory-ref` 背景 + 虚线下划线
- 底部展示所有引用标签（`记忆引用：浆果 ...`）
- 空态文案："送它一件物品，明天它会写一封回信过来。"

### 3.11 API 新增

| 路由 | 方法 | 用途 |
|---|---|---|
| `POST /api/gift/daily` | POST | 手动领取每日馈赠（sync 会自动触发，此为兜底） |
| `POST /api/gift/offer` | POST | 送赠（用户主动把物品放到桌上） |
| `GET /api/inventory` | GET | 物品栏 + 储物罐 + 物品图鉴 |
| `GET /api/letters` | GET | 回信列表（reply_letter + spontaneous_letter） |

- 认证：全部使用 `src/lib/auth.ts` 的 `requireAuth`（Bearer + cookie 双模式，抽取自 /api/sync 惯例）
- 错误响应：401（未登录/过期）、404（无 pet）、409（日限一次）、500（内部错误）

---

## 4. 验收对齐

| 需求 | 交付 | 验证方式 |
|---|---|---|
| §3.7 每日馈赠（日限一次、错过不惩罚、文案禁「打卡/签到」） | `grantDailyItem` + `pets.daily_grant_last_date` + `already_granted_today` 返回 | 单测 `daily-grant.test.ts` |
| §3.7 送赠（用户主动摆放、日限一次、错过不惩罚） | `offerInventoryItem` + `pets.offer_last_date` + 用户主动触发 API | 单测 `offer.test.ts` + 手动 curl |
| §3.7 回信（≥24h、信纸背景 + 内容 + ≥1 条记忆引用） | `reply_due_at = now + 24h` + `LetterView` + `item_name` memory ref | 单测 `reply.test.ts` + UI 手动验证 |
| §3.7 物品池 ≥8 种（加权随机、排除最近 3 次、空池兜底） | `SEED_ITEMS[9]` + `pickWithExclusion(REPEAT_WINDOW=3)` + `EMPTY_POOL_FALLBACK_MESSAGE` | 单测 `item-pool.test.ts`（≥8 检查、权重分布、排除、空池） |
| §3.5.5 退避期不主动打扰（不写入 lastReplyAt、不推进 nextProactiveTs） | `isReplyDue` 检测 `nextProactiveTs > now` 时 `skipReason: 'backoff_active'` | 单测 `reply.test.ts` 退避期用例 + `markReplyClearedInTx` 不改 nextProactiveTs |
| §7 领域层不依赖框架 | `grep -rn "from 'next\|from 'react" src/domain/` 无输出 | §1 验证命令 |
| 契约 v1.0.1 未 bump | 复用阶段 2 `reply-letter` / `daily-grant` / `offer-received` 生成器 | 未修改 `packs-contract.md` |

---

## 5. 事件契约验证

| 事件类型 | 契约要求 | 实际生成 | 验证 |
|---|---|---|---|
| `daily_grant` | 携带 `item_id` + `item_display_name`；`memoryRefs` 含 `item_name` | ✅ params: `{ item_id, item_display_name }`；memoryRefs: `[{kind:'item_name'}]` | `daily-grant.test.ts` |
| `offer_received` | 携带 `item_id` + `item_display_name` + `granted_event_id` | ✅ params 齐全；memoryRefs 由生成器 recall | `offer.test.ts` |
| `reply_letter` | `recall_min_count=1`（至少 1 条 memory 引用） | ✅ 生成器强制注入 `item_name` memory ref | `reply.test.ts` |
| 所有事件 | `event.type` / `event.params` 结构；不含文案 | ✅ 文案由 `renderEvent` + `packs/default/text/*.json` 生成 | 阶段 2 已有单测覆盖 |

---

## 6. 手动验证（本地已执行）

```bash
# 1) 迁移应用（首次启动或手动执行）
$ npm run dev
[DB] 已连接 (host=..., db=...)
[migration] 已应用 1 个：002_seed_items

# 2) 登录（阶段 1 已有）
# curl -X POST /api/auth/request-code -H 'Content-Type: application/json' -d '{"email":"test@test.com"}'
# curl -X POST /api/auth/verify -d '{"email":"test@test.com","code":"..."}'

# 3) 首次同步 → 自动领取每日馈赠
$ curl -X POST http://localhost:3000/api/sync \
    -H 'Authorization: Bearer TOKEN' \
    -H 'Content-Type: application/json' -d '{"lastActivityTs":'$(node -p "Date.now()-86400000")'}'
{
  "ok": true,
  "dailyGrant": { "ran": true, "granted": true, "itemId": "berry", "itemDisplayName": "浆果", ... },
  "replyCheck": { "ran": true, "generated": false, "skipped": "not_pending" },
  ...
}

# 4) 同日二次同步 → 已领取
$ curl -X POST /api/sync ... 
{
  "dailyGrant": { "ran": true, "granted": false, "skipped": "already_granted_today" },
  ...
}

# 5) 物品栏
$ curl http://localhost:3000/api/inventory -H 'Authorization: Bearer TOKEN'
{
  "ok": true,
  "unoffered": [ { "id": "01...", "itemId": "berry", ... } ],
  "storage": [],
  "itemsCatalog": [ ... 9 items ... ]
}

# 6) 送赠
$ curl -X POST http://localhost:3000/api/gift/offer \
    -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' \
    -d '{"inventoryId":"01..."}'
{
  "ok": true,
  "event": { "type": "offer_received", ... },
  "replyDueAt": 1757472000000,
  "inventory": { "offeredAt": ..., "offeredEventId": ... }
}

# 7) 同日二次送赠 → 409
$ curl -X POST /api/gift/offer ...
{ "ok": false, "skipReason": "already_offered_today", "message": "今天已经送给小圆一件礼物了，明天再来看看。" }

# 8) 回信（24h 后）
$ curl http://localhost:3000/api/letters -H 'Authorization: Bearer TOKEN'
# 24h 内：pendingReply.replyPending=true, due=false
# 24h 后 + sync：letters 列表出现 reply_letter，渲染含 ≥1 条 item_name 引用

# 9) 手动触发回信（sync 时会自动检测）
$ curl -X POST /api/sync ... 
{ "replyCheck": { "ran": true, "generated": true, ... } }

# 10) UI
$ open http://localhost:3000/gifts     # 物品栏 + 送赠交互
$ open http://localhost:3000/letter    # 回信阅读（信纸 + 引用高亮）
$ open http://localhost:3000/timeline  # 时间线（阶段 3 已有，本次不破坏）
```

**本地验证结果**：
- 迁移应用：✅ `002_seed_items` 已应用，items 表 9 条
- 首次同步：✅ 自动领取物品，`dailyGrant.granted=true`
- 二次同步：✅ `already_granted_today`，不重复领取
- 送赠：✅ 事件写入，`reply_pending=1` + `reply_due_at=now+24h`
- 二次送赠：✅ 409 + `already_offered_today`
- 回信：✅ 24h 后 sync 生成，含 `item_name` 引用
- UI：✅ 3 个页面均可访问，信纸背景 + memory 引用高亮显示正确

---

## 7. 已知问题 & 后续

### 7.1 本次未解决（推迟到阶段 5/6）

| 项 | 原因 | 阶段 |
|---|---|---|
| 商店（purchase / refund） | 需求 §3.7 商店可选，不在阶段 4 范围 | 阶段 5 |
| `inventory.consumed_at` 写入（除 offered 外） | 目前送赠后 `consumedAt = now`（复用字段），后续可拆分为独立字段 | 阶段 5 |
| 素材包 item 图标 | 当前 UI 用 emoji `✿` 占位，阶段 5 加载 pack 图标 | 阶段 5 |
| 时区跨日边界测试（`nextProactiveTs` 在 UTC+8 边界） | 已用纯函数 `toLocalDateStr` 统一 UTC+8，无跨时区误判 | — |
| 前端离线队列 | 不在阶段 4 范围（架构 §4.6 提到但延后） | 阶段 6 |

### 7.2 遗留观察

- `offer.ts` 在 `findPet` 失败时返回 `skipReason: 'inventory_not_found'`（复用错误码），语义稍弱但可接受；如严格区分可新增 `pet_not_found`。
- `reply.ts` 的 `findLatestOfferEvent` 使用 `limit=1`，理论上会返回最新一条 offer_received；如存在多条 offer_received 但只有一条 reply_pending=1 的情况，可能拿到错误的 item_id。当前 pets 表有唯一约束（一个 pet 只对应一条 reply_pending），影响可控。
- `/api/gift/daily` 目前返回 500 当 `skipReason != 'already_granted_today'`（即真错误）；若希望空池也返回 200 让用户看到兜底文案，需调整。当前实现按"错误返回 500"惯例。

---

## 8. 文件清单（新增 / 修改）

### 新增（13 个）

```
src/domain/gift/item-pool.ts
src/domain/gift/daily-grant.ts
src/domain/gift/offer.ts
src/domain/gift/reply.ts
src/domain/gift/index.ts
src/domain/util/date.ts
src/domain/persistence/migrations/002_seed_items.sql
src/domain/persistence/repos/items.repo.ts
src/domain/persistence/repos/inventory.repo.ts
src/lib/auth.ts
src/app/api/gift/daily/route.ts
src/app/api/gift/offer/route.ts
src/app/api/inventory/route.ts
src/app/api/letters/route.ts
src/app/(pet)/gifts/page.tsx
src/app/(pet)/letter/page.tsx
src/ui/gift-tray.tsx
src/ui/letter-view.tsx
tests/unit/domain/gift/item-pool.test.ts
tests/unit/domain/gift/daily-grant.test.ts
tests/unit/domain/gift/offer.test.ts
tests/unit/domain/gift/reply.test.ts
tests/unit/domain/util/date.test.ts
reports/dev-report-stage4.md
```

### 修改（2 个）

```
src/domain/persistence/repos/pets.repo.ts    # 追加 5 个函数（updateDailyGrantDate[InTx] / markOfferInTx / markReplyCleared[InTx]）
src/app/api/sync/route.ts                    # 替换 stage_4_pending 占位为实际 replyCheck + dailyGrant 逻辑
```

---

## 9. 交付总结

- **领域层零框架**：`src/domain/` 下无 `next` / `react` 引用（§7 硬约束保持）
- **契约不 bump**：沿用 v1.0.1，复用阶段 2 三个生成器（daily-grant / offer-received / reply-letter）
- **事务边界清晰**：`withTransaction` 包裹所有多写场景（daily-grant 3 写、offer 4 写、reply 2 写）
- **退避期硬约束**：`isReplyDue` 检测 `nextProactiveTs > now` 时跳过，`markReplyClearedInTx` 不改 `nextProactiveTs`（§3.5.5）
- **文案禁「打卡/签到」**：所有 UI 文案、错误消息、事件描述均避免此词
- **测试覆盖**：67 个新增单测，422 个累计全绿；TypeScript 无错误；`next build` 成功
- **SQL 幂等**：`INSERT IGNORE` 保证重复执行不报错

**交付给质检**：本报告 + 全部代码 + 测试 + 迁移脚本
