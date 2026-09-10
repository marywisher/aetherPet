# 质检报告 · 阶段 2 · Round 1

> 依据文档：`docs/current-stage.md`、`docs/dev-stage-plan.md §3 阶段 2`、`docs/architecture.md §5-6`、`docs/database-schema.md`、`docs/requirements.md §6`、`CONTEXT.md`、`reports/qa-final.md`（阶段 1 收官参考）
> 复核对象：阶段 2 交付（pet FSM + 事件引擎 + 9+2 生成器 + 记忆检索 + 契约文档 + 素材包完整文案 + 事件卡片最小渲染）
> 检查时间：2026-09-09
> 检查人：质检（Round 1 · Gate）

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 阶段 | 阶段 2（pet 状态机 + 事件引擎 + 契约定稿） |
| 工作目录 | `C:/Python Auto/Python AI/cl/flutter/aetherPet` |
| 交付声明 | 223 tests passed / TypeScript 0 错误 / Next.js build 成功 |

**本轮独立执行的验证命令（实际输出）：**

```bash
$ npx vitest run
 Test Files  21 passed (21)
      Tests  223 passed (223)
  Duration  4.76s

$ npx tsc --noEmit
# 无输出，0 错误

$ grep -rn "from 'next\|from 'react" src/domain/
# 0 匹配（领域层零 next/react 硬约束保持）✅

$ grep -rn "sqlite\|better-sqlite" src/
# 0 匹配（MySQL 硬约束保持）✅

$ grep -rn "fsmState:" src/domain/events/generators/
# 11 处，全部为 `pet.state`（生成前的 pet 快照状态）

$ grep -rn "outing_end" src/ tests/ docs/
# 仅在 pet-fsm.ts / pet-fsm.test.ts 中出现，无生成器调用 → FSM 转换非对称

$ grep -rn "void [a-zA-Z];" src/domain/events/
# 5 处死代码（未使用 import 用 void 抑制告警）
```

**测试覆盖度：**

- ✅ 223 单测（较阶段 1 收官 138 净增 85 用例）
- ✅ 阶段 2 新增测试文件 5 个：fsm/pet-fsm / events/generators / events/render / memory/recall-strategy / memory/anchoring
- ✅ 1000 次采样测试：名字引用率断言 ≥30%（实际远超，通过）

---

## 2. 阶段 2 验收覆盖对照

| 验收项 | 覆盖情况 | 关键证据 |
|-------|----------|--------|
| #3 随机事件引擎（含记忆引用 ≥30%） | ⚠️ **有 P1 阻塞** | 单测采样通过（1000 次名字引用率 ≥30% ✅），但端到端行为有缺陷（见 P1-001、P1-002） |
| #8 素材包可配置性（契约部分） | ⚠️ **契约文档有 P1 缺陷** | `docs/packs-contract.md` 已产出，但 §2 manifest 契约与实际 schema 完全不符（见 P1-003） |
| FSM 全转换覆盖 | ⚠️ **状态持久化缺失** | 单测覆盖 `at_home/out_walking/on_trip` 三态 + 4 动作，但缺 `outing_end` 生成器 + pet.state 从未落库（见 P1-001、P1-002） |
| 事件结构不含文案 | ✅ 通过 | `Event.params` 只存结构化数据，`render.ts` 从素材包取文案；无字符串硬编码在生成器中 |
| 领域层零 next/react | ✅ 通过 | `grep` 0 匹配 |
| MySQL 约束保持 | ✅ 通过 | `grep sqlite` 0 匹配；`events.repo.ts` / `memories.repo.ts` 均用 mysql2 + 参数化 SQL |

---

## 3. 详细问题清单

### P0 · 阻塞性问题

**无。** 所有关键路径可跑通，223 单测通过，无功能性死锁。

---

### P1 · 严重问题

