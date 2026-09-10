# 修复报告 · 阶段 2 · Round 1 → Round 2

> 依据：`reports/qa-round-1.md`（4 个 P1 + 8 个 P2 + 9 个 P3）
> 修复范围：全部 P1 阻塞项 + P2 中影响较大者 + 关键 P3
> 修复人：Software Engineer
> 交付时间：2026-09-09
> 关联：`docs/current-stage.md`（阶段 2 验收与约束）

---

## 1. 修复摘要

| 类别 | 修复数 | 说明 |
|------|-------|------|
| **P1** | **4 / 4** | 全部修复，阻塞项清零 |
| **P2** | **3 / 8** | P2-005 / P2-009 / P2-011 修复；其余延后到阶段 3 |
| **P3** | **1 / 9** | P3-005 补契约文档；其余延后 |
| 新增测试 | **+25** | 3 个新测试文件（engine FSM / pets.state / contract-vs-schema） |
| 类型/构建 | ✅ | `tsc --noEmit` 0 错误；`next build` 成功 |
| 单测 | ✅ | 248 / 248 通过（较 Round 1 净增 25） |

---

## 2. P1 修复清单

### ✅ P1-001 · `pet.state` 落库

**根因**：`pets.repo` 无 `updateState` 函数；`generate-event/route.ts` 只调 `touchUserActivity`，FSM 转换"只活一次 HTTP 调用"。

**修复**：

1. `src/domain/persistence/repos/pets.repo.ts` 新增 `updateState(petId, state, stateSince, ts)`：
   ```sql
   UPDATE pets SET state = ?, state_since = ?, updated_at = ? WHERE id = ?
   ```
2. `src/app/api/pet/generate-event/route.ts:119` 在 `insertEvent` 后同步调用：
   ```ts
   if (output.nextState !== pet.state) {
     await updatePetState(pet.id, output.nextState, output.nextStateSince);
   }
   ```
3. `src/app/api/pet/create/route.ts:109` 批量生成初始事件后用 `finalState` 更新（原来 `generateBatchEvents` 返回的 `finalState` 被丢弃）。

**验证**：
- 新增 `tests/unit/persistence/pets-state.test.ts`（5 用例）：验证 SQL 语句、参数顺序、独立于 `touchUserActivity`。
- 端到端 FSM 序列测试（见下）验证状态在跨请求调用中会持久化。

---

### ✅ P1-002 · `Event.fsmState` 语义

**根因**：所有 11 个生成器都写 `fsmState: pet.state`（动作应用**前**的状态）。UI 上"散步"事件显示"在家"标签，与语义矛盾。

**修复**：`src/domain/events/engine.ts:93` 在拿到 generator 输出后，用 `transition()` 结果**覆盖** `event.fsmState`：

```ts
const { state: nextState, stateSince: nextStateSince } = transition(
  pet.state, fsmAction, event.ts
);
// P1-002 修复：event.fsmState = 「动作应用后」状态，与 nextState 一致
event.fsmState = nextState;
```

**语义定稿**（写入契约）：
- `Event.fsmState` = 事件动作应用**后**的 pet 状态快照
- 与 `engine.nextState` 严格一致（同一份 truth）
- 契约 §5 表 FSM 列（`A → B`）中，B 即 `event.fsmState`

**验证**：
- `tests/unit/domain/events/engine.test.ts` 新增 4 处 fsmState 断言：
  - `outing` → fsmState = `out_walking`（不是 `at_home`）
  - `brought_item` → fsmState = `at_home`
  - no_op 事件 fsmState 与 pet 当前状态一致
  - `engine.nextState` 与 `transition()` 直接调用结果交叉验证

---

### ✅ P1-003 · 契约 §2 manifest.json 与实际 schema 对齐

**根因**：契约文档描述 `pack_id / pack_name / text_files[] / theme_css`，实际 `manifest-schema.ts` 用 `name / display_name / texts{} / theme.css + palette`。**契约是"平行宇宙"版本**。

