# 修复报告 · Round 2 · 剩余 P1/P2 问题（阶段 2 收官）

> 报告路径：`reports/fix-round-2.md`  
> 关联：`reports/qa-round-2.md`（Round 2 质检结论）  
> 修复范围：1 P2（新发现 P2-013）+ 2 P2（延后项 P2-007、P2-012）+ 2 P3（P3-N001、P3-001 剩余）+ 1 P3 文档（P3-004）  
> 检查时间：2026-09-10  
> 修复人：软件工程师

---

## 1. 概览

Round 2 质检报告在通过阶段 2 收官的同时，识别出 1 个新 P2（P2-013）+ 1 个新 P3（P3-N001），并把 5 项历史 P2 + 8 项 P3 延后到阶段 3。

本轮修复策略：

| 修复项 | 优先级 | 是否本轮修 | 备注 |
|--------|--------|-----------|------|
| P2-013 · `ENABLE_DEV_ENDPOINTS` 白名单机制死代码 | P2（新） | ✅ 本轮修 | Round 2 报告建议顺手修（5 分钟） |
| P3-N001 · `INITIAL_EVENT_COUNT` 死代码 | P3（新） | ✅ 本轮修 | 与 P2-008 相关，顺手清理 |
| P2-007 · `generateTimeAnchor` 死代码分支 | P2（延后） | ✅ 本轮修 | 简单删除，无行为影响 |
| P2-012 · aggregate-summary 契约矛盾 | P2（延后） | ✅ 本轮修 | 契约与代码对齐（1 处文档修改） |
| P3-001 剩余 · 生成器 `void X;` 死代码 | P3（延后） | ✅ 本轮修 | 3 个生成器顺手清理 |
| P3-004 · `current-stage.md` 文案数声明不符 | P3（延后） | ✅ 本轮修 | 文档微调 |
| P2-006 · `MemoryRef.kind` 语义丢失 | P2（延后） | ❌ **延后阶段 3** | 契约 v1.1.0 bump + 10+ 文件联动，见 §5 说明 |

---

## 2. 变更文件清单

| 文件 | 变更类型 | 修复项 | 说明 |
|------|---------|--------|------|
| `src/config/env.ts` | 修改 | P2-013 | 新增 `ENABLE_DEV_ENDPOINTS: bool.default(false)` 字段；`envSchema` 导出供测试 |
| `.env.example` | 修改 | P2-013 | 同步新增 `ENABLE_DEV_ENDPOINTS=false` 与注释 |
| `src/app/api/pet/generate-event/route.ts` | 修改 | P2-013 | `isDevEndpointEnabled` 类型收窄为 `ENABLE_DEV_ENDPOINTS?: boolean`，比较改为 `=== true` |
| `tests/unit/config/env.test.ts` | **新增** | P2-013 | 11 用例覆盖 zod 解析、fail-closed、白名单、非法值、组合逻辑 |
| `src/app/api/pet/create/route.ts` | 修改 | P3-N001 | 删除未使用的 `INITIAL_EVENT_COUNT` 常量 |
| `src/domain/memory/anchoring.ts` | 修改 | P2-007 | `generateTimeAnchor` 删除 `daysAgo > 6` 不可达分支，删除 `now` 参数与 `_now` 死变量 |
| `src/domain/events/generators/outing.ts` | 修改 | P3-001 | 删除未使用的 `randFloat` import 与 `void randFloat` |
| `src/domain/events/generators/announcement.ts` | 修改 | P3-001 | 系统公告不需要随机性，删除 `rng` 解构与 `void rng` |
| `src/domain/events/generators/reply-letter.ts` | 修改 | P3-001 | 删除未使用的 `pickOne` import 与 `void pickOne` |
| `docs/packs-contract.md` | 修改 | P2-012 | aggregate_summary 契约 `recall_min_count` 从 0 改为 1（对齐实际 `nameForceProb=1` 行为） |
| `docs/current-stage.md` | 修改 | P3-004 | 文案总数从 121 改为约 113；测试数从 223 更新为 259；补充 Round 2 修复后测试统计 |

---

## 3. 逐项修复说明