#### P1-001 · `pet.state` 从不落库，导致 FSM 转换无法持久化

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/persistence/repos/pets.repo.ts`、`src/app/api/pet/generate-event/route.ts`、`src/app/api/pet/create/route.ts` |
| 严重程度 | **严重** |
| 触发条件 | 任何事件生成调用（首次创建、手动触发、批量补算） |
| 具体缺陷 | `pets.repo.ts` **没有** `updateState` / `update` 类函数；`generate-event/route.ts:80` 收到 `output.nextState` 后只调用 `touchUserActivity(pet.id)`（只更新活跃度时间戳），**从未** 把 `nextState` / `nextStateSince` 写回 `pets.state` / `pets.state_since`；`create/route.ts:80` 的 `generateBatchEvents` 返回 `{ events, finalState, finalStateSince }`，但只 `insertMany(events)`，丢弃 `finalState`。 |

**问题描述：**

事件引擎 `generateNextEvent` 会正确返回 `nextState`（如 outing 事件把 `at_home` 转为 `out_walking`），但该状态**只在内存中存活一次调用**，落库后立即丢失。下次任何请求（时间线、下一次触发）读回的 `pet.state` 仍是 `"at_home"`。

**复现步骤：**

1. 手动触发 `outing` 事件（`POST /api/pet/generate-event` body `{type: "outing"}`）
2. 服务端返回 `nextPet: { state: "out_walking", stateSince: ... }` 给前端
3. 前端 `page.tsx` 用 `setPetState(data.nextPet.state)` 刷新 UI → 显示"出门中" ✅
4. 前端刷新页面 → `GET /api/pet/timeline` 从 DB 读 pet → `pet.state = "at_home"` ❌
5. UI 显示"在家"（回退到旧状态）

**期望结果：**

事件生成后，pet 的 `state` 应在 DB 中持久化。契约 §5 outing 的 FSM 转换 `at_home → out_walking` 应生效于后续查询。

**实际结果：**

状态转换是"一次性内存态"，DB 永远是 `at_home`，前端刷新即回滚。

**建议修复：**

在 `pets.repo.ts` 中新增 `updateState(petId, state, stateSince, ts)` 函数：
```sql
UPDATE pets SET state = ?, state_since = ?, updated_at = ? WHERE id = ?
```
在 `generate-event/route.ts` 中 `insertEvent` 后同步调用（或在同一事务内），在 `create/route.ts` 中 `insertMany(events)` 后用 `finalState` 更新。

**严重性说明：**

这是阶段 2 的**核心行为缺陷**——契约表明确写了 FSM 转换规则，架构文档也写了"状态推进"，但状态推进只活在一次 HTTP 调用内。若阶段 3 补算依赖此，会引入更大的数据一致性问题。

---

#### P1-002 · `Event.fsmState` 语义歧义 + 记录的是"事件动作前"的状态

| 字段 | 内容 |
|------|------|
| 所在文件 | 全部 11 个 `src/domain/events/generators/*.ts`（`fsmState: pet.state`）、`src/domain/types.ts`、`docs/database-schema.md` |
| 严重程度 | **严重** |
| 具体缺陷 | 所有生成器写 `fsmState: pet.state`（事件生成时的 pet 快照状态，即 FSM 动作应用**之前**的状态），但 `docs/database-schema.md:339` 注释为 "事件发生时 pet 状态快照"，且 `event-card.tsx` 用它作为"当前状态标签"展示。 |

**问题描述：**

对于 `outing` 事件（fsmAction=`outing_start`），语义是"从在家转到出门"。但入库的 `fsmState = "at_home"`。UI 展示 `outing` 事件卡片时，右侧状态标签显示"在家"，与事件类型"散步"矛盾。

**复现步骤：**

1. 触发一条 `outing` 事件
2. 打开事件时间线
3. 事件卡片显示：`[散步] [在家]` — 但事件本身表示"出门"

**期望结果：**

`Event.fsmState` 应记录 **事件动作应用后** 的 pet 状态（"事件完成后的世界状态快照"），或改名为 `fsmStateBefore` / 显式区分。契约 §5 表中 outing 的 FSM 转换写 `at_home → out_walking`，暗示 out_walking 才是"事件发生后的状态"。

**实际结果：**

`fsmState = "at_home"`（转换前状态），UI 展示与语义不符。

**建议修复（二选一）：**

- **方案 A（推荐）**：修改所有生成器，`fsmState` 改为"动作应用后的状态"。可让 engine 在拿到 generator 输出后再回填：
  ```ts
  // engine.ts
  const { event, fsmAction } = generator(ctx);
  const { state: nextState } = transition(pet.state, fsmAction, event.ts);
  event.fsmState = nextState;  // 覆盖为"事件后"状态
  ```
  并在 DB 注释与契约文档中明确 `fsmState = 事件发生后 pet 状态快照`。

- **方案 B**：改名为 `fsmStateBefore`，UI 不展示它，改展示 pet 当前 state。

**严重性说明：**

这是"契约定稿"阶段的关键决策点。契约 §5 明确写了 FSM 转换箭头方向（`→` 后是目标状态），但代码记录的是箭头前的状态。契约文档冻结后，改字段名会引发破坏性变更（须 bump major）。

---

#### P1-003 · `docs/packs-contract.md` §2 manifest.json 契约与实际 schema 完全不符

| 字段 | 内容 |
|------|------|
| 所在文件 | `docs/packs-contract.md` §2、`src/assets/packs/default/manifest.json`、`src/domain/packs/manifest-schema.ts` |
| 严重程度 | **严重** |
| 具体缺陷 | 契约文档 §2 描述的 manifest.json 结构（`pack_id` / `pack_name` / `engine_version` / `text_files[]` / `theme_css` / `description`）与实际使用的结构（`name` / `display_name` / `version` / `texts{}` / `theme.css` + `palette`）**完全不一致**。 |

**问题描述：**

| 契约文档 §2 描述 | 实际 schema（`manifest-schema.ts`） |
|---|---|
| `pack_id: "default"` | `name: "default"` |
| `pack_name: "AetherPet 默认包"` | `display_name: "官方默认（手绘暖调）"` |
| `engine_version: "1.0.0"`（独立字段） | `min_engine_version: "1.0.0"`（+ `version`） |
| `text_files: [array of keys]` | `texts: { key: "path" }`（object） |
| `theme_css: "theme.css"`（扁平字段） | `theme.css: "theme.css"`（嵌套）+ `theme.palette{}` |
| `description: "..."` | ❌ 无此字段（虽然 `passthrough()` 允许） |
| ❌ | `assets: { key: "path" }` |
| ❌ | `fallback: null` |

**复现步骤：**

1. 素材包作者阅读契约 §2
2. 按 §2 编写 manifest.json
3. 加载时 `manifest-schema.ts` 的 zod schema 校验失败（字段名不匹配、缺 `name`/`display_name`/`version` 等必填）
4. 回退到默认包（`fallbackReason: "manifest_invalid"`）

**期望结果：**

契约 §2 应与实际 `manifest-schema.ts` / `manifest.json` 完全对齐。契约冻结的核心价值是"新人照抄即可上手"。

**实际结果：**

契约文档是"平行宇宙"版本，与真实 schema 完全脱钩。契约冻结声明失去意义。

**建议修复：**

重写契约 §2 与实际 schema 对齐：
```jsonc
{
  "name": "default",                        // 包唯一标识（activePackName 引用）
  "display_name": "官方默认（手绘暖调）",    // 展示名
  "version": "1.0.0",                       // 包本身版本
  "pack_schema_version": "1.0.0",           // 契约版本（本文件）
  "min_engine_version": "1.0.0",            // 最低引擎版本
  "author": "aetherPet core team",
  "license": "MIT",
  "theme": {
    "css": "theme.css",
    "palette": { "primary": "#...", "accent": "#...", "memory_ref": "#...", "paper": "#...", "ink": "#..." }
  },
  "assets": { "home_bg": "images/home-bg.svg", "letter_bg": "images/letter-bg.svg" },
  "texts": {
    "outing": "text/outing.json",
    "watching_water": "text/watching-water.json",
    // ... 11 项
  },
  "fallback": null
}
```
并注明"zod schema 见 `src/domain/packs/manifest-schema.ts`"作为唯一权威。

**严重性说明：**

这是**契约冻结**阶段的核心缺陷。契约 §2 是外部素材包作者的第一接触点。若冻结后不修，未来任何素材包开发者都会踩坑。建议在**阶段 2 内立即修复**（bump patch：`1.0.0 → 1.0.1`，契约文档错误属"文档修复"不算破坏性变更）。

---

#### P1-004 · FSM 转换非对称：`outing_end` 无生成器产出，pet 一旦出门永不回来

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/fsm/pet-fsm.ts`、`src/domain/events/generators/*`、`src/domain/events/engine.ts` |
| 严重程度 | **严重** |
| 触发条件 | pet 触发一次 `outing` 事件后 |
| 具体缺陷 | FSM 定义了 4 个动作（`outing_start / outing_end / trip_start / trip_end`），但**只有 `outing_start` 有生成器**（`outing.ts`）。`outing_end` 无生成器产出，pet 一旦 `at_home → out_walking`，永远停在 `out_walking`（除非未来启用 `trip_end`，但当前也无生成器）。 |

**问题描述：**

`docs/dev-stage-plan.md §3 阶段 2` 明确写："转换规则：出门事件 → out_walking；**回来事件 → at_home**"。但当前实现只有"出门事件"，没有"回来事件"。

FSM 单元测试 `pet-fsm.test.ts:19` 验证了 `out_walking ──outing_end──► at_home` 转换存在，但**没有单测验证"某个生成器会触发 outing_end"**。这是典型的"FSM 有定义但无驱动"缺陷。

**复现步骤：**

1. 触发一条 `outing` 事件（假设 P1-001 修好后 pet.state 已落库为 `out_walking`）
2. 继续触发随机事件（`engine.ts:pickRandomTypesByState` 对 `out_walking` 返回 `brought_item / watching_water / counting_leaves / self_talk / spontaneous_letter`）
3. 所有 5 种类型的生成器都返回 `fsmAction: "no_op"`，pet 永远停在 `out_walking`
4. 若再次触发 `outing`（因 P1-001 未修则仍可能，因 pet.state 未持久化）→ 会生成一条 fsmState=`out_walking` 的 `outing` 事件（语义重复出门）

**期望结果：**

`brought_item`（带回物品）是"散步归来"的自然产物，应触发 `outing_end` 把 pet 转回 `at_home`。契约 §5 中 brought_item 的 FSM 动作应标注 `out_walking → at_home`（当前写 `no-op`）。

**实际结果：**

FSM 单向不可逆，pet 出门即"卡"在 out_walking。

**建议修复：**

`src/domain/events/generators/brought-item.ts` 返回 `fsmAction: "outing_end"` 而非 `no_op`。同步更新契约 §5 brought_item 的 FSM 列。补充端到端 FSM 单测：`outing → brought_item` 序列应回到 `at_home`。

**严重性说明：**

这是阶段 2 的**核心设计缺陷**，直接影响后续阶段 3 补算行为（补算产生的事件也应遵循同一 FSM 逻辑）。若不修，阶段 3 会继承此缺陷。

---

### P2 · 一般问题

#### P2-005 · `pickRandomTypesByState` 类型安全退化 + `on_trip` 状态候选集不合理

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/events/engine.ts:23-32` |
| 严重程度 | **一般** |

**问题描述：**

```ts
function pickRandomTypesByState(state: PetState): string[] {
  if (state === "out_walking") {
    return ["brought_item", "watching_water", "counting_leaves", "self_talk", "spontaneous_letter"];
  }
  // at_home / on_trip：全部可选
  return RANDOM_TYPES;
}
```

1. 返回类型是 `string[]` 而非 `EventTypeValue[]`，导致后续 `GENERATORS[type as keyof typeof GENERATORS]` 需要 `as` 强转，破坏类型安全。
2. `on_trip` 状态与 `at_home` 共用 `RANDOM_TYPES`，但 `RANDOM_TYPES` 含 `outing`（触发 `outing_start`，需要 `at_home` 起点）。虽然 FSM 会把它当 no-op，但**事件仍会被生成**，`event.type = "outing"` + `event.fsmState = "on_trip"` 组合语义荒谬（旅行中"出门散步"）。

**建议修复：**

- 返回类型改为 `EventTypeValue[]`
- `on_trip` 返回更合理的候选集（如仅 `spontaneous_letter / self_talk`）或加注释说明 MVP 阶段 on_trip 视为"暂时状态"

---

#### P2-006 · `MemoryKind → MemoryRef.kind` 映射语义丢失

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/memory/recall-strategy.ts:53-59` |
| 严重程度 | **一般** |

**问题描述：**

`MemoryKind` 有 6 种：`naming | preference | item_received | place_visited | sentiment | custom`；但 `MemoryRef.kind` 只有 4 种：`pet_name | item_name | time_anchor | place`。当前映射：

```ts
if (m.kind === "naming") refKind = "pet_name";
else if (m.kind === "item_received") refKind = "item_name";
// preference / place_visited / sentiment / custom 全部归入 "place"
```

`preference = "喜欢黄昏"` 被标为 `place`（"place" 应指地点，语义不符）。用户档案页若按 `ref.kind === "place"` 分组，会看到"喜欢黄昏"混在"河边"里。

**建议修复：**

- 短期：为 `MemoryRef.kind` 增加 `"preference"` 和 `"sentiment"` 值（若契约允许），或把 preference/sentiment 映射到独立的 kind。
- 或：改 `MemoryKind.preference → "preference"` 独立处理，`place_visited → "place"` 精确定位。

---

#### P2-007 · `generateTimeAnchor` 死代码路径（`daysAgo > 6` 永不触发）

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/memory/anchoring.ts:30-45` |
| 严重程度 | **一般** |

**问题描述：**

```ts
const daysAgo = 1 + Math.floor(rng() * 6); // 1..6
// ...
if (daysAgo <= 3) text = `${daysAgo} 天前`;
else if (daysAgo <= 6) text = "前几天";
else if (daysAgo <= 9) text = "上周";        // 永不触发
else if (daysAgo <= 14) text = "上上周";     // 永不触发
else text = "很久之前";                       // 永不触发
```

`daysAgo` 上限为 6，但代码分支处理到 30+，最后三个分支（"上周"/"上上周"/"很久之前"）**永远走不到**。`pickAnchor` 有独立的候选池包含这些短语，所以外部 API 不受影响；但 `generateTimeAnchor` 是"公开函数"，读者会误以为它能产出"上周"等短语。

`anchoring.test.ts` 的 `EXPECTED_ANCHOR_PHRASES` 数组包含全部 7 个短语，但实际 `generateTimeAnchor` 只可能产出前 4 个（"昨天"/"前天"/"X 天前"/"前几天"）。测试用 `matched some phrase || /^\d+ 天前$/` 兜底通过，掩盖了这个问题。

**建议修复：**

- 删除 dead branches，或把 `daysAgo` 上限扩大到能触发所有分支（如 `1 + Math.floor(rng() * 20)`）
- 明确 `generateTimeAnchor` 与 `pickAnchor` 的分工（前者"最近 1 周内"，后者"完整锚点池"）
- 更新测试 `EXPECTED_ANCHOR_PHRASES` 与实际行为一致

---

#### P2-008 · `create/route.ts` 初始事件数固定为 2，非"1-3 条随机"

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/app/api/pet/create/route.ts:40` |
| 严重程度 | **一般** |

**问题描述：**

```ts
/** 首次登录时预生成的初始事件条数（1–3 条随机） */
const INITIAL_EVENT_COUNT = 2;
```

注释写"1–3 条随机"，实际硬编码 2。契约演示步骤 2 要求"1–3 条初始事件"。

**建议修复：**

```ts
const INITIAL_EVENT_COUNT = 1 + Math.floor(Math.random() * 3); // 1..3
```
或明确改为固定 2 并更新注释与文档。

---

#### P2-009 · `generate-event/route.ts` 内部动态 `import()` 冗余

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/app/api/pet/generate-event/route.ts:56-67` |
| 严重程度 | **一般** |