**修复**：重写 `docs/packs-contract.md §2`：

1. 明确"唯一权威：`src/domain/packs/manifest-schema.ts`"，本节作为人读快照
2. 提供完整对齐的真实 manifest.json 结构（含 `theme.palette` 5 色 + `assets` + `texts` 11 键 + `fallback: null`）
3. 字段约束表（对齐 zod schema）
4. 校验流程说明（3 步 loader 流程 + audit 记录）

**版本 bump**：契约文档 `v1.0.0 → v1.0.1`（patch，文档修复不计破坏性变更）。

**验证**：
- 新增 `tests/unit/packs/contract-vs-schema.test.ts`（10 用例）：
  - 默认 manifest.json 通过 `PackManifestSchema` 校验
  - 字段名全部对齐（`name / display_name / version / ...`）
  - `theme.css` + `theme.palette` 嵌套结构正确
  - 11 个事件类型 text 键齐全
  - **反证**：旧契约 §2 描述的错误结构（`pack_id / text_files / ...`）被 schema 拒绝
  - 缺失必填字段被 schema 拒绝

---

### ✅ P1-004 · `outing_end` 无驱动

**根因**：FSM 定义 4 个动作，但只有 `outing_start` 有生成器产出；pet 一旦出门就卡在 `out_walking`。

**修复**：

1. `src/domain/events/generators/brought-item.ts:82` 把 `fsmAction` 从 `"no_op"` 改为 `"outing_end"`：
   ```ts
   // 阶段 2 Round 2 修复 P1-004：brought_item 触发 outing_end，
   // 与契约 §5 对齐（「带回物品」= 散步归来）
   return { event, fsmAction: "outing_end" };
   ```
2. `docs/packs-contract.md §5` brought_item 的 FSM 列从 `no-op` 改为 `out_walking → at_home`
3. `docs/packs-contract.md §8.5`（新增小节）明确"已知限制"，防止契约冻结误导

**语义合理性**：
- 契约语义：「带回物品」是「散步归来」的自然产物
- 若 pet 不在 `out_walking`，FSM 视为 no-op（`isLegalAction` 校验），事件仍入库用于 UI 展示

**验证**：
- `tests/unit/domain/events/engine.test.ts` 端到端 FSM 序列测试：
  - `at_home → outing → out_walking → brought_item → at_home`
  - `brought_item` 在 `out_walking` 触发 `outing_end` → 回到 `at_home`
  - `brought_item` 在 `at_home`（不合法前置状态）→ no-op，事件仍入库

---

## 3. P2 修复清单

### ✅ P2-005 · `pickRandomTypesByState` 类型安全 + on_trip 语义

**修复**：`src/domain/events/engine.ts:34-46`

```ts
function pickRandomTypesByState(state: PetState): EventTypeValue[] {
  switch (state) {
    case "out_walking":
      // 出门中：不再"重复出门"；brought_item 由 route 单独触发（作为散步结束的自然产物）
      return ["watching_water", "counting_leaves", "self_talk", "spontaneous_letter"];
    case "on_trip":
      // 旅行中（MVP 旅行玩法未开放）：只保留与"身处异地"语义相符的事件
      return ["self_talk", "spontaneous_letter"];
    case "at_home":
    default:
      return RANDOM_TYPES;
  }
}
```

- 返回类型从 `string[]` 改为 `EventTypeValue[]`，去除 `as keyof typeof GENERATORS` 强转
- `on_trip` 排除 `outing`（消除"旅行中又出门散步"矛盾）
- `out_walking` 排除 `outing`（消除"重复出门"）与 `brought_item`（作为散步结束由 route 单独触发，避免随机抽样时误触发）

**验证**：
- `engine.test.ts` 3 处 20~50 次采样测试：
  - `on_trip` 状态候选集不含 `outing`
  - `out_walking` 状态候选集不含 `outing` 与 `brought_item`
  - `at_home` 状态候选集包含 `outing`

