# Step 2 · 反向验证（完整审计）

**审计时间**：2026-09-17
**范围**：Step 1 标注的 10 个偏差高发区（H-A ~ H-J）+ 补充场景
**方法**：极端输入 → 逐行推演执行路径（代码行级）→ 变量变化 → 最终结果

---

## H-A · FSM no-op 也更新 stateSince ⚠️ 确认缺陷

**位置**：`src/domain/fsm/pet-fsm.ts:40-42`

```ts
if (action === "no_op" || !isLegalAction(from, action)) {
  return { state: from, stateSince: now, changed: false };
}
```

文档语义：「`stateSince` 状态最近一次变更的时间（UTC ms）」。但 no-op / 非法动作分支**无条件返回 `stateSince: now`**，即使状态完全没变。

### 场景 A1：长期缺席补算（全部 no-op 事件）

**触发点**：pet 状态 `at_home`，`stateSince = day0`；用户离线 10 天 → sync。

**执行路径**：
1. `planner.planCatchUp`：`offlineMs=10d`；`recentWindow=7d`；`recentDays=7`；`oldSpan=3d>0` → aggregate。
   - `normalCount = min(7×1, 19) = 7`；`distributeTs(day3, day10, 7)`：`spacing=7d/8=21h`
   - normal ts：day3+21h, day3+42h, …, day3+147h≈day9.125
2. `executor` 循环 7 条：若抽到的类型全部是 no-op（watching_water / counting_leaves / self_talk / spontaneous_letter——占 6 类中的 4 类，概率 (4/6)^7≈5.9%，且部分抽到 outing/brought 时状态会变化，但只要有 no-op 事件 stateSince 就被推进）
   - 每条 `transition(at_home, no_op, ts_i)` → 返回 `{state:at_home, stateSince: ts_i}`
3. `updateStateAndActivityInTx(conn, pet.id, at_home, day9.125, day10, day0)` 落库

**变量变化**：`stateSince`: day0 → day3.875 → day4.8 → … → **day9.125**

**最终结果**：DB `state_since=day9.125`。UI（profile 页 L200）显示「状态于 昨天 起」。实际状态从 day0（10 天前）起一直是 at_home，未曾变更。

### 场景 A2：行为不一致（dev endpoint vs catchup）

**触发点**：`POST /api/pet/generate-event` 手动触发 no-op 事件（self_talk）。

**执行路径**：
- generate-event route L129-132：`if (output.nextState !== pet.state) { await updatePetState(...) }` → no-op 时**不写库**，`stateSince` 保持 ✅
- 但 catchup executor L178 **无条件** `updatePetInTransaction(...)` → no-op 时也写库，`stateSince` 被推进 ❌

**最终结果**：同一 no-op 事件，开发端点不改变 stateSince，补算路径改变 stateSince。**同一语义两种行为**。

### 判定

| 项 | 结果 |
|----|------|
| 影响 | profile「状态始于 X」字面失真；语义与文档「状态最近一次变更时间」不符 |
| 严重性 | 🟠 中等 |
| 可能意图 | 把 stateSince 当作「最近一次活跃」时钟（每次事件刷新状态时间）——但文档未声明，且 dev/catchup 不一致 |
| 修复方向 | ① no-op 保持原 stateSince；② 或统一语义并写文档，两路径一致 |

---

## H-B · planner 随机类型绕过引擎状态过滤 ⚠️ 确认缺陷

**位置**：`planner.ts CANDIDATE_TYPES`（固定 6 类，含 outing/brought_item）+ `executor.ts forceType` + `engine.ts L55-57`

```ts
// engine.ts
if (opts.forceType) {
  type = opts.forceType as EventTypeValue;   // ← 绕过 pickRandomTypesByState
}
```

### 场景 B1：宠物散步中（out_walking）补算抽到 outing

**触发点**：上次 sync 结束时 pet 状态 `out_walking`（出门未归），离线 10 天。

**执行路径**：
1. planner 随机抽类型，第 2 条抽到 `outing`
2. `executor` → `generateNextEvent(forceType:"outing")`：**不走** `pickRandomTypesByState`（该函数在 out_walking 下已排除 outing，P2-005 修复）
3. `generateOuting` 返回 `fsmAction:"outing_start"` → `transition(out_walking, outing_start)` → **非法 → no-op**，状态保持 out_walking
4. 事件仍入库：时间线出现第二条/第三条「出门散步 · 河边」，但 pet 本就在散步中

**最终结果**：散步中反复「又出门」；FSM 无变化，事件语义重复。P2-005 的排除被补算路径绕过。

### 场景 B2：在家（at_home）补算抽到 brought_item

**触发点**：pet `at_home`，离线 10 天，计划 7 条常规 + 1 聚合，第 3 条抽到 `brought_item`。

**执行路径**：
1. `generateBroughtItem`（brought-item.ts L82）无条件返回 `fsmAction:"outing_end"`
2. `transition(at_home, outing_end)` → **非法 → no-op**，状态保持 at_home
3. 事件仍入库：时间线出现「带回来一片枯叶」——**但 pet 从未出门**
4. 后续若再抽到 outing → 出门 → 抽到 brought_item → 归来，语义才闭环