**问题描述：**

```ts
import { findByPetId as findMemoriesByPetId } from "@/domain/persistence/repos/memories.repo";  // 顶部已静态导入
// ...
if (!hasNaming) {
    const { insert: insertMemory } = await import("@/domain/persistence/repos/memories.repo");  // 重复动态导入
    const { newId } = await import("@/domain/util/ulid");                                       // 重复动态导入
    // ...
}
```

顶部已静态导入 `findByPetId`，内部又动态 `import` 同一个模块的 `insert`。`newId` 也在其他文件有静态导入（见 `create/route.ts`）。这造成打包产物重复 + 可读性下降。

**建议修复：**

顶部补充 `import { insert as insertMemory } from "@/domain/persistence/repos/memories.repo";` 和 `import { newId } from "@/domain/util/ulid";`，删除动态导入。

---

#### P2-010 · 契约 §5 recall_required 与实际生成器行为不一致

| 字段 | 内容 |
|------|------|
| 所在文件 | `docs/packs-contract.md §5`、多个 generator |
| 严重程度 | **一般** |

**问题描述：**

契约 §5 中多条 `recall_required` 声明与实际生成器实现不一致：

| 事件类型 | 契约 recall_required | 生成器实际行为 |
|---------|-------------------|--------------|
| `outing` | `place, time_anchor` | `recallForPet` 默认参数，不强制注入 `place` ref（`params.place` 未回填到 memoryRefs） |
| `watching_water` | `place, time_anchor` | 同上，`params.place` 未回填 |
| `self_talk` | `time_anchor, pet_name` | 不强制注入 |
| `spontaneous_letter` | `time_anchor, pet_name` | 不强制注入（`nameForceProb: 0.7` 是概率而非强制） |
| `brought_item` | `item_name, pet_name` | 强制注入 `item_name` ✅；`pet_name` 依赖 `recallForPet` 50% 概率（非强制） |
| `daily_grant` | `item_name, pet_name` | 强制注入 `item_name` ✅；`pet_name` 概率 `0.6` |
| `offer_received` | `item_name, pet_name, time_anchor` | 强制注入 `item_name` + `pet_name` ✅；`time_anchor` 依赖 recallForPet 40% 概率 |

