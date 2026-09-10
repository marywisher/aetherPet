# 质检报告 · 阶段 4（每日馈赠 + 回信）· Round 1

> 测试对象：阶段 4 交付（`src/domain/gift/*`、`src/domain/util/date.ts`、repos 扩展、`002_seed_items.sql`、`/api/gift/*`、`/api/inventory`、`/api/letters`、`/gifts`、`/letter`、`/api/sync` 集成）
> 依据文档：`docs/current-stage.md`、`docs/dev-stage-plan.md §3 阶段 4`、`docs/requirements.md §3.7 / §3.5.5 / 验收 #10`、`CONTEXT.md`、`docs/packs-contract.md`、`reports/dev-report-stage4.md`
> 质检时间：2026-09-10

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 阶段 | **阶段 4（每日馈赠 + 回信）Round 1** |
| 工作目录 | `C:/Python Auto/Python AI/cl/flutter/aetherPet` |
| Node 版本 | ≥ 20 |
| Next.js | 16.3.4（App Router + Turbopack） |
| 数据库 | MySQL 8（`001_init.sql` + `002_seed_items.sql`） |
| 契约版本 | **v1.0.1**（未 bump，复用阶段 2 生成器） |
| 单测 | **422 全绿**（35 files）— 质检本地复跑通过 |
| TypeScript | `npx tsc --noEmit` 0 错误 |
| 领域层零框架 | `grep -rn "from 'next\|from 'react" src/domain/` 无输出 ✅ |
| 文案禁「打卡/签到」 | 全库 grep 后仅剩代码注释，无用户可见文案 ✅ |
| 事件结构不含文案 | daily-grant / offer-received / reply-letter 事件 params 均为结构化字段（item_id / item_display_name / gift_event_id） ✅ |

**本地验证命令（实际执行）：**

```bash
$ npx vitest run
 Test Files  35 passed (35)
      Tests  422 passed (422)

$ npx tsc --noEmit
# 无输出

$ grep -rn "from 'next\|from 'react" src/domain/
# 无输出

$ grep -rn "打卡\|签到" src/
# 仅剩代码注释，无用户可见文案
```

---

## 2. 测试汇总

- 发现问题总数：**13**
  - **P0：0**
  - **P1：4**（严重）
  - **P2：6**（一般）
  - **P3：3**（轻微）
- 是否建议提交：**否**（需先修复 P1，P2 视排期）

---

## 3. 详细问题清单

### P1 - 严重问题（4 项）

#### P1-001 · `next_proactive_ts` 从未写入 DB，`backoff_active` 退避检查是死代码

| 编号 | 所在文件 | 严重程度 |
|---|---|---|
| P1-001 | `src/app/api/sync/route.ts`（80 行）、`src/domain/gift/reply.ts`（79 行）、`src/domain/persistence/repos/pets.repo.ts` | **阻塞退避联动** |

**问题描述：**
`computeBackoff` 每次 sync 会计算 `nextProactiveTs`，但该值**仅返回给客户端，从未写回 `pets.next_proactive_ts` 列**。因此 DB 中 `next_proactive_ts` 恒等于 `/api/pet/create` 初始值（`null`），导致 `reply.ts` 中 `isReplyDue` 的退避分支

```ts
if (pet.nextProactiveTs !== null && pet.nextProactiveTs > now) {
  return { due: false, reason: "backoff_active" };
}
```

在生产环境永远无法触发。

**验收对齐：**
- 需求 §3.5.5「退避期不主动打扰」—— 无法保证
- 需求 §3.7「pet 也会自主冒信，间隔遵守退避表」—— 该检查是退避联动的唯一接入点
- 开发报告 §4「`isReplyDue` 检测 `nextProactiveTs > now` 时 `skipReason: 'backoff_active'`」—— **仅在单测通过，生产环境不生效**
- 阶段 3 QA #10-2 表述「可观测」，未要求「持久化」；但阶段 4 代码读取 `pet.nextProactiveTs` 默认了它已被阶段 3 写入 —— 存在跨阶段集成缺口

