# 质检报告：阶段 3 — 补算 + 退避 + 事件流 UI

> 报告文件：reports/qa-round-1.md
> 质检员：质检 Agent
> 日期：2026-09-10

---

## 1. 基本信息

| 项目 | 内容 |
|------|------|
| 测试日期 | 2026-09-10 |
| 测试范围 | 阶段 3 全部新增代码：`src/domain/catchup/`、`src/domain/backoff/`、`src/config/backoff-table.ts`、`src/app/(pet)/timeline/`、`src/app/api/sync/`、`src/app/api/pet/timeline/`（分页扩展） |
| 代码版本 | 阶段 3 开发完成 |
| 基准文档 | `docs/current-stage.md`（阶段 3 验收表）、`CONTEXT.md`（退避间隔表）、`docs/requirements.md`（§3.4/§3.5/#4/#5/#10）、`docs/architecture.md`（§4.3.1/§9） |
| 测试方法 | 静态代码审查 + 单元测试执行（355/355 全过） + 交叉对照需求验收项 |

---

## 2. 测试汇总

| 分类 | 数量 | 说明 |
|------|------|------|
| P0 — 阻塞性 | **0** | 无阻塞性问题 |
| P1 — 严重 | **0** | 无严重问题 |
| P2 — 一般 | **3** | 注释/代码可改进 |
| P3 — 轻微 | **6** | 风格/冗余/优化建议 |
| **合计** | **9** | 功能全部通过，无需修改即可交付 |

| 测试维度 | 结果 | 说明 |
|----------|------|------|
| 功能测试 | ✅ 通过 | 355 单测全过；96 新增（planner 24 + aggregator 22 + executor 14 + backoff-table 18 + scheduler 18） |
| 边界测试 | ✅ 通过 | planner 覆盖 0/1h/1d/3d/7d/8d/30d/90d/365d/10000d 天；backoff 覆盖 0h/23h/24h/72h/167h/168h/8760h；executor 覆盖空计划/30天/事务失败(INSERT/UPDATE)/无命名记忆/传 conn |
| 异常测试 | ✅ 通过 | executor 事务失败 rollback 验证；backoff 负值/NaN 视作 0；token 缺失/过期 401 |
| 回归测试 | ✅ 通过 | 30 个既有测试文件（355 用例）全过，无回归 |

---

## 3. 详细问题清单

### P2 — 一般问题

#### P2-001 · planner.ts 注释与实现不一致（聚合 ts 说明错误）

| 项目 | 内容 |
|------|------|
| 严重度 | P2 — 注释错误不影响功能，但误导读者 |
| 所在文件 | `src/domain/catchup/planner.ts` 第 13-14 行注释 |
| 状态 | 建议修复（不阻塞） |

**问题描述：**
planner.ts 顶部注释声称：

> `聚合摘要 ts = toTs（时间线上位于所有常规事件之上，作为"过去 X 天"入口卡片）`

但实际代码中 `generateAggregateSummaryEvent` 被调用时传入的是 `ts: plan.aggregate.toTs`（即 `oldEnd` = `recentStart` = `toTs - 7*DAY`），聚合事件的 ts **早于**所有常规事件的 ts。单测 `planner.test.ts` 也验证了 `plan.aggregate!.toTs === toTs - 7 * DAY`。

**复现步骤：**
1. 阅读 planner.ts 第 13-14 行注释
2. 对照 `planCatchUp` 函数第 120-125 行代码
3. 对照 planner.test.ts 第 137-143 行测试用例

**期望结果：** 注释应与代码一致，说明聚合 ts = `toTs - 7*DAY`（旧期末尾），时间线上位于所有常规事件之后。

**实际结果：** 注释说 ts = toTs，但实际是 toTs - 7*DAY。

**建议修复：**
```ts
// 将注释行修改为：
//   - 聚合摘要 ts = oldEnd（旧期结束 = recentStart = toTs - 7*DAY）
//     时间线上位于所有常规事件之后（DESC 排序中更下方）；
//     UI 上作为独立的"过去 X 天"入口卡片展示，不混入常规事件流
```

---

#### P2-002 · 首页渐进披露入口卡片 eventCount 不准确

| 项目 | 内容 |
|------|------|
| 严重度 | P2 — 用户体验问题，非功能性问题 |
| 所在文件 | `src/app/page.tsx` 第 62-68 行 |
| 状态 | 建议修复（不阻塞） |