### 3.1 P2-013 · `ENABLE_DEV_ENDPOINTS` 白名单机制死代码 ✅

**问题回顾**（Round 2 §5.1）：

`generate-event/route.ts` 依赖 `env.ENABLE_DEV_ENDPOINTS === "true"`，但 `src/config/env.ts` 的 zod schema 未声明该字段。由于 `z.object()` 默认 strip 未声明键，运行时该字段永远为 `undefined`，白名单永远返回 false。默认拒绝是 fail-closed 安全（生产端点仍然 403），但错误消息误导用户「需设置 ENABLE_DEV_ENDPOINTS=true」。

**修复**：

1. **`src/config/env.ts`**：在 `envSchema` 中注册字段
   ```ts
   // 是否开启开发端点白名单（Round 2 修复 P2-013）。
   // 生产模式下 /api/pet/generate-event 默认禁用；仅当此字段显式为 true 才允许开启。
   ENABLE_DEV_ENDPOINTS: bool.default(false),
   ```
   使用现有 `bool` 转换器，支持 `true/false/1/0` 字符串与 boolean 混合。

2. **`src/app/api/pet/generate-event/route.ts`**：类型收窄 + 比较改为严格 boolean
   ```ts
   function isDevEndpointEnabled(env: { NODE_ENV?: string; ENABLE_DEV_ENDPOINTS?: boolean }): boolean {
     const isProd = env.NODE_ENV === "production";
     if (!isProd) return true;
     return env.ENABLE_DEV_ENDPOINTS === true;
   }
   ```
   zod 已把 `"true"` / `"1"` 转换为 `true`（bool.transform），此处直接 `=== true` 即可。

3. **`.env.example`**：同步文档化
   ```bash
   # 是否开启开发端点白名单（Round 2 P2-013）
   # 默认 false：生产模式下 /api/pet/generate-event 拒绝请求（返回 403）
   # 置 true 可开启白名单，供内网演示 / staging 手动触发事件调试
   # 警告：本项仅影响 /api/pet/generate-event，不会放宽其他端点
   ENABLE_DEV_ENDPOINTS=false
   ```

4. **`tests/unit/config/env.test.ts`**（新增）：11 用例
   - 未设置 → 默认 false
   - `"true"` / `"1"` → true
   - `"false"` / `"0"` → false
   - 非法字符串 → safeParse 失败
   - 生产 + 未设白名单 → 拒绝
   - 生产 + `ENABLE_DEV_ENDPOINTS=true` → 允许
   - 开发模式 → 允许（不管白名单）
   - TS 编译期断言 `Env.ENABLE_DEV_ENDPOINTS: boolean`

**验证**：

```bash
$ node -e "import('./src/config/env.ts').then(m => console.log(m.envSchema.safeParse({NODE_ENV:'production', ENABLE_DEV_ENDPOINTS:'true'}).data.ENABLE_DEV_ENDPOINTS))"
true  # 之前是 undefined（白名单失效）
```

**风险**：极低。默认值 fail-closed（`false`），与之前行为完全一致；仅当显式设 `=true` 才生效。

---

### 3.2 P3-N001 · `create/route.ts` 未使用常量 ✅

**问题回顾**（Round 2 §5.2）：

P2-008 修复后 `INITIAL_EVENT_COUNT = 2` 常量被 `1 + Math.floor(Math.random() * 3)` 取代，但常量未删除。

**修复**：`src/app/api/pet/create/route.ts`

- 删除 `const INITIAL_EVENT_COUNT = 2;`
- 保留位置注释解释随机化实现，避免后续维护者困惑

**验证**：`npx tsc --noEmit` 通过（无 unused 告警）。

---

### 3.3 P2-007 · `generateTimeAnchor` 死代码分支 ✅

**问题回顾**（Round 1 报告 §4）：

`generateTimeAnchor` 中 `daysAgo = 1 + Math.floor(rng() * 6)` 只会产出 1..6，但代码保留了 `daysAgo <= 9 / <= 14 / else` 三个不可达分支，同时 `_now` 变量也未使用。

**修复**：`src/domain/memory/anchoring.ts`