**复现步骤：**
1. 建 pet，`/api/pet/create` → `pets.next_proactive_ts = NULL`
2. 用户离开 3 天，期间不 sync
3. 用户回来触发 `/api/sync`：`computeBackoff` 返回 `nextProactiveTs = now + 7d`，但**未写回 DB**
4. 期间若 `reply_pending=1` 且 `reply_due_at` 已到期，`checkAndGenerateReply` 读到的 `pet.nextProactiveTs === null` → `isReplyDue` 返回 `due=true` → **退避期仍生成回信**

**期望结果：** 退避期内 `skipReason='backoff_active'`，回信不生成
**实际结果：** 退避期内回信正常生成，退避形同虚设

**建议修复：**
- 方案 A：在 `/api/sync` 计算 backoff 后，同事务内把 `backoff.nextProactiveTs` 写回 `pets.next_proactive_ts`（推荐；符合"用户活跃度动态退避"语义）
- 方案 B：`checkAndGenerateReply` 内实时调用 `computeBackoff` 判定，不依赖 DB 字段（更纯函数，但重复计算）
- 同时补一个集成测试覆盖「用户离开 3 天 → 回信延后到 7 天」场景

---

#### P1-002 · `daily_grant` 事件的 `inventory_id` 在事务提交后回填，DB 与返回值不一致

| 编号 | 所在文件 | 严重程度 |
|---|---|---|
| P1-002 | `src/domain/gift/daily-grant.ts`（139-166 行） | 数据一致性 |

**问题描述：**
```ts
// 生成事件（不持久化；后续事务内持久化）
const gen = generateDailyGrant(ctx);  // ctx 未传 inventoryId → event.params.inventory_id = null
const event = gen.event;

// 生成 inventory id
const inventoryId = newId();

// 事务：写 inventory → 写 event → 更新 pets.daily_grant_last_date
await withTransaction(async (conn) => {
  const inventory: Inventory = { id: inventoryId, ... };
  await insertInventory(inventory, conn);
  await insertEvent(event, conn);  // <-- DB 里 event.params.inventory_id = null
  await updateDailyGrantDateInTx(conn, pet.id, todayStr);
});

// 回填 event.inventory_id（原生成时未填）
event.params.inventory_id = inventoryId;  // <-- 事务提交后才改，DB 不受影响
```

生成器 `daily-grant.ts` 已支持 `ctx.inventoryId`（第 21-22 行），但调用方 `grantDailyItem` 没传，反而在事务之后手工修改内存对象。DB 中该事件 `params.inventory_id = null`，而 API 返回的 `event.params.inventory_id = inventoryId`。

**期望结果：** DB 事件与返回事件完全一致；`event.params.inventory_id` 指向真实 inventory
**实际结果：** DB 事件 `inventory_id` 永远为 null，`/api/sync` 与 `/api/gift/daily` 返回的 `event.params.inventory_id` 只在同一请求生命周期有效，持久化后即失效

**建议修复：**
```ts
const inventoryId = newId();
const event = generateDailyGrant({ ...ctx, inventoryId }).event;
// 事务内直接 insertEvent(event) 即可，无需事务后回填
```
同步补一个测试：`expect(result.event?.params.inventory_id).toBe(result.inventory?.id)`。

---

#### P1-003 · 并发请求下 daily-grant / offer 均存在 race condition（无唯一性约束 + 无行锁）

| 编号 | 所在文件 | 严重程度 |
|---|---|---|
| P1-003 | `src/domain/gift/daily-grant.ts`（100 行）、`src/domain/gift/offer.ts`（127 行）、`src/domain/persistence/repos/pets.repo.ts`（`updateDailyGrantDateInTx` / `markOfferInTx`）、`src/domain/persistence/repos/inventory.repo.ts`（`markOfferedInTx`） | 幂等性 |