**建议修复：**

契约 §7 已说明"recall_required 是期望，不强制"。但既然 `brought_item / reply_letter / daily_grant / offer_received` 强制注入 `item_name`，说明契约是**软-强制混合**。建议：

1. 契约 §5 表加一列"强制/期望"，明确每条 recall_required 是否强制注入
2. 或把 `outing` / `watching_water` 的 `place` 强制注入（`params.place` 回填 memoryRefs）
3. 或删掉契约 §5 中"期望但从不强制"的条目

---

#### P2-011 · `/api/pet/generate-event` 生产保护依赖 `env.NODE_ENV` 可能未定义

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/app/api/pet/generate-event/route.ts:33-38` |
| 严重程度 | **一般** |

**问题描述：**

```ts
if (env.NODE_ENV === "production") {
    return NextResponse.json({ error: "开发端点在生产模式禁用" }, { status: 403 });
}
```

若 `.env` 未设置 `NODE_ENV`（自托管部署常见），`env.NODE_ENV` 可能为 `undefined`，绕过检查。虽然 Next.js 默认在 prod 构建时 `process.env.NODE_ENV = "production"`，但依赖隐式约定不牢靠。

**建议修复：**

```ts
const isProd = env.NODE_ENV === "production" || !env.NODE_ENV; // 或加白名单
```
或引入专用开关：`const DEV_ENDPOINTS_ENABLED = env.ENABLE_DEV_ENDPOINTS === "true"`，默认 false，需显式启用。

---

#### P2-012 · `aggregate-summary` 生成器 `nameForceProb: 1` 与契约 `recall_min_count: 0` 矛盾

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/events/generators/aggregate-summary.ts:26` |
| 严重程度 | **一般** |