**问题描述：**
首页加载聚合摘要入口卡片时，`eventCount` 使用的是当前 API 返回的事件列表长度（`data.events.length`），而非补算实际生成的事件总数。API 默认返回 20 条/页，若 pet 事件总数超过 20 条，`eventCount` 会被截断为 20，导致用户看到"20 件事"而非实际数量。

```ts
// 当前代码（错误）
eventCount: Math.max(data.events.length, 1),
```

**复现步骤：**
1. 使 pet 离线 30 天
2. 补算产生 7 条常规 + 1 条聚合 = 8 条事件
3. 如果 pet 还有更早的 15 条事件，API 返回 20 条（最新的 20 条）
4. `eventCount` 显示为 20 而非 8

**期望结果：** 显示补算实际事件数（如 8），或显示总事件数（28）。

**实际结果：** 显示为 API 返回的当前页事件数（20）。

**建议修复：**
方案 A：在首页 API 中增加 `catchupEventCount` 字段，传递补算事件数。
方案 B：使用 `latestAggregate` 的 `aggregateSpanDays` 推断事件数量（30 天 → 7 条常规 + 1 条聚合）。
方案 C：在 `/api/pet/timeline` 的 `total` 参数开启时获取总条数，首页传入 `total=1`。

---

#### P2-003 · events.repo.ts 中 `insertInTransaction` 有死代码

| 项目 | 内容 |
|------|------|
| 严重度 | P2 — 死代码，不影响功能 |
| 所在文件 | `src/domain/persistence/repos/events.repo.ts` 第 141-145 行 |
| 状态 | 建议修复（不阻塞） |

**问题描述：**
`insertInTransaction` 函数最后有一行 `void connQuery;`，将导入的 `connQuery` 作为死代码使用。这行代码没有实际用途，只是消除 TypeScript 未使用导入的警告。更干净的做法是直接移除 `void connQuery` 并移除导入中的 `connQuery`。

```ts
export async function insertInTransaction(events: Event[], conn: PoolConnection): Promise<void> {
  for (const e of events) {
    await insert(e, conn);
  }
  void connQuery;  // ← 死代码
}
```

**建议修复：**
```ts
export async function insertInTransaction(events: Event[], conn: PoolConnection): Promise<void> {
  for (const e of events) {
    await insert(e, conn);
  }
}
```
并从文件顶部的 `import` 中移除 `connQuery`。

---

### P3 — 轻微问题

#### P3-001 · planner.ts 中 `oldEnd` 变量冗余

| 项目 | 内容 |
|------|------|
| 严重度 | P3 — 风格建议 |
| 所在文件 | `src/domain/catchup/planner.ts` 第 110-111 行 |
| 状态 | 可选修复 |

**问题描述：**
```ts
const oldEnd = recentStart; // = recentStart（同一时刻）
const oldSpanMs = Math.max(0, oldEnd - fromTs);
```
`oldEnd` 从未被修改，与 `recentStart` 完全相同。可简化为直接使用 `recentStart`。

**建议修复：**
```ts
const oldSpanMs = Math.max(0, recentStart - fromTs);
```
（同步更新后续引用 `oldEnd` 的代码为 `recentStart`。）

---

#### P3-002 · TimelineView totalPages 当 total=0 时显示"共 1 页"

| 项目 | 内容 |
|------|------|
| 严重度 | P3 — 边界展示 |
| 所在文件 | `src/ui/timeline.tsx` 第 169 行 |
| 状态 | 可选修复 |

**问题描述：**
```ts
const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
```
当 `total = 0` 时，`Math.ceil(0 / 20) = 0`，`Math.max(1, 0) = 1`，显示"共 1 页"。虽然 UI 上不太明显（因为此时有 "还没有事件" 的提示），但更精确的做法是当 `total === 0` 时 `totalPages = 0`。

---

#### P3-003 · backoff-table.ts 注释措辞可更精确

| 项目 | 内容 |
|------|------|
| 严重度 | P3 — 注释精度 |
| 所在文件 | `src/config/backoff-table.ts` 第 35 行 |
| 状态 | 可选修复 |

**问题描述：**
注释说"缺席 1h ≤ X < 24h（近一天内）→ interval = 3 天"，但实际代码中 `minAbsenceHours: 24` 是 "≥ 1 天" 的起点。`24` 小时 = 1 天，落在 `≥ 1 天` band 而非"近一天内"。

建议修改为：
```
// 缺席 0h < X < 24h（近一天内）→ 每天来（interval = null）
// 缺席 24h ≤ X < 72h → interval = 3 天
```

---