**问题描述：**
日限一次判断均在事务外基于内存中的 `pet` 对象：

```ts
// daily-grant.ts
if (hasGrantedToday(pet, todayStr)) return {...};
// 事务
await withTransaction(async (conn) => {
  await insertInventory(inventory, conn);
  await insertEvent(event, conn);
  await updateDailyGrantDateInTx(conn, pet.id, todayStr);
});

// offer.ts
if (hasOfferedToday(pet, todayStr)) return {...};
const invalidReason = validateInventoryForOffer(inventory, { userId, petId });
// 事务
await withTransaction(async (conn) => {
  await insertEvent(event, conn);
  await markOfferedInTx(conn, inventory!.id, event.id, now);
  await markOfferInTx(conn, pet.id, todayStr, replyDueAt);
  await insertMemory(memory, conn);
});
```

`pets.daily_grant_last_date` 与 `pets.offer_last_date` 是普通 `VARCHAR(10)`，无 UNIQUE 约束；`inventory.offered_at` 也无 `WHERE offered_at IS NULL` 保护。两个并发请求同时读到 `dailyGrantLastDate=null` / `offerLastDate=null`，都会通过校验并都写入事务，最终产生**两条 inventory、两个 daily_grant 事件、两次 pets 更新**（后写覆盖前写）—— 违反「日限一次」。

触发场景：多标签页同步、移动客户端重试、网络抖动重发、/api/sync 中 `grantDailyItem` 与用户手动 /api/gift/daily 并发。

**期望结果：** 同一 UTC+8 日期内 daily_grant / offer 至多成功一次
**实际结果：** 并发下可多次成功

**建议修复（三种方案任选）：**
- 方案 A：事务内改成条件更新，读 `affectedRows` 判定是否重复：
  ```sql
  UPDATE pets SET daily_grant_last_date=? WHERE id=? AND (daily_grant_last_date IS NULL OR daily_grant_last_date<?)
  ```
  `affectedRows===0` → 视为已被并发请求处理，rollback 并返回 `already_granted_today`
- 方案 B：加唯一索引 `UNIQUE(pet_id, daily_grant_last_date) WHERE daily_grant_last_date IS NOT NULL`（MySQL 需要变通，如用虚拟列或额外表）
- 方案 C：事务首行 `SELECT ... FOR UPDATE` 锁 pet 行（简单但锁粒度较大）

同时对 `inventory.markOfferedInTx` 加 `WHERE offered_at IS NULL` 并在返回 `affectedRows === 0` 时 rollback。

---

#### P1-004 · `/api/letters` 与 UI 的 `pendingReply.due` 不检查退避期，与领域不一致

| 编号 | 所在文件 | 严重程度 |
|---|---|---|
| P1-004 | `src/app/api/letters/route.ts`（68-73 行）、`src/app/(pet)/letter/page.tsx` | UI 与领域不一致 |

**问题描述：**
```ts
// /api/letters
const pendingReply = {
  due:
    pet.replyPending &&
    pet.replyDueAt !== null &&
    pet.replyDueAt <= now,   // 未检查 nextProactiveTs > now
  ...
};
```

而领域函数 `reply.ts::isReplyDue` 同时检查退避。当 `replyDueAt <= now` 但 `nextProactiveTs > now`（退避期）时，`/api/letters` 返回 `due=true`，UI 显示「**{petName} 已经写好回信了——回到时间线或同步一次就能看到**」；但用户实际 sync 后 `checkAndGenerateReply` 因 `backoff_active` 跳过，用户永远看不到信——文案承诺与实际行为不一致。

（若 P1-001 修复后 `nextProactiveTs` 被写入 DB，本问题会变得显著。）

**期望结果：** UI 显示的 `due` 与领域 `isReplyDue` 结论一致
**建议修复：** 抽出共享判定函数（如 `isReplyDue(pet, now).due`）供 `/api/letters` 与 `reply.ts` 共用；或 `/api/letters` 中同样加入 `nextProactiveTs` 检查