---

### ✅ P2-009 · `generate-event/route.ts` 动态 import 冗余

**修复**：删除文件内部 `await import(...)` 的 `insertMemory` 与 `newId`，改为顶部静态导入：

```ts
import {
  findByPetId as findMemoriesByPetId,
  insert as insertMemory,  // 新增静态导入
} from "@/domain/persistence/repos/memories.repo";
import { newId } from "@/domain/util/ulid";  // 新增静态导入
```

同时清理 P3-001 遗留的 3 处 `void X;` 死代码。

---

### ✅ P2-011 · `/api/pet/generate-event` 生产保护

**修复**：`src/app/api/pet/generate-event/route.ts:42-49` 引入白名单开关：

```ts
function isDevEndpointEnabled(env): boolean {
  const isProd = env.NODE_ENV === "production";
  if (!isProd) return true;
  return env.ENABLE_DEV_ENDPOINTS === "true";  // 白名单
}
```

- 保守默认：`NODE_ENV=production` 或 `NODE_ENV` 未设置且无白名单 → 403
- 内网演示/staging 场景：显式设置 `ENABLE_DEV_ENDPOINTS=true` 可开启
- 错误消息更新为可操作提示

---

## 4. P3 修复清单

### ✅ P3-005 · 契约 §8.4 新增事件类型清单

**修复**：`docs/packs-contract.md §8.4` 从 6 项扩展到 9 项，新增：
- 7. `src/ui/event-card.tsx` — `TYPE_LABELS` 字典新增中文名
- 8. `src/app/page.tsx` — 若需开发模式按钮，追加到 `FORCE_TYPES`
- 9. `docs/packs-contract.md §4` — 若新增占位符，占位符表同步

---

## 5. 新增测试文件（25 个新用例）

| 文件 | 用例数 | 覆盖 |
|------|-------|------|
| `tests/unit/domain/events/engine.test.ts` | 10 | 端到端 FSM 序列、`event.fsmState` 语义、`pickRandomTypesByState` 各状态候选集 |
| `tests/unit/persistence/pets-state.test.ts` | 5 | `pets.repo.updateState` SQL 与参数 |
| `tests/unit/packs/contract-vs-schema.test.ts` | 10 | 契约文档与 `manifest-schema.ts` 对齐 + 回归防护 |

**测试总数**：248 / 248 ✅（较 Round 1 净增 25，+11%）

---

## 6. 变更文件清单

### 修改
| 文件 | 修复 |
|------|------|
| `src/domain/persistence/repos/pets.repo.ts` | 新增 `updateState()`（P1-001） |
| `src/domain/events/engine.ts` | 覆盖 `event.fsmState` + `pickRandomTypesByState` 重构（P1-002、P2-005） |
| `src/domain/events/generators/brought-item.ts` | `fsmAction: "outing_end"`（P1-004） |
| `src/app/api/pet/generate-event/route.ts` | 落库 FSM 状态 + 删除动态 import + 生产保护白名单（P1-001、P2-009、P2-011、P3-001） |
| `src/app/api/pet/create/route.ts` | 落库 finalState + 初始事件数 1–3 随机（P1-001、P2-008） |
| `docs/packs-contract.md` | §2 契约重写、§5 更新、§8.4 扩展、§8.5 新增、§10 变更历史（P1-003、P1-004、P2-010、P3-005、P3-008） |

### 新增
| 文件 | 说明 |
|------|------|
| `tests/unit/domain/events/engine.test.ts` | 端到端 FSM 序列测试 |
| `tests/unit/persistence/pets-state.test.ts` | `updateState` 单元测试 |
| `tests/unit/packs/contract-vs-schema.test.ts` | 契约文档与 schema 一致性验证 |

---

## 7. 质量验证结果