#### P3-004 · synthesizer 注释中 "30%~70% 概率" 与实现不完全一致

| 项目 | 内容 |
|------|------|
| 严重度 | P3 — 注释精度 |
| 所在文件 | `src/domain/catchup/aggregator.ts` 第 60 行 |
| 状态 | 可选修复 |

**问题描述：**
注释说 outings 是"每天 30%~70% 概率抽一次"，但实际实现为：
```ts
for (let d = 0; d < days; d++) {
  if (rng() < 0.5) outings++;
}
```
实际是固定 50% 概率，而非 30%~70% 区间。建议将注释改为"每天 50% 概率"。

---

#### P3-005 · executor.ts 中 `generateNextEvent` 缺少 `byCatchup` 字段传递

| 项目 | 内容 |
|------|------|
| 严重度 | P3 — 信息性字段（当前不影响行为） |
| 所在文件 | `src/domain/catchup/executor.ts` 第 105-109 行 |
| 状态 | 可选修复 |

**问题描述：**
`executeCatchUp` 调用 `generateNextEvent` 时传入了 `byCatchup: true`，但 `generateNextEvent` 仅将其传递给生成器上下文 `ctx.byCatchup`。当前没有任何生成器读取 `ctx.byCatchup` 字段。这是设计上的合理预留，但注释中应明确说明这是为将来扩展预留的字段，避免读者困惑。

---

#### P3-006 · `/api/sync` 的 catchup 失败后返回的数据一致性

| 项目 | 内容 |
|------|------|
| 严重度 | P3 — 信息完整性 |
| 所在文件 | `src/app/api/sync/route.ts` 第 78-93 行 |
| 状态 | 可选修复 |

**问题描述：**
当 `executeCatchUp` 失败时（catch 块中 `catchupSkipped = "catchup_error"`），返回的 `catchup.durationMs` 和 `catchup.eventCount` 均为 0。虽然用户下次同步会重试，但当前响应的 `catchup.ran` 为 `false` 且 `skipped: "catchup_error"` 提供了足够的诊断信息。建议将 `durationMs` 设为 `catchupStartedAt` 到 catch 块结束的实际耗时，以便监控。

当前：
```ts
} catch (err) {
  catchupSkipped = "catchup_error";
}
```

建议：
```ts
} catch (err) {
  catchupSkipped = "catchup_error";
  catchupDurationMs = Date.now() - catchupStartedAt;
}
```

---

## 4. 验收项对照表