---

### P2 - 一般问题（6 项）

#### P2-001 · `offerInventoryItem` 在 pet 不存在时返回错误的 `skipReason`

| 编号 | 所在文件 |
|---|---|
| P2-001 | `src/domain/gift/offer.ts`（115-122 行） |

```ts
const pet = await findPet(petId);
if (!pet) {
  return {
    offered: false,
    skipReason: "inventory_not_found",  // <-- 语义错误：pet 不存在，不是 inventory
    message: "pet 不存在",
    todayStr,
  };
}
```

开发报告 §7.2 已自陈此问题。虽然 `message` 是正确文案，但 `skipReason` 会让调用方（前端/日志/指标）产生错误归因。建议新增 `"pet_not_found"` 变体。

---

#### P2-002 · `/api/sync` 响应返回陈旧 pet 对象

| 编号 | 所在文件 |
|---|---|
| P2-002 | `src/app/api/sync/route.ts`（63-100 行） |

sync 内 catchup 与 gift/reply 都会更新 pets（state / last_activity_ts / user_last_active_ts / reply_pending / last_reply_at / daily_grant_last_date / offer_last_date），但第 63 行 `findByUserId` 读取的 `pet` 对象**再未被刷新**，返回给客户端的 `pet` 字段全部是同步前的旧值。阶段 4 新增的 `dailyGrantLastDate` / `offerLastDate` / `replyPending` / `lastReplyAt` 字段也一并陈旧。

同时 `grantDailyItem({ pet, now })` 使用这份陈旧 pet，虽然 daily-grant 逻辑本身只用 `dailyGrantLastDate`（未被回信修改），当前无副作用；但若后续任何模块依赖 `pet.state` 或 `pet.userLastActiveTs` 就会出问题。

**建议修复：** sync 尾部 `const freshPet = await findById(pet.id);` 再返回；或至少在 `if (r.granted)` / `if (r.generated)` 分支后重读。

---

#### P2-003 · `/api/gift/daily` 空池返回 500，与需求「空池兜底文案」语义不符

| 编号 | 所在文件 |
|---|---|
| P2-003 | `src/app/api/gift/daily/route.ts`（63-77 行） |

```ts
if (result.skipReason === "already_granted_today") {
  return NextResponse.json({ ok: true, granted: false, ... });  // 200
}
return NextResponse.json(
  { ok: false, skipReason: result.skipReason, message: result.fallbackMessage ?? "..." },
  { status: 500 }  // <-- empty_pool 也走这里
);
```

需求 §3.7 要求「池空时兜底文案」，语义是"用户可看到兜底内容而非错误"。当前实现把 `empty_pool` 与真正的内部错误一视同仁返回 500。开发报告 §7.2 已自陈。虽然当前 SEED_ITEMS 有 9 项，空池路径几乎不会触发，但一旦触发（如未来 items 表被清空），用户只看到"服务器内部错误"。

**建议修复：** `empty_pool` 单独走 200 + `fallbackMessage`；真正的意外错误才 500。

---

#### P2-004 · `resolveToken` 在 `/api/sync` 与 `src/lib/auth.ts` 重复实现

| 编号 | 所在文件 |
|---|---|
| P2-004 | `src/app/api/sync/route.ts`（45-54 行）、`src/lib/auth.ts` |

阶段 4 抽取了 `src/lib/auth.ts` 供新路由复用，但 `/api/sync` 内部仍保留自己的 `resolveToken` 副本。两份实现逻辑一致，但存在双源风险。

**建议修复：** `/api/sync` 也改用 `requireAuth`；或至少抽一份公共函数。

---

#### P2-005 · `markOfferedInTx` / `markOfferInTx` 忽略 `affectedRows`

| 编号 | 所在文件 |
|---|---|
| P2-005 | `src/domain/persistence/repos/inventory.repo.ts`（159-169 行）、`src/domain/persistence/repos/pets.repo.ts`（`markOfferInTx`） |