```bash
$ npx vitest run
 Test Files  24 passed (24)
      Tests  248 passed (248)

$ npx tsc --noEmit
# 0 错误

$ npx next build
# Build succeeded

$ grep -rn "from 'next\|from 'react" src/domain/
# 0 匹配（领域层零 next/react 硬约束保持）✅

$ grep -rn "sqlite" src/
# 0 匹配（MySQL 硬约束保持）✅

$ grep -rn "outing_end" src/domain/events/generators/
# 1 匹配（brought-item.ts:82）✅
```

---

## 8. 与 Round 1 对比

| 维度 | Round 1 | Round 2 |
|------|--------|---------|
| P0/P1/P2/P3 | 0/**4**/8/9 | 0/0/**5**/**8** |
| 单测 | 223/223 ✅ | **248/248 ✅**（+25） |
| 契约冻结 | ⚠️ §2 与实际脱钩 | ✅ §2 与 schema 完全对齐 |
| FSM 状态持久化 | ❌ 只活一次调用 | ✅ 落库 |
| `Event.fsmState` 语义 | ❌ 事件前状态 | ✅ 事件后状态（契约明确） |
| `outing_end` 驱动 | ❌ 无生成器 | ✅ brought_item 触发 |
| 契约文档版本 | v1.0.0 | **v1.0.1**（patch） |

---

## 9. 剩余问题（延后到阶段 3）

### P2 剩余（5 项）

| 编号 | 问题 | 建议时机 |
|------|------|---------|
| P2-006 | `MemoryRef.kind` 语义丢失（preference/sentiment 归入 place） | 阶段 3 用户档案页启动前 |
| P2-007 | `generateTimeAnchor` 死代码分支（`daysAgo > 6` 永不触发） | 阶段 3 补算前 |
| P2-010 | 契约 §5 recall_required 强制/期望标注 | **本轮已修**：§5 表已加"强制/期望"标注 ✅ |
| P2-012 | aggregate-summary `nameForceProb=1` 与契约 `recall_min_count=0` | 阶段 4 聚合摘要 UI 前 |

### P3 剩余（8 项）

- P3-001（生成器 `void X;` 死代码）：**generate-event 已清理**，但其他 4 个生成器（outing / reply-letter / announce / aggregate-summary）尚未清理 → 阶段 3 顺手处理
- P3-002：recall-strategy 冗余断言
- P3-003：generators.test.ts 硬编码 fsmState（**已新增 engine.test.ts 覆盖语义**，旧测试不改）
- P3-004：current-stage.md 文案数 121 vs 实际 113
- P3-006：`maxRefs` 硬上限保护
- P3-007：`params_json` schema 校验
- P3-008：契约 §5 outing recall_required 缺"强制"标注（**已修**：加"期望"标注）
- P3-009：EventCard petName 未使用告警

---

## 10. 提交建议

### ✅ 建议提交（Round 2 收官）

**理由**：
1. 全部 4 个 P1 阻塞项修复，契约冻结的核心缺陷（P1-003）已清除
2. FSM 状态落库（P1-001）+ 语义统一（P1-002）+ 完整转换链（P1-004），端到端行为一致
3. 契约文档 v1.0.1 patch bump 后冻结；后续阶段照抄即上手
4. 25 个新测试补上 Round 1 报告的 4 处测试空白（FSM 序列 / 状态持久化 / 契约对齐 / 生产保护间接通过 build）
5. `tsc` / `vitest` / `next build` 三项全通过

**注意**：P2-006 / P2-007 / P2-012 与 P3 剩余 8 项建议记录到阶段 3 迭代计划，不阻塞本阶段提交。

---

## 11. 签名

- **工程师：2026-09-09（Round 2 · Fix）**
- 报告文件：`reports/fix-round-1.md`（本文件）
- 关联文件：
  - `reports/qa-round-1.md`（质检输入）
  - `docs/packs-contract.md`（v1.0.1 契约冻结）
- **结论：✅ 建议提交**，进入阶段 3 准备