**问题描述：**

```ts
const recall = recallForPet({ ..., opts: { maxRefs: 4, nameForceProb: 1 } });
```

`nameForceProb: 1` 强制 100% 注入 pet_name。但契约 §5 aggregate_summary 的 `recall_min_count: 0`，暗示允许无 memory refs。

**建议修复：**

- 若聚合摘要必须引用 pet_name：改契约 `recall_min_count: 1` + `recall_required: pet_name`
- 若允许无 pet_name：删掉 `nameForceProb: 1`，走默认 0.5

---

### P3 · 轻微问题

#### P3-001 · 5 个生成器用 `void X;` 抑制未使用 import 告警

| 字段 | 内容 |
|------|------|
| 所在文件 | `outing.ts:56`、`reply-letter.ts:79`、`announce.ts:20`、`aggregate-summary.ts:22`、`brought-item.ts`（可能） |
| 严重程度 | **轻微** |

**问题描述：**

```ts
import { randInt, randFloat, pickOne } from "../rng";  // randFloat 未使用
// ...
void randFloat;  // 死代码
```

`generateOuting` 只用了 `randInt` 和 `pickOne`，`randFloat` 未使用但仍 import；用 `void randFloat;` 掩盖告警。这 5 处死代码降低可读性。

**建议修复：**