- `markOfferedInTx` 返回 `result.affectedRows` 但调用方 `offer.ts` 未检查；若并发下另一请求已把 `offered_at` 设值，本请求仍会继续走后续 UPDATE pets / INSERT memory
- `markOfferInTx` 不返回也不检查 `affectedRows`（无 `WHERE offer_last_date < ?` 保护）
- 与 P1-003 相关，但即使修好 P1-003，本处也需补检查

---

#### P2-006 · 单测未验证 `event.params.inventory_id`，P1-002 因此漏检

| 编号 | 所在文件 |
|---|---|
| P2-006 | `tests/unit/domain/gift/daily-grant.test.ts`（第 118-131 行） |

测试检查了 `item_id` / `item_display_name` 但未检查 `inventory_id`，也未校验 DB 层事件与返回事件是否一致。若补一行

```ts
expect(result.event?.params.inventory_id).toBe(result.inventory?.id);
```

即可在 CI 阶段拦截 P1-002。

---

### P3 - 轻微问题（3 项）

#### P3-001 · `EMPTY_POOL_FALLBACK_MESSAGE` 与开发报告文案不一致

| 编号 | 所在文件 |
|---|---|
| P3-001 | `src/domain/gift/item-pool.ts`（第 130 行）、`reports/dev-report-stage4.md` §3.1 |

- 开发报告：`"今天是小圆没有小礼物的一天，但小圆还是小圆。"`
- 实际代码：`"今天小圆收到了一份没写名字的小礼物。"`

代码与单测一致，报告与代码不一致。文档修正即可，不影响功能。

---

#### P3-002 · `inventory.consumed_at` 复用为 offered_at 语义

| 编号 | 所在文件 |
|---|---|
| P3-002 | `src/domain/persistence/repos/inventory.repo.ts`（`markOfferedInTx`） |

`markOfferedInTx` 同时写入 `offered_at` 与 `consumed_at`：
```sql
UPDATE inventory SET offered_at=?, offered_event_id=?, consumed_at=?, consumed_event_id=?
```

同一 ts 写入两个字段，语义重复。开发报告 §7.1 已标注"阶段 5 拆分"。目前不影响功能，但导出/审计时会双份时间戳，属埋雷。

---

#### P3-003 · `/gifts` 页面 `offeredToday` 状态未从 API 初始化

| 编号 | 所在文件 |
|---|---|
| P3-003 | `src/app/(pet)/gifts/page.tsx`（第 78 行）、`src/app/api/inventory/route.ts` |

`offeredToday` 是 React 本地状态，页面初次加载默认为 `false`；但 API 未在 `/api/inventory` 响应里回传 `pet.offerLastDate` 或 `offeredToday` 布尔。结果：用户今日已送过后刷新页面，UI 显示所有物品为可点击，第一次点击才触发 409 + 服务端提示。开发报告 §3.9 已承认"日限一次后前端禁用所有卡片（服务端 also 校验）"，但**页面初次加载不预置已送状态**。

**建议修复（可选）：** `/api/inventory` 响应增补 `offerLastDate: pet.offerLastDate` 或 `offeredToday: boolean`；前端 load 时同步该状态。

---

## 4. 验收对齐矩阵