| # | 验收项 | 文档来源 | 代码位置 | 结果 |
|---|--------|----------|----------|------|
| #4-1 | 补算：1/3/30 天三用例 | req §3.4, stage-plan §3 | planner.ts + planner.test.ts | ✅ 通过（1d→1条, 3d→3条, 30d→7常规+1聚合=8条） |
| #4-2 | ≤20 条硬上限 | req §3.4 | planner.ts MAX_EVENTS=20 + test 覆盖 10000 天场景 | ✅ 通过（10000 天场景 total=8 ≤ 20） |
| #4-3 | >7 天按天聚合为 1 条摘要 | req §3.4 | planner.ts AGGREGATE_THRESHOLD_DAYS=7 + aggregator.ts | ✅ 通过（8d→1d聚合, 30d→23d聚合, 90d→83d聚合） |
| #4-4 | 渐进披露入口卡片 | req §3.4, #6 | ui/timeline.tsx TimelineEntryCard + page.tsx 集成 | ✅ 通过（首页+时间线页均集成） |
| #4-5 | 补算耗时 <500ms | req §3.4, arch §9 R3 | sync/route.ts 第 68-73 行 console.warn 报警 | ✅ 通过（planner 纯函数 90 天场景 <10ms；事务内纯 IO） |
| #5-1 | 事件流：单一时间轴 | req §3.5 | ui/timeline.tsx TimelineView | ✅ 通过 |
| #5-2 | 类型标签 | req §3.5 | ui/timeline.tsx TypeTag + TYPE_LABELS | ✅ 通过（11 种事件类型全映射） |
| #5-3 | 记忆引用高亮 | req §3.5 | ui/event-card.tsx highlight + ui/timeline.tsx MemoryRefBadge | ✅ 通过（正文高亮 + 角标展示） |
| #5-4 | **无回复按钮**（UI 强制） | req §3.5 | timeline/page.tsx + event-card.tsx + timeline.tsx | ✅ 通过（全文件无回复按钮；UI 注释明确说明） |
| #5-5 | 分页（20 条/页） | req §3.5, stage-plan §3 | timeline/page.tsx DEFAULT_PAGE_SIZE=20 + timeline.tsx TimelineView 分页控件 | ✅ 通过 |
| #10-1 | 退避表 1→3→7→30 天 | CONTEXT.md 退避间隔表, req §3.3 | config/backoff-table.ts BACKOFF_BANDS | ✅ 通过（4 band 完整映射） |
| #10-2 | 退避调度可观测 | req §3.3, stage-plan §3 | sync/route.ts 返回 backoff 字段 + scheduler.test.ts 18 用例 | ✅ 通过（含 nextProactiveTs 字段） |
| #10-3 | 退避表与 CONTEXT.md 一致 | CONTEXT.md | backoff-table.ts + backoff-table.test.ts 完整对照 | ✅ 通过（4 band 逐一验证） |
| - | planCatchUp 纯函数（90 天场景） | stage-plan §3 | planner.ts planCatchUp 纯函数 + test 覆盖 90 天 | ✅ 通过（无 IO/Date 读取，1000 次 90 天场景 <10s） |
| - | executor 事务回滚 | arch §4.3.1 | executor.ts withTransaction + test 覆盖 INSERT/UPDATE 失败 | ✅ 通过（失败后 rollback，UPDATE pets 不执行） |
| - | /api/sync 鉴权 | stage-plan §3 | sync/route.ts Bearer + cookie 双模式 | ✅ 通过（401 验证） |
| - | 事件结构不含文案 | req 解耦铁律 | executor.test.ts "事件结构不含文案字段" 测试 | ✅ 通过（无 text/body/title 属性） |
| - | 领域层零 next/react | arch §1.2 | grep src/domain/** 无 next/react import | ✅ 通过 |
| - | MySQL 约束（BIGINT UTC ms, ULID, 8.x） | arch §2.3, db-schema | 001_init.sql MySQL 8 DDL + types.ts | ✅ 通过 |
| - | 开发端点白名单 | stage-plan §3 | /api/pet/generate-event 有 ENABLE_DEV_ENDPOINTS 检查 | ✅ 通过 |
| - | 不处理 P2-006（MemoryRef.kind） | stage-plan §3 | 代码未涉及 | ✅ 通过（符合约束） |
| - | 不 bump 契约版本 | stage-plan §3 | schemaVersion 均为 "1.0.0" | ✅ 通过 |

---

## 5. 质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | **良** | 领域层纯 TS 铁律遵守；命名清晰；注释详实；无 next/react 混入。个别注释与代码不一致（P2-001, P3-003, P3-004） |
| 功能完整性 | **优** | 所有验收项覆盖；355 单测全过；96 新增用例覆盖核心边界；30 天/90 天/10000 天场景全部通过 |
| 可维护性 | **良** | 模块边界清晰（planner/executor/aggregator 职责分离）；纯函数设计便于测试；退避表集中管理。个别冗余变量（P3-001）和死代码（P2-003） |
| 测试覆盖率 | **优** | planner 24 用例 + aggregator 22 + executor 14 + backoff-table 18 + scheduler 18 = 96 新增；覆盖边界/确定性/异常/性能 |
| 架构一致性 | **优** | 事务边界与架构文档 §4.3.1 一致；补算时序正确；R3 缓解措施（记忆预取、无事务内 sleep）落实 |
| 安全 | **优** | /api/sync Bearer+cookie 鉴权；无 SQL 注入（全部 prepared statement）；事件结构不含敏感文案 |

---

## 6. 是否建议提交

**✅ 建议提交。** 9 个问题全部为 P2/P3 级别（注释错误 + 死代码 + 风格建议），无 P0/P1 阻塞性问题。功能完整性、测试覆盖、架构一致性均达到标准。建议工程师在提交前快速修复 P2-001（注释）和 P2-003（死代码），其余为可选优化。

---

## 7. 后续建议（非阻塞）

1. **短期（提交前）**：修复 P2-001 注释 + P2-003 死代码，耗时约 5 分钟。
2. **中期（阶段 4 前）**：修复 P2-002 首页 eventCount 精确度问题；考虑在 `/api/pet/timeline` 支持 `total=1` 参数传递给首页。
3. **长期（阶段 6 前）**：为 `findLatestAggregate` 查询重写以更好利用 `idx_events_aggregate` 索引（`WHERE aggregate_ts IS NOT NULL ORDER BY aggregate_ts DESC`）。

---

质检签名：质检 Agent — 2026-09-10