**最终结果**：确认缺陷。需求 §3.3/契约 §brought_item 定义「带回物品=散步结束的自然产物」，但补算随机路径可产生「无出门的带回物品」孤立事件。brought-item.ts 注释自认「若 pet 不在 out_walking，FSM 当作 no-op，但事件仍会入库」。

### 场景 B3：旅行中（on_trip）抽到 outing/brought_item

**触发点**：pet `on_trip`（当前 MVP 无旅行玩法，仅数据结构存在），补算抽到 outing 或 brought_item。

**执行路径**：
- `transition(on_trip, outing_start)` 非法 → no-op；`transition(on_trip, outing_end)` 非法 → no-op
- 事件入库，语义为「旅行中又出门散步」「旅行中带回了物品」

**最终结果**：同上，除非规划器按状态过滤，否则会产生语义矛盾事件。

### 判定

| 项 | 结果 |
|----|------|
| 影响 | 补算事件序列与 FSM 状态脱节，「无出门带回物品」「散步中又出门」矛盾事件可复现 |
| 严重性 | 🟠 中等（产品语义瑕疵，不崩溃；事件结构/契约合法） |
| 根因 | planner 是纯函数、产生计划时不推演状态；executor 用 forceType 逐条生成但 planner 的类型选择与 FSM 状态无耦合 |
| 修复方向 | ① executor 生成时按当前 state 过滤类型（复用 `pickRandomTypesByState`）；② planner 移入引擎决策；③ 至少把 brought_item 在 at_home 时映射为可接受的灰故事（改文案兜底） |

---

## H-C · brought-item fsmAction=outing_end 无条件声明

**位置**：`brought-item.ts L82`

**场景 C1**：B2 已覆盖（at_home 下产生孤立带回事件）。此处补推演生成器内部：

- `generateBroughtItem` 不读 `pet.state`，直接返回 `outing_end`
- 依赖 FSM 兜底为 no-op，但事件内容已生成（「带回 + item_name 记忆引用」）
- `memoryRefs` 无状态关联，未来若做「出门次数↔带回次数」统计会出现「带回 > 出门」

**判定**：🟡 轻微（承接 H-B 的生成器层面根因；单独看是知情设计，但与需求契约的「散步归来」语义冲突时无兜底文案）

---

## H-D · sync 响应不含当次生成的 reply/grant 事件

**位置**：`sync/route.ts` L160（events 查询）vs L196/L225（reply/grant 在之后执行）

**场景 D1**：首日登录，`grantDailyItem` granted=true 返回 itemId/displayName → 欢迎卡片显示 ✅；但**响应 events 数组中没有 daily_grant 事件**，时间线要等**下次** sync/刷新才出现。

**场景 D2**：`checkAndGenerateReply` 生成回信后，时间线本页不含回信事件；刷新后可见。

**判定**：🟡 体验/设计。欢迎卡数据独立透出，无功能性缺失；但「馈赠事件当次不可见」可能让用户困惑（卡片说收到浆果，时间线却没有）。若前端处理欢迎卡与时间线的一致性可接受；建议在响应中标注 `pendingTimelineEntries` 或在 docs 中明确「事件下次刷新可见」。

---

## H-E · created_today 边界 ✅ 验证通过

**位置**：`daily-grant.ts` L143；`date.ts toLocalDateStr`（硬编码 UTC+8 + UTC getter）

**场景 E1**：23:59:59.900 创建 pet，00:00:00.100 首次登录。
- `toLocalDateStr(createdAt)=D`，`todayStr=D+1` → 不相等 → **发放馈赠** ✅（符合「首馈赠 T+1」）

**场景 E2**：服务器部署在非 +8 时区主机。
- `toLocalDateStr` 用 `ts + 8h` 再取 `getUTC*` → 与宿主时区无关 ✅

**场景 E3**：创建当天立即登录。
- `toLocalDateStr(createdAt) === todayStr` → skip `created_today` ✅

**判定**：✅ 通过，无缺陷。注意点：跨日毫秒边界已正确。

---

## H-F · 回信引用最近 offer 物品

**位置**：`reply.ts` L135-140 `findByPetAndType("offer_received", 1)`（ts DESC）

### 场景 F1：多次送赠未回

**触发点**：用户 T1 送 A（pending=1, due=T1+24h），T2 未回信又送 B（T2>T1+24h，offer_last_date 重置 → `markOfferInTx` 覆盖 reply_due_at=T2+24h）。

**执行路径**：
1. `isReplyDue`：pending=1，due=T2+24h，now>T2+24h → due
2. `findByPetAndType` 返回 ts 最大一条 = **B 的 offer 事件**
3. 回信引用 B 的物品 ✅（关联正确——因为 markOfferInTx 会覆盖 dueAt，最近 offer 即当前 pending 关联）
4. **A 的 offer 永不产生回信**（pending 是单槽位）— 用户送了两件只收到一封回信