| 需求 | 验收点 | 状态 | 备注 |
|---|---|---|---|
| #10-1 物品池 ≥8 种 | `SEED_ITEMS[9]` + `002_seed_items.sql` 9 行 | ✅ 通过 | 加权分布合理（1.2×5 / 0.9×2 / 0.5×2） |
| #10-2 加权抽取 | `pickWeightedFromPool` 复用 `pickWeighted` | ✅ 通过 | 单测 1000 次采样验证 |
| #10-3 排除最近 3 次 | `REPEAT_WINDOW=3` + `excludeIds.slice(-3)` | ✅ 通过 | 单测覆盖 |
| #10-4 空池兜底 | `EMPTY_POOL_FALLBACK_MESSAGE` + `kind:'fallback'` | ⚠️ 部分 | 逻辑存在；`/api/gift/daily` 走 500（P2-003） |
| #10-5 每日限一次 | `pets.daily_grant_last_date` + `hasGrantedToday` | ⚠️ 存在并发漏洞 | 见 P1-003 |
| #10-6 送赠日限一次 | `pets.offer_last_date` + `hasOfferedToday` | ⚠️ 存在并发漏洞 | 见 P1-003 |
| #10-7 24h 回信 | `REPLY_DUE_MS = 24h` + `reply_due_at = now + 24h` | ✅ 通过 | 单测边界（`replyDueAt === now` → due） |
| #10-8 回信含 ≥1 记忆引用 | `generateReplyLetter` 强制注入 `item_name` ref | ✅ 通过 | 单测验证 `memoryRefs.length >= 1` |
| #10-9 退避期不主动打扰 | `isReplyDue` 检测 `nextProactiveTs > now` | ❌ 死代码 | 见 P1-001：`next_proactive_ts` 从未写入 DB |
| #10-10 回信期间不推进 `nextProactiveTs` | `markReplyClearedInTx` 不改该字段 | ✅ 通过 | SQL 只 UPDATE reply_pending / last_reply_at |
| §3.7 文案禁「打卡/签到」 | 全库 grep | ✅ 通过 | 仅代码注释 |
| §3.7 事件结构不含文案 | `daily_grant` / `offer_received` / `reply_letter` params | ✅ 通过 | 结构化字段 |
| §7 领域层零 next/react | `grep -rn` 无输出 | ✅ 通过 | |
| 契约 v1.0.1 未 bump | 复用阶段 2 三个生成器 | ✅ 通过 | `packs-contract.md` 未改 |
| 事务边界 | daily-grant 3 写、offer 4 写、reply 2 写 | ✅ 通过 | `withTransaction` 正确包裹 |
| 失败回滚 | 事务中途抛错整体 rollback | ✅ 通过 | 单测覆盖 |
| 文案兜底 | 空态文案 + 已送文案 + 空池文案 | ✅ 通过 | 措辞得体，符合「佛系纪律」 |

---

## 5. 开发报告 §7.2 遗留观察的缺陷评估

开发报告 §7.2 提出三处遗留观察，本质检的定性如下：

| 观察 | 报告表述 | 本质检定性 | 说明 |
|---|---|---|---|
| ① `findPet` 失败返回 `inventory_not_found` | "语义稍弱但可接受" | **P2-001** | 可接受但建议修：新增 `pet_not_found` 变体 |
| ② `findLatestOfferEvent` 用 `limit=1` 拿最新 offer_received | "影响可控" | ✅ 不构成缺陷 | 送赠日限一次 + `reply_pending` 状态机保证同一 pet 最多 1 条待回信 offer；最新即正确 |
| ③ `/api/gift/daily` 空池返回 500 | "按错误返回 500 惯例" | **P2-003** | 建议改为 200 + `fallbackMessage`，与需求"兜底文案"语义对齐 |

**结论：** 报告 §7.2 已诚实披露，但②③两处本应修复而非延后。

---

## 6. 与阶段 1-3 的集成检查

| 集成点 | 状态 | 说明 |
|---|---|---|
| `/api/sync` 替换 `stage_4_pending` 占位 | ✅ 已替换 | 步骤 7（replyCheck）+ 步骤 8（dailyGrant）均已接入 |
| 保留原有 catchup / backoff / timeline 行为 | ⚠️ 有隐患 | 新增 replyCheck + dailyGrant 未阻断同步；但返回的 `pet` 对象陈旧（P2-002） |
| 阶段 3 `computeBackoff` 结果 | ⚠️ 未持久化 | 见 P1-001：阶段 4 假设它已被写入 DB，实际未写入 |
| 阶段 2 三个生成器（daily-grant / offer-received / reply-letter） | ✅ 复用无改动 | 契约 v1.0.1 未 bump |
| 阶段 1 认证（Bearer + cookie） | ⚠️ 双源 | 见 P2-004：`resolveToken` 在 `/api/sync` 与 `lib/auth.ts` 重复 |
| 阶段 1 数据库迁移 | ✅ 幂等 | `002_seed_items.sql` 用 `INSERT IGNORE` |

