# 修复报告 · 阶段 4 · Round 1

> 对应质检报告：`reports/qa-round-1-stage4.md`
> 修复范围：P1×4（阻塞提交）+ P2×6（建议）+ P3×1（可选）
> 修复日期：2026-09-10
> 约束：不改契约版本（v1.0.1）、领域层零框架、不执行 git commit

---

## 1. 本地验证命令（实际执行）

```bash
$ npx tsc --noEmit
# 无输出（0 错误）

$ npx vitest run
 Test Files  36 passed (36)
      Tests  433 passed (433)   # 基线 422 → 433（新增 11 项）

$ npm run build
# EXIT: 0
# 23 个 routes 全部编译通过
```

新增测试：
- `tests/unit/persistence/pets-backoff.test.ts`（新文件，3 项）
- `tests/unit/domain/gift/daily-grant.test.ts`（+3 项：并发幂等、inventory_id 断言）
- `tests/unit/domain/gift/offer.test.ts`（+4 项：pet_not_found、markOffer 并发、markOffered 并发）
- `tests/unit/domain/gift/reply.test.ts`（+3 项：P1-001 集成行为——离开 3 天退避、退避结束、退避期内正常）

---

## 2. 修复清单

### P1-001 · `next_proactive_ts` 从未写入 DB（死代码）

| 项 | 修复前 | 修复后 |
|---|---|---|
| `/api/sync` 计算 backoff 后 | 只返回给客户端，DB 中 `next_proactive_ts` 恒为 NULL | 调用 `updateNextProactiveTs(pet.id, backoff.nextProactiveTs)` 写回 DB |
| `reply.ts::isReplyDue` 的 `backoff_active` 分支 | 生产环境死代码 | 生效：读到的 `nextProactiveTs` 来自 `/api/sync` 最近一次写入 |

**变更文件：**
- `src/domain/persistence/repos/pets.repo.ts` — 新增 `updateNextProactiveTs(petId, ts, when)`
- `src/app/api/sync/route.ts` — 在 catchup 后写回 `next_proactive_ts`（仅当非 null 时写，缺席 <24h 时跳过）

**语义决策：**
- 写库时机：catchup 事务提交后、replyCheck 之前（这样 reply.ts 读到 fresh 值）
- 写库错误处理：try/catch 不阻断同步（写失败只影响退避联动，不影响 catchup/reply/grant 本身）
- 缺席 <24h 时 `nextProactiveTs=null`：跳过 UPDATE（节省每日登录的写库）

**测试：**
- `tests/unit/persistence/pets-backoff.test.ts`（新增，3 项）— 验证 SQL/参数正确写入
- `tests/unit/domain/gift/reply.test.ts`（+3 项"P1-001 集成行为"）— 端到端覆盖「离开 3 天 → nextProactiveTs=now+7d → backoff_active」场景

---

### P1-002 · `daily_grant` 事件 `inventory_id` 事务后回填

| 项 | 修复前 | 修复后 |
|---|---|---|
| `grantDailyItem` 生成 event 的时机 | 先生成 event（`inventory_id=null`）→ 事务内写 → 事务后回填 | 先生成 `inventoryId` → 传入 `generateDailyGrant({...ctx, inventoryId})` → 事务内写（DB 与返回值完全一致） |
| 事务后手工 `event.params.inventory_id = inventoryId` | 存在 | 已删除 |

**变更文件：**
- `src/domain/gift/daily-grant.ts` — 重排生成顺序 + 删除事务后回填

**测试：**
- `tests/unit/domain/gift/daily-grant.test.ts` — 关键断言新增：
  ```ts
  expect(result.event?.params.inventory_id).toBe(result.inventory?.id);
  expect(result.event?.params.inventory_id).not.toBeNull();
  ```
  该断言在 CI 阶段即可拦截 P1-002（P2-006 建议）。

---

### P1-003 · 并发请求下 daily-grant / offer 的幂等