- 删除 `_now = now ?? Date.now()` 与 `void _now`
- 删除 `now?: number` 参数
- 删除 `daysAgo <= 9`（上周）、`daysAgo <= 14`（上上周）、`else`（很久之前）三个不可达分支
- 保留 1..6 的四种表达：昨天 / 前天 / X 天前 / 前几天
- 更新注释：若需「上周/上上周/很久之前」，使用 `pickAnchor`（独立候选池）

**验证**：

- `tests/unit/domain/memory/anchoring.test.ts` 原有 6 用例全部通过（无回归）
- `grep "daysAgo.*<=.*9" src/domain/memory/anchoring.ts` → 0 匹配

**风险**：无。行为不变（原本就只走 1..6 分支）。

---

### 3.4 P2-012 · aggregate-summary 契约矛盾 ✅

**问题回顾**（Round 1 报告 §4）：

- 代码：`aggregate-summary.ts:37` 使用 `nameForceProb: 1`（强制注入 pet_name）
- 契约：`§5` 声明 `recall_required: pet_name（强制）` + `recall_min_count: 0`

两者矛盾——既然「强制」，`recall_min_count` 不应为 0。

**修复选择**：

对齐代码 → 契约更新。理由：聚合摘要是"给 pet 的一句话总结"，pet 名字必须出现在文案中才有上下文；`nameForceProb=1` 是设计意图，改为 0.5 会让部分聚合事件不带名字，不符合业务预期。

**修复**：`docs/packs-contract.md §5`

```markdown
| `aggregate_summary` | catchup | `span_days, items_collected, outings, travel_nights` | `pet_name`（强制） | 1 | no-op |
```

同时删除下方「nameForceProb=1 与 recall_min_count=0 同时存在」的说明性注释，替换为一句对齐说明。

**验证**：契约表述与代码一致，无运行时影响（契约是文档）。

**风险**：极低。仅是契约与代码对齐。若未来需要改为"非强制"，只需将 `nameForceProb` 降为 0.5 并同步契约。

---

### 3.5 P3-001 剩余 · 生成器死代码 `void X;` 清理 ✅

**问题回顾**（Round 1 报告 §5，P3-001）：

Round 1 修了 `generate-event/route.ts` 里的 3 处 `void X;`，Round 2 报告确认剩余 3 处仍在生成器里：`announcement.ts:25`、`outing.ts:56`、`reply-letter.ts:80`。这些是"避免 TS unused import/param 报错"的占位符，无实际功能。

**修复**：

1. **`outing.ts`**：删除未使用的 `randFloat` import 与 `void randFloat`
   ```ts
   // 之前：import { randInt, randFloat, pickOne } from "../rng";
   // 之后：import { randInt, pickOne } from "../rng";
   ```

2. **`announcement.ts`**：系统公告不需要随机性，删除 `rng` 解构与 `void rng`
   ```ts
   // 之前：const { pet, rng = Math.random } = ctx; void rng;
   // 之后：const { pet } = ctx;
   ```

3. **`reply-letter.ts`**：删除未使用的 `pickOne` import 与 `void pickOne`

**验证**：`grep -rn "void .*;" src/domain/events/generators/` → 0 匹配

**风险**：无。所有 `void X;` 本就是无用语句，删除不影响运行时行为。测试全部通过。

---

### 3.6 P3-004 · `current-stage.md` 文案数声明不符 ✅

**问题回顾**（Round 1 §5.3）：

`docs/current-stage.md:44` 声明"121 条独特文案"，实际因 `system-announce.json` 只有 2 daily + 1 poetic = 3 条（非 8+3），实际是 11 类 × 9 - (8+3-3) = 113 条。

**修复**：`docs/current-stage.md`

- 文案总数从 `121 条独特文案` 改为 `约 113 条独特文案（11 类 × 9 变体，扣 system-announce 变体较少）`
- 测试统计从 `新增 79 个单测，总计 223 个单测通过` 更新为 `新增 104 个单测，总计 259 个单测通过`（含 Round 2 修复后的 +11 用例）
- 契约版本从 `v1.0.0` 更新为 `v1.0.1`
- 补充 Round 2 各阶段测试新增统计