---

## 7. 测试覆盖评估

| 维度 | 覆盖率 | 备注 |
|---|---|---|
| 单测数量 | 422 全绿 | 新增 67（gift 5 files + util/date） |
| 领域纯函数 | 高 | `pickWithExclusion` / `hasGrantedToday` / `hasOfferedToday` / `validateInventoryForOffer` / `isReplyDue` 均纯函数化，可单测 |
| 事务边界 | 中 | 单测 mock 了 `withTransaction`，验证调用顺序；但未验证真实 DB 回滚 |
| 幂等 / 并发 | **低** | 无并发测试；race condition 因此漏检（P1-003） |
| `inventory_id` 字段 | **低** | 未验证持久化后值（P1-002 因此漏检） |
| `next_proactive_ts` 端到端 | **低** | 单测 mock 了字段值，未验证写入路径（P1-001 因此漏检） |
| 空态 / 边界 | 高 | empty_pool / no_pet / not_pending / no_offer_event 全覆盖 |
| 文案禁词 | 静态 grep | 未见用户可见违规 |
| 契约 | ✅ | 复用阶段 2 生成器，未 bump 版本 |

---

## 8. 质量评估

| 维度 | 评分 | 说明 |
|---|---|---|
| 代码质量 | **良** | 纯函数设计、事务边界清晰、注释齐全；扣分项：`inventory_id` 事务后回填、`pet_not_found` 复用错误码、`resolveToken` 双源 |
| 功能完整性 | **中** | 主流程（daily_grant / offer / reply）跑通；退避联动死代码；并发幂等缺失 |
| 可维护性 | **良** | 模块边界清晰、领域零框架、文案与事件结构解耦；扣分项：P2 系列小重复 |
| 测试覆盖 | **中** | 数量足够（422）、纯函数覆盖好；集成/并发/端到端不足，因此漏掉 P1 系列 |
| 文档一致性 | **中** | dev-report 主体准确，但 §3.1 的 fallback 文案与实际不符；§7.2 遗留观察部分本应修 |
| **是否建议提交** | **否** | 需先修 P1-001 / P1-002 / P1-003 / P1-004；P2-001 ~ P2-006 视排期；P3 可选 |

---

## 9. 修复优先级建议

**Round 1 必改（阻塞提交）：**
1. **P1-001**：`/api/sync` 中把 `backoff.nextProactiveTs` 写回 `pets.next_proactive_ts`（同事务或紧随 catchup），并在 `reply.test.ts` 追加端到端测试
2. **P1-002**：`grantDailyItem` 在生成 event 前把 `inventoryId` 传入 `generateDailyGrant` ctx；删掉事务后回填；单测补 `inventory_id` 断言
3. **P1-003**：`updateDailyGrantDateInTx` / `markOfferInTx` / `markOfferedInTx` 增加条件 WHERE 子句，通过 `affectedRows` 判定幂等
4. **P1-004**：`/api/letters` 复用 `isReplyDue` 判定，或加入 `nextProactiveTs` 检查

**Round 1 建议改：**
5. **P2-001**：新增 `pet_not_found` skipReason
6. **P2-002**：sync 尾部重读 pet 再返回
7. **P2-003**：`empty_pool` 走 200 + `fallbackMessage`

**Round 2 / 阶段 6 处理：**
8. P2-004、P2-005、P2-006、P3-001、P3-002、P3-003

---

## 10. 签名

- 质检：SenseNova 6.8 Flash Lite（Round 1）
- 日期：2026-09-10
- 复验命令：`npx vitest run` / `npx tsc --noEmit` 已本地复跑通过
- 未执行 git commit/push