| 函数 | 修复前 | 修复后 |
|---|---|---|
| `updateDailyGrantDateInTx` | `WHERE id = ?`（无条件覆盖） | `WHERE id = ? AND (daily_grant_last_date IS NULL OR daily_grant_last_date < ?)`；返回 `affectedRows` |
| `markOfferInTx` | `WHERE id = ?`（无条件覆盖） | `WHERE id = ? AND (offer_last_date IS NULL OR offer_last_date < ?)`；返回 `affectedRows` |
| `markOfferedInTx` | `WHERE id = ?` | `WHERE id = ? AND offered_at IS NULL`；返回 `affectedRows`（已有，仅补 WHERE） |
| `grantDailyItem` | 无条件 UPDATE → 可能双写 | UPDATE 后 `affectedRows===0` → 抛 `IdempotencyError("already_granted_today")` → withTransaction rollback → 返回 `already_granted_today` |
| `offerInventoryItem` | 事务内 4 写无幂等保护 | `markOfferInTx` 是第一道门（affectedRows=0 → 抛 `already_offered_today`，markOffered 与 insertEvent/insertMemory 都不会被调用）；`markOfferedInTx` 是第二道门（affectedRows=0 → `inventory_already_offered`） |

**变更文件：**
- `src/domain/persistence/repos/pets.repo.ts` — `updateDailyGrantDateInTx` 加条件 WHERE + 返回 `affectedRows`；`markOfferInTx` 加条件 WHERE + 返回 `affectedRows`
- `src/domain/persistence/repos/inventory.repo.ts` — `markOfferedInTx` 加 `AND offered_at IS NULL`
- `src/domain/gift/daily-grant.ts` — 新增内部 `IdempotencyError`；try/catch 捕获 rollback 后返回 `already_granted_today`
- `src/domain/gift/offer.ts` — 新增内部 `IdempotencyError`；`markOfferInTx` 优先判定，`markOfferedInTx` 二道门

**测试：**
- `tests/unit/domain/gift/daily-grant.test.ts`（+2 项并发测试）：
  - `affectedRows=0 → already_granted_today`（并发另一请求已处理今日）
  - `affectedRows=1 → granted=true 且 inventory_id 写入`
- `tests/unit/domain/gift/offer.test.ts`（+3 项并发测试）：
  - `markOfferInTx affectedRows=0 → already_offered_today`（含 `expect(markOfferedInTx).not.toHaveBeenCalled()` 断言第一道门早退）
  - `markOfferInTx=1 但 markOfferedInTx=0 → inventory_already_offered`
  - 正常写入验证

---

### P1-004 · `/api/letters` 的 `pendingReply.due` 与领域 `isReplyDue` 不一致

| 项 | 修复前 | 修复后 |
|---|---|---|
| `/api/letters` 的 `due` 判定 | `pet.replyPending && pet.replyDueAt !== null && pet.replyDueAt <= now`（无退避检查） | 复用 `isReplyDue(pet, now).due`（含 nextProactiveTs 退避检查） |
| 额外返回 | 无 | 增加 `skipReason` 字段（观测用，due=true 时为 undefined） |

**变更文件：**
- `src/app/api/letters/route.ts` — 抽出领域判定，不再本地复制逻辑

**效果：**
- 退避期时 `/api/letters` 返回 `due=false, skipReason="backoff_active"`，UI 与 sync 行为一致（不会出现「文案承诺已写好信但 sync 后看不到」的情况）

**测试：** 沿用 `tests/unit/domain/gift/reply.test.ts` 中的 `isReplyDue` 单测覆盖；`/api/letters` 直接复用领域函数，不需要新增 route 层单测。

---

### P2-001 · `offer.ts` 中 pet 不存在时错误的 `skipReason`

| 项 | 修复前 | 修复后 |
|---|---|---|
| `offerInventoryItem` 无 pet | `skipReason: "inventory_not_found"`（语义错） | `skipReason: "pet_not_found"`（新增变体） |
| `OfferSkipReason` 联合类型 | 无 `pet_not_found` | 新增 `"pet_not_found"` 变体 |

**变更文件：**
- `src/domain/gift/offer.ts` — 新增 `pet_not_found` 变体 + 更新无 pet 分支