删除未使用 import 与 `void` 语句，让 TypeScript `noUnusedLocals` 严格生效（若 tsconfig 未开启，可加）。

---

#### P3-002 · `recall-strategy.test.ts` 冗余断言

| 字段 | 内容 |
|------|------|
| 所在文件 | `tests/unit/domain/memory/recall-strategy.test.ts:65-72`、`tests/unit/domain/memory/recall-strategy.test.ts:117-125` |
| 严重程度 | **轻微** |

**问题描述：**

```ts
const ratio = withNameCount / total;
expect(ratio).toBeGreaterThanOrEqual(0.30);
// 更严格：由于强制概率 50%，实际应远大于 30%
expect(ratio).toBeGreaterThanOrEqual(0.30);  // 完全重复
```

同一个 `ratio` 断言两次同样的下界。注释写"更严格"但实际未更严格。

**建议修复：**

第二行改为 `expect(ratio).toBeGreaterThanOrEqual(0.40)` 或直接删除。

---

#### P3-003 · `Event.fsmState` 在测试文件中硬编码为 `"at_home"`，掩盖语义缺陷

| 字段 | 内容 |
|------|------|
| 所在文件 | 全部 generators.test.ts / render.test.ts 的 `fsmState: "at_home"` |
| 严重程度 | **轻微** |

**问题描述：**

所有单测中 `event.fsmState` 一律写 `"at_home"`（继承测试用 pet 的初始状态），因此 P1-002 的语义缺陷不会被测试发现。

**建议修复：**

增加端到端测试：模拟 `pet.state = "at_home"` → 触发 `outing` → 断言事件 fsmState 与预期一致（无论"前"或"后"，至少与文档对齐）。

---

#### P3-004 · `current-stage.md` 声明"121 条独特文案"与实际 113 条不符

| 字段 | 内容 |
|------|------|
| 所在文件 | `docs/current-stage.md`、`src/assets/packs/default/text/system-announce.json` |
| 严重程度 | **轻微** |

**问题描述：**

声明："11 类 × (8 daily + 3 poetic) = 121 条独特文案"。实际：`system-announce.json` 是 2 daily + 1 poetic = 3 条，其余 10 类各 11 条，共 10×11 + 3 = **113 条**。

**建议修复：**

- 修正 `current-stage.md` 的文案数声明
- 或补齐 `system-announce.json` 到 8+3=11 条（系统公告类型较少是合理的，但文档应如实反映）

---

#### P3-005 · 契约 §8.4 新增事件类型清单未提及 UI 类型标签

| 字段 | 内容 |
|------|------|
| 所在文件 | `docs/packs-contract.md §8.4` |
| 严重程度 | **轻微** |

**问题描述：**

契约 §8.4 列出新增事件类型必须同步的 6 项（generator / templates / text / 契约表 / manifest-schema / architecture），但未提及：

- `src/ui/event-card.tsx` 的 `TYPE_LABELS` 字典（新增事件类型会显示为原始 key，如 `"new_event"` 而非中文标签）
- `page.tsx` 的 `FORCE_TYPES` 数组（如需手动触发按钮）
- `docs/packs-contract.md §4` 占位符表（新增事件可能引入新占位符）

**建议修复：**

契约 §8.4 补 3 项：`event-card.tsx TYPE_LABELS`、`page.tsx FORCE_TYPES`、`docs/packs-contract.md §4 占位符表`。

---

#### P3-006 · 记忆引用无 `maxLen` 保护

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/memory/recall-strategy.ts:99` 的 `maxRefs` |
| 严重程度 | **轻微** |

**问题描述：**

`maxRefs` 默认 4，但生成器可以传 `maxRefs: 5`（`brought-item.ts / reply-letter.ts / offer-received.ts`）。若某次调用传 `maxRefs: 100`，`event.memoryRefs_json` 会存下 100 条 ref，浪费 JSON 列空间（MySQL `JSON` 列有 1MB 上限，但语义上不应用尽）。

**建议修复：**

在 `recallForPet` 入口加硬上限：`const maxRefs = Math.min(opts.maxRefs ?? 4, 10)`。

---

#### P3-007 · 事件表 `params_json` 无 schema 校验

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/persistence/repos/events.repo.ts:89` |
| 严重程度 | **轻微** |

**问题描述：**