---

## 4. 验证结果

### 4.1 类型检查

```bash
$ npx tsc --noEmit
# 无输出，0 错误
```

### 4.2 单元测试

```bash
$ npx vitest run
 Test Files  25 passed (25)
      Tests  259 passed (259)
   Duration  4.71s
```

**较 Round 2 收官的 248/248 净增 +11 用例**（env.test.ts 新增 11 用例覆盖 P2-013 回归）。

### 4.3 Next.js 构建

```bash
$ npx next build
# ✓ Compiled successfully
# 15 条路由全部注册
# 无 filesystem access 告警
# 无 build 错误
```

### 4.4 硬约束验证

```bash
$ grep -rn "from 'next\|from 'react" src/domain/
# 0 匹配（领域层零框架依赖硬约束保持）✅

$ grep -rn "sqlite\|better-sqlite" src/
# 0 匹配（MySQL 硬约束保持）✅

$ grep -rn "void .*;" src/domain/events/generators/
# 0 匹配（P3-001 完全清理）✅

$ grep -n "ENABLE_DEV_ENDPOINTS" src/config/env.ts .env.example
# 各 1 匹配（P2-013 白名单机制已激活）✅
```

---

## 5. 未修复项说明

### 5.1 P2-006 · `MemoryRef.kind` 语义丢失（延后阶段 3）

**问题**：`recall-strategy.ts:60` 把 `preference / place_visited / sentiment / custom` 全部归入 `place` 类锚点，丢失语义类型。

**未修原因**：

1. **契约冻结状态**：修改 `MemoryRef.kind` 类型定义需要 bump `pack_schema_version` 到 `1.1.0`（minor，向后兼容扩展）。当前契约 v1.0.1 是 Round 2 收官版本，阶段 2 结束才冻结；再在同阶段 bump 会打破"阶段 2 冻结契约"的承诺。

2. **文档联动面广**：需要更新至少 5 处
   - `src/domain/types.ts` — MemoryRef.kind 增加 `"preference" | "sentiment"`
   - `src/domain/memory/recall-strategy.ts` — `memoryToRef` 映射
   - `src/domain/events/render.ts` — `buildPlaceholderMap` 的 recallLine 构造（preference/sentiment 没有对应的自然语言模板）
   - `docs/packs-contract.md` — §5 表、§7 元数据章节
   - `docs/architecture.md` — §5 接口定义（`line 596-597`）
   - `src/domain/events/types.ts` — `PACK_SCHEMA_VERSION = "1.1.0"`
   - `src/assets/packs/default/manifest.json` — `pack_schema_version`
   - 所有 pack_schema_version 相关的测试 fixture

3. **`recallLine` 构造规则未定**：preference（如"喜欢黄昏"）、sentiment（如"感到温暖"）没有现成的自然语言包装模板。当前只有三种：
   - time_anchor → `"{value}发生过的事"`
   - item_name → `"收到过的 {value}"`
   - place → `"{value}"`
   
   preference/sentiment 若强行归入 place 会保留旧语义丢失问题；若要独立，需要为它们设计新模板，属于**文案设计工作**，应在阶段 3 用户档案 UI 落地时统一规划。

4. **阶段 3 更合适**：P2-006 的实际影响面在**用户档案页分组显示**（阶段 3 内容），阶段 2 UI 只使用事件卡片不分组，功能上不阻塞。

**建议**：阶段 3 启动用户档案页时一并处理，配套：
- 契约版本 bump 到 v1.1.0
- 增加 preference/sentiment 的 recallLine 模板（如 `"想到 {value} 的时候"` / `"心里想着 {value}"`）
- 用户档案页支持按 kind 分组展示

---

## 6. 与 Round 2 报告的对应关系