**测试：**
- `tests/unit/domain/gift/offer.test.ts` — 已有测试「pet 不存在 → 提前返回 offered=false」更新断言 `skipReason='pet_not_found'`

---

### P2-002 · `/api/sync` 响应返回陈旧 pet 对象

| 项 | 修复前 | 修复后 |
|---|---|---|
| 响应中的 `pet` 字段 | 第 63 行 `findByUserId` 读取的旧对象 | 事务尾部再次 `findPetById(pet.id)` 重读，返回 fresh 对象 |
| `grantDailyItem({ pet })` 输入 | 陈旧 pet（catchup 后未刷新） | catchup 后 `Object.assign(pet, fresh)` 更新本地引用；daily-grant 前再重读一次 |
| timeline 读取 | 使用 catchup 前的 `pet.lastActivityTs`（可能陈旧） | catchup 后重读，timeline 用 fresh pet |

**变更文件：**
- `src/app/api/sync/route.ts` — 三处重读 pet：catchup 后、grant 前、响应前

---

### P2-003 · `/api/gift/daily` 空池返回 500

| 项 | 修复前 | 修复后 |
|---|---|---|
| `empty_pool` 响应 | 500 + `{ ok: false }` | 200 + `{ ok: true, granted: false, skipReason: "empty_pool", fallbackMessage }` |
| 语义 | 与真正内部错误一视同仁 | 用户可看到兜底文案，符合需求 §3.7「空池兜底」语义 |

**变更文件：**
- `src/app/api/gift/daily/route.ts` — `empty_pool` 单独走 200 分支

**测试：** 沿用 domain 层 `empty_pool` 单测；route 层未直接单测（依赖 mysql），代码可读验证。

---

### P2-004 · `resolveToken` 在 `/api/sync` 与 `lib/auth.ts` 重复

| 项 | 修复前 | 修复后 |
|---|---|---|
| `/api/sync` 认证 | 本地 `resolveToken` + `verifyToken` 双步 | 改用 `requireAuth(req)`（复用 lib/auth.ts） |
| `resolveToken` 副本 | `/api/sync` 内 12 行本地实现 | 已删除 |

**变更文件：**
- `src/app/api/sync/route.ts` — 删除本地 `resolveToken`，改用 `requireAuth`；`session` 改为 `{ userId: auth.userId }` 结构（保持后续代码最小改动）

**契约影响：** 无——`lib/auth.resolveToken` 与本地版本完全一致（Bearer 优先，回退 cookie），错误码也是同款。

---

### P2-005 · `markOfferedInTx` / `markOfferInTx` 忽略 `affectedRows`

已随 P1-003 一并修复（条件 WHERE + `affectedRows` 检查）。

---

### P2-006 · 单测未验证 `event.params.inventory_id`

已随 P1-002 一并补上：
```ts
expect(result.event?.params.inventory_id).toBe(result.inventory?.id);
expect(result.event?.params.inventory_id).not.toBeNull();
```

---

### P3-001 · `EMPTY_POOL_FALLBACK_MESSAGE` 与开发报告文案不一致

| 项 | 修复前 | 修复后 |
|---|---|---|
| `reports/dev-report-stage4.md` §3.1 表述 | "今天是小圆没有小礼物的一天，但小圆还是小圆。" | "今天小圆收到了一份没写名字的小礼物。"（与实际代码一致） |

**变更文件：**
- `reports/dev-report-stage4.md` — 文档文案修正（不改代码）

---

### P3-003 · `/gifts` 页面 `offeredToday` 未从 API 初始化

| 项 | 修复前 | 修复后 |
|---|---|---|
| `/api/inventory` 响应 | 不含 offerLastDate / offeredToday | 新增 `offerLastDate` + `offeredToday` 字段 |
| `/gifts` 页面初次加载 | `offeredToday=false`（默认），首次点击才触发 409 + 提示 | 从 API 响应预置 `offeredToday`，页面初次加载即正确禁用 |