`docs/database-schema.md:30` 明确说"事件契约中 `params` / `memory_refs` 仍需领域层先做 schema 校验再写入"，但当前 `insert(event)` 直接 `JSON.stringify(event.params ?? {})` 落库，无 schema 校验。若生成器产出错误结构（如 `duration_hours: "abc"`），DB 会照收。

**建议修复：**

- 短期：为每种 `EventTypeValue` 定义 params 的 zod schema，在 `insert` 前校验
- 或：`GENERATORS` 类型签名中为每种 generator 强类型化 ctx/params（当前是 `Record<string, unknown>`）

---

#### P3-008 · 契约 §5 outing recall_required 缺"强制"标注

| 字段 | 内容 |
|------|------|
| 所在文件 | `docs/packs-contract.md §5` |
| 严重程度 | **轻微** |

**问题描述：**

契约 §5 outing 的 `recall_required: place, time_anchor`，但生成器从不强制注入 `place`。契约 §7 说"期望，不强制"，但 §5 表看起来是"要求"。术语含糊。

**建议修复：**

统一术语，或参考 P2-010 的建议给每条 recall_required 标注"强制/期望"。

---

#### P3-009 · 事件卡片 `petName` 未使用导致潜在 lint 告警

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/ui/event-card.tsx:95` |
| 严重程度 | **轻微** |

**问题描述：**

`EventCardProps` 声明了 `petName`，但组件内部只有 `spontaneous_letter` 分支用它（`{petName} 的一封自主信`）。其他事件类型不使用。若 lint 规则是"未使用参数视为警告"，可能告警。当前 `tsx` 编译通过，无实际影响。

**建议修复：**

保留 `petName` 供未来事件类型使用即可，或用 `_petName` 前缀声明有意未用。

---

## 4. 测试覆盖评估

### 4.1 覆盖到位（阶段 2 范围内）

- ✅ Pet FSM 三态 + 4 动作转换（15 用例）
- ✅ 11 个事件生成器契约验证（结构完整性 + params 字段 + source）
- ✅ 加权记忆检索 + ≥30% 名字引用（1000 次采样，通过）
- ✅ 时间锚点短语生成（"昨天"/"前天"/"X 天前"/"前几天"）
- ✅ 渲染器（占位符替换 + 高亮 tokens + 9:1 抽样，1000 次采样 poetic 档 5%~15%）
- ✅ 契约表：11 事件类型 × 11 text JSON（结构正确）

### 4.2 未覆盖（P1/P2 相关缺陷的测试空白）

- ❌ **端到端 FSM 状态推进**：无单测验证"生成事件后 pet.state 是否更新"
- ❌ **pet.state 落库持久化**：无测试覆盖 `pets.repo` 的 state 更新路径（因为不存在此函数）
- ❌ **`Event.fsmState` 语义**：所有测试都硬编码 `"at_home"`，掩盖 P1-002 语义歧义
- ❌ **契约文档与 schema 一致性**：无测试比对 `packs-contract.md §2` 与 `manifest-schema.ts`
- ❌ **`outing_end` 触发**：无测试验证"某个生成器会产出 outing_end"
- ❌ **参数 schema 校验**：`events.repo.insert` 直接落库，无测试覆盖错误 params 的处理

---

## 5. 质量评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 代码质量 | **良** | 领域层结构清晰、生成器模式统一；但 4 个 P1 缺陷集中在**契约-代码对齐**层面 |
| 功能完整性 | **中** | 引擎能跑、事件能生成、UI 能显示；但 FSM 状态不持久、`outing_end` 无驱动、契约文档错误，端到端行为有缺陷 |
| 安全性 | **优** | MySQL 参数化 SQL、Bearer + cookie 双认证、body size limit（阶段 1 已修）、路径遍历防护（阶段 1 已修）；本轮无安全新增 |
| 可维护性 | **良** | 契约文档已产出但与实际脱钩（P1-003），若冻结不修会影响后续所有阶段；生成器模式统一，扩展容易 |
| 架构合规性 | **中** | 领域层零 next/react ✅、MySQL 约束保持 ✅、事件结构与文案解耦 ✅；但 FSM 状态推进未按架构文档落地 |
| 契约冻结准备度 | **不足** | 契约文档有 P1 级错误（§2 manifest、§5 outing recall_required），**不应作为冻结版发布** |

---

## 6. 是否建议提交

### ⚠️ 不建议提交（Round 1 打回）

**理由：**

1. **4 个 P1 严重缺陷** 集中在阶段 2 的核心承诺上：
   - P1-001: pet.state 不落库 → FSM 转换"只活一次调用"
   - P1-002: Event.fsmState 语义歧义 → UI 展示与语义矛盾
   - P1-003: 契约文档 §2 manifest 与实际完全脱钩 → 契约冻结失去意义
   - P1-004: outing_end 无生成器 → pet 出门即卡

2. **契约冻结阶段**必须零 P1。契约是后续所有阶段的基石，现在冻结错误会放大 5 倍成本。

3. **测试通过 ≠ 交付正确**：223 单测全绿，但都是"函数级"验证，缺端到端 FSM 状态流转验证。

### 提交前必须修复（Round 1 → Round 2）

| 优先级 | 问题 | 修复建议 |
|-------|------|---------|
| **P1-001** | pet.state 持久化 | 新增 `pets.repo.updateState()` + 在 generate-event / create route 中调用 |
| **P1-002** | Event.fsmState 语义 | engine.ts 中用 `transition` 结果覆盖 `event.fsmState`；同步 DB 注释与契约 |
| **P1-003** | 契约 §2 manifest | 重写契约 §2 与实际 schema 对齐 |
| **P1-004** | outing_end 触发 | `brought-item.ts` 返回 `fsmAction: "outing_end"`；更新契约 §5 brought_item |

### 建议同步修复（P2 中影响较大的）

| 问题 | 修复建议 |
|------|---------|
| P2-005 | `pickRandomTypesByState` 返回类型改为 `EventTypeValue[]` |
| P2-006 | `MemoryRef.kind` 补 preference/sentiment 或明确映射语义 |
| P2-009 | generate-event/route.ts 删除动态 import |
| P2-010 | 契约 §5 加"强制/期望"标注列 |
| P2-011 | generate-event 生产保护加显式开关 |

### 可延后（P2/P3 剩余）

- P2-007（anchoring 死代码）：影响小，阶段 3 补算前处理即可
- P2-008（INITIAL_EVENT_COUNT 随机化）：影响小
- P2-012（aggregate-summary nameForceProb）：影响小
- P3-001 ~ P3-009：可并入阶段 3 迭代

---

## 7. 与阶段 1 收官对比

| 维度 | 阶段 1 收官（qa-final.md） | 阶段 2 Round 1 |
|------|--------------------------|---------------|
| P0 阻塞 | 0 | **0** |
| P1 严重 | 0 | **4**（新增） |
| P2 一般 | 1（P2-013 Edge Runtime 遗留） | **8**（新增） |
| P3 轻微 | 2 | **9**（新增） |
| 单测通过 | 138/138 | **223/223**（+85，+62%） |
| 类型检查 | 通过 | 通过 |
| 构建 | 通过 | 通过 |
| 建议提交 | ✅ 通过 | **⚠️ 打回** |

**观察：** 阶段 1 收官零 P1 是 Round 2 迭代（P1×1 + P2×6 + P3×5）+ Round 3 兜底修复的结果。阶段 2 是首次提交，缺陷密度上升属正常，但**契约冻结**是硬门，P1-003 必须先修再"冻结"。

---

## 8. 测试覆盖演进

| 项 | 阶段 1 收官 | 阶段 2 Round 1 | 净增 |
|---|-----------|---------------|-----|
| 测试文件数 | 15 | **21** | +6 |
| 单测用例数 | 138 | **223** | +85 |
| FSM 覆盖 | 0 | 15（三态 + 4 动作） | +15 |
| 生成器覆盖 | 0 | 20（11 生成器 + 契约） | +20 |
| 记忆检索覆盖 | 0 | 13（≥30% 采样 + 强制注入） | +13 |
| 渲染器覆盖 | 0 | 25（占位符 + 高亮 + 抽样） | +25 |
| 时间锚点覆盖 | 0 | 6（7 档短语） | +6 |
| 其他 | 138 | 120 | -18（部分重排） |

**测试空白：**

- 端到端 FSM 状态流转（0 用例）
- pet.state 持久化（0 用例，因 repo 无对应函数）
- 契约文档与 schema 一致性（0 用例）
- 生产环境保护（0 用例）

**建议 Round 2 补充的测试：**

1. `tests/unit/persistence/pets-state.test.ts`：新增，验证 `updateState` 存在且能更新 DB
2. `tests/unit/domain/events/engine.test.ts`：端到端 FSM 序列（at_home → outing → out_walking → brought_item → at_home）
3. `tests/unit/packs/contract-vs-schema.test.ts`：解析 `packs-contract.md §2`，与 `manifest-schema.ts` 字段对齐校验
4. `tests/unit/app/generate-event-route.test.ts`：生产环境保护（`NODE_ENV=production` 返回 403）

---

## 9. 签名

- **质检：2026-09-09（Round 1 · Gate）**
- 报告文件：`reports/qa-round-1.md`
- 关联文件：
  - `reports/qa-final.md`（阶段 1 收官参考）
  - `reports/qa-round-1.md`（本报告）
- **结论：⚠️ 打回，不建议提交**（4 个 P1 需修复后再走 Round 2）
- 后续动作：
  1. 交工程师修复 P1-001 ~ P1-004（阻塞项）
  2. 建议同步修复 P2-005 ~ P2-012 中影响较大者
  3. Round 2 由质检验证修复 + 补充端到端测试
  4. 若 Round 2 通过 P1 清零，可考虑作为阶段 2 收官候选