| Round 2 报告项 | 本轮处理 | 说明 |
|---------------|---------|------|
| §5.1 P2-013（新 P2） | ✅ 已修（§3.1） | env schema 注册 + 类型收窄 + 11 用例测试 |
| §5.2 P3-N001（新 P3） | ✅ 已修（§3.2） | 删除未使用常量 |
| §4.1 P2-006（延后） | ❌ 仍延后阶段 3（§5.1） | 契约冻结冲突，见说明 |
| §4.1 P2-007（延后） | ✅ 已修（§3.3） | 删除死代码分支 |
| §4.1 P2-012（延后） | ✅ 已修（§3.4） | 契约与代码对齐 |
| §4.2 P3-001 剩余（延后） | ✅ 已修（§3.5） | 3 个生成器清理 |
| §5.3 P3-004（延后） | ✅ 已修（§3.6） | 文档微调 |
| §4.2 其他 6 项 P3 | ❌ 延后阶段 3 | 低优先级，不影响演示 |

---

## 7. 测试覆盖演进

| 项 | Round 2 收官 | 本轮修复后 | 净增 |
|---|-------------|-----------|-----|
| 测试文件数 | 24 | **25** | +1（env.test.ts） |
| 单测用例数 | 248 | **259** | **+11** |
| `ENABLE_DEV_ENDPOINTS` 覆盖 | 0 | **11**（新增） | +11 |
| `void X;` 死代码数 | 3（生成器） | **0** | -3 |

---

## 8. 阶段 2 收官状态

| 维度 | Round 2 状态 | 本轮修复后 |
|-----|-------------|-----------|
| P0 阻塞 | 0 ✅ | **0** ✅ |
| P1 严重 | 0 ✅ | **0** ✅ |
| P2 一般（本轮相关） | 1（P2-013 新） | **0** ✅ |
| P2 一般（延后阶段 3） | 3（P2-006/007/012） | **1**（仅 P2-006） |
| P3 轻微 | 8 + P3-N001 新 | **7**（延后阶段 3） |
| 单测通过 | 248/248 ✅ | **259/259** ✅ |
| 类型检查 | 通过 ✅ | **通过** ✅ |
| 构建 | 通过 ✅ | **通过** ✅ |
| 领域层零 next/react | ✅ | **✅** |
| MySQL 硬约束 | ✅ | **✅** |

**结论**：本轮修复后，阶段 2 所有相关 P1/P2 问题全部清零；剩余 1 项 P2（P2-006）与 7 项 P3 已明确延后阶段 3，均有理由。

---

## 9. 交付清单

- [x] P2-013 修复（env schema + route + .env.example + 11 用例测试）
- [x] P3-N001 修复（删除未使用常量）
- [x] P2-007 修复（清理死代码分支）
- [x] P2-012 修复（契约对齐）
- [x] P3-001 剩余修复（3 个生成器清理）
- [x] P3-004 修复（文档微调）
- [x] 类型检查通过（`npx tsc --noEmit`）
- [x] 单元测试通过（259/259）
- [x] Next.js 构建通过
- [x] 硬约束验证通过（领域层零框架 + MySQL）
- [x] `docs/current-stage.md` 更新测试统计
- [x] `reports/fix-round-2.md` 修复报告

**未处理（明确延后阶段 3）**：
- P2-006 · MemoryRef.kind 语义丢失（契约 v1.1.0 bump + 8+ 文件联动）
- 7 项 P3 低优先级

---

## 10. 下一步建议

1. **交 git 提交专员提交**：本轮所有变更可提交（不阻塞阶段 2 收官）
2. **进入阶段 3 计划**：
   - 阶段 3 启动前建议先做 P2-006 契约 bump（配合用户档案页设计）
   - 时间线 UI、补算、聚合摘要 UI 是阶段 3 主体
3. **无需再补测试**：本轮测试覆盖已达标（259/259，含 11 用例覆盖 P2-013 回归）

---

## 11. 签名

- **软件工程师：2026-09-10（Round 2 收官修复）**
- 报告文件：`reports/fix-round-2.md`
- 关联文件：
  - `reports/qa-round-2.md`（Round 2 质检输入）
  - `reports/fix-round-1.md`（Round 1 修复报告）
  - `docs/packs-contract.md`（契约 v1.0.1，本轮未 bump）
  - `docs/current-stage.md`（阶段 2 交付统计更新）
- **结论**：✅ 阶段 2 P1/P2 修复清零，可提交进入阶段 3