**变更文件：**
- `src/app/api/inventory/route.ts` — 新增 `offerLastDate`、`offeredToday` 字段
- `src/app/(pet)/gifts/page.tsx` — 更新 `InventoryResponse` interface；load 后 `setOfferedToday(json.offeredToday)`

---

## 3. 未修复项（明确说明）

| 编号 | 说明 |
|---|---|
| P2-004 | 已修复（本轮） |
| P3-002 `inventory.consumed_at` 复用为 offered_at 语义 | 未修复：阶段 5 计划拆分，本轮不动数据模型 |

**约束遵守情况：**
- ✅ 契约版本未 bump（仍 v1.0.1）
- ✅ 领域层零框架：`grep -rn "from 'next\|from 'react" src/domain/` 无输出
- ✅ 未执行 git commit/push

---

## 4. 变更文件清单

### 领域层
- `src/domain/gift/daily-grant.ts` — P1-002（inventoryId 提前生成）、P1-003（IdempotencyError + try/catch）
- `src/domain/gift/offer.ts` — P2-001（pet_not_found）、P1-003/P2-005（IdempotencyError + 双门 affectedRows）

### 持久化层
- `src/domain/persistence/repos/pets.repo.ts` — 新增 `updateNextProactiveTs`（P1-001）；`updateDailyGrantDateInTx` 加条件 WHERE + 返回 affectedRows（P1-003）；`markOfferInTx` 加条件 WHERE + 返回 affectedRows（P1-003）
- `src/domain/persistence/repos/inventory.repo.ts` — `markOfferedInTx` 加 `AND offered_at IS NULL`（P1-003/P2-005）

### API 层
- `src/app/api/sync/route.ts` — P1-001（写回 nextProactiveTs）、P2-002（三处重读 pet）、P2-004（requireAuth）
- `src/app/api/letters/route.ts` — P1-004（复用 isReplyDue）
- `src/app/api/gift/daily/route.ts` — P2-003（empty_pool 200）
- `src/app/api/inventory/route.ts` — P3-003（回传 offeredToday / offerLastDate）

### UI
- `src/app/(pet)/gifts/page.tsx` — P3-003（initialState 同步 offeredToday）

### 文档
- `reports/dev-report-stage4.md` — P3-001（fallback 文案修正）

### 测试
- `tests/unit/persistence/pets-backoff.test.ts` — 新增（P1-001 持久化验证，3 项）
- `tests/unit/domain/gift/daily-grant.test.ts` — 补 inventory_id 断言 + 并发幂等（P1-002、P1-003、P2-006，+3 项）
- `tests/unit/domain/gift/offer.test.ts` — 更新 pet_not_found 断言 + 并发幂等（P2-001、P1-003，+4 项）
- `tests/unit/domain/gift/reply.test.ts` — P1-001 集成行为（离开 3 天退避联动，+3 项）

---

## 5. 验收对齐复核

| 需求 | 阶段 4 QA 状态 | 本轮修复后 |
|---|---|---|
| #10-4 空池兜底文案 | ⚠️ /api/gift/daily 走 500（P2-003） | ✅ 200 + fallbackMessage |
| #10-5 每日限一次 | ⚠️ 并发漏洞（P1-003） | ✅ 条件 UPDATE + affectedRows 判定 |
| #10-6 送赠日限一次 | ⚠️ 并发漏洞（P1-003） | ✅ 同上 + 二道门 |
| #10-9 退避期不主动打扰 | ❌ 死代码（P1-001） | ✅ next_proactive_ts 已持久化，isReplyDue backoff_active 生效 |
| 事件结构数据一致性 | — | ✅ daily_grant 事件 inventory_id 与 DB 一致（P1-002） |
| UI 与领域一致性 | — | ✅ /api/letters 复用 isReplyDue（P1-004） |
| UI 初始状态正确 | — | ✅ /gifts 首次加载预置 offeredToday（P3-003） |

---

## 6. 签名

- 修复：Software Engineer（Round 1）
- 日期：2026-09-10
- 验证命令：`npx tsc --noEmit`（0 错误）、`npx vitest run`（433 全绿）、`npm run build`（exit 0）
- 未执行 git commit/push