**判定**：🟠 部分通过。物品关联正确，但「多次送赠仅回最近一件」符合单槽位设计（需求 §3.7「每天限一次」）；建议产品确认是否接受 A 永久无回信。

### 场景 F2：offer 事件无 item_display_name（老数据）

**触发点**：老 offer 事件 `params` 无 `item_display_name`。

**执行路径**：reply.ts L151 从 `memories(item_received)` 取**最新一条**兜底 ✅；但若 memories 也没有 → `no_item_name` skip，pending 保留 → **永不回信、每次 sync 重试**（生成器每次都会走到 no_item_name；`generated=false` 不消耗 pending）。

**判定**：🟡 轻微。数据缺失时回信永久停摆，但属脏数据场景；建议日志+人工可查（console.error 已有）。

---

## H-G · 聚合事件 ts 与 normal 排序 ✅ 验证通过

**位置**：`executor.ts` L164-171；`planner.ts`

**推演**：
- `plan.aggregate.toTs = oldEnd = recentStart`（= toTs-7d）
- normal 首条 = `recentStart + spacing`（spacing>0）→ **aggregate.ts < normal[0].ts**
- DB `ORDER BY ts DESC`（events.repo L143）→ 聚合按 ts 排在 normal 之前（更早）✅ 符合「过去 X 天入口卡片」位置
- `findByPetId` limit 20：7 天窗口内事件数 ≤20 时聚合可见 ✅

**判定**：✅ 通过，无缺陷。

---

## H-I · season 确定性依赖 lines 长度 ✅ 有条件通过

**位置**：`season.ts` L60 `lines[stableHash(event.id) % lines.length]`

**推演**：同 event.id 且素材包**未变更** → 结果恒定 ✅。素材包更新（lines 数组增删）→ 历史事件 tone 漂移（属于素材包升级的整体预期，非缺陷）。已知低概率碰撞：不同 id 的 `% lines.length` 可能相同（UI 上显示重复 tone，无正确性影响）。

**判定**：✅ 有条件通过。确定性在当前包版本内成立。

---

## H-J · sync 失败吞异常 ✅ 验证通过（设计内）

**位置**：`sync/route.ts` catchup/reply/grant 三处 try-catch

**推演**：
- catchup 失败 → `catchupSkipped="catchup_error"`，改为下次同步重试（文档已声明）✅
- reply/grant 失败 → `skipped:"error"`,不阻断响应 ✅
- 事务内失败由 `withTransaction` 保证整体 rollback，不会出现半份数据 ✅
- 唯一残留：DB 完全故障时用户收到 `ok:true` + 空/旧时间线，前端无错误提示。属可接受降级。

**判定**：✅ 通过，符合「故障不阻断主流程」设计。

---

## 追加推演：K-A · create-pet 初始事件与首日同步

**触发点**：创建 pet 时初始事件 ts 倒推 6-48h（create/route.ts L63-83），`offline_start_ts` 创建时**未写入**（INSERT L68-74 无该字段 → NULL）。

**执行路径**：
1. 创建后首日 sync：`planCatchUp` — `lastActivityTs=创建时`，`toTs=now`（分钟级差）→ `offlineMs≈0` → `plan.total=0`
2. `offlineStartTs` 响应 = `freshForResponse?.offlineStartTs ?? null` = **NULL**
3. 前端 `splitEventsByTs`：`hasBoundary=false` → 全部归 `past`（「更早之前」分组）——**首日所有初始事件+初见事件都显示在「更早之前」**

**判定**：🟠 体验问题（非崩溃）。首日创建后用户打开时间线，所有新事件被划入历史分组，观感异常。修复方向：创建时写 `offline_start_ts = createdAt`，或前端对 `null` 边界视为「全部 fresh」。

---

## 缺陷清单汇总（Step 2 产出）

| ID | 级别 | 摘要 | 位置 |
|----|------|------|------|
| **D-01** | 🟠 | no-op 事件也推进 `stateSince`，与文档语义不符；dev 端点与 catchup 行为不一致 | `pet-fsm.ts:40` / `executor.ts:178` |
| **D-02** | 🟠 | 补算 forceType 绕过状态过滤，「无出门带回」「散步中又出门」事件可复现 | `engine.ts:55` / `planner.ts` / `brought-item.ts:82` |
| **D-03** | 🟠 | 创建首日 `offline_start_ts=NULL`，全部初始事件落入「更早之前」分组 | `create/route.ts` / `timeline-split.ts` |
| **D-04** | 🟡 | 多次送赠仅回最近一件，早期 offer 永久无回信（单槽位设计待确认） | `reply.ts:135` |
| **D-05** | 🟡 | 当次 sync 的 reply/grant 事件不在响应 events 内，时间线需刷新才见 | `sync/route.ts` |
| **D-06** | 🟡 | offer 事件缺 item_display_name 且无 memories 时回信永久停摆重试 | `reply.ts:151` |
| ✅ | — | H-E / H-G / H-I / H-J 验证通过，无缺陷 | — |

> 以上推演均基于代码现行实现逐行跟踪；无模糊词。请确认推定结论后进入 Step 3（自证测试）。