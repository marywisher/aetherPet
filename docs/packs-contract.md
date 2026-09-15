# AetherPet 素材包契约（Pack Contract）

> 版本：**v1.1.0**（pre-launch 增量 1 — pack_schema 兼容扩展）  
> 冻结时间：阶段 2（2024-06）；§5/§6/§8.4 同步于 2026-09-15  
> 适用范围：AetherPet 素材包（`src/assets/packs/<name>/`）  
> 演进规则见 §8
> 本版本变更：新增 `first_meeting` 事件类型（第 12 类）+ `guidance` 文案组；
> §5 事件表加 `first_meeting` 行；§6 补字段级回退优先级；§8.4 清单补 RANDOM_TYPES 排除；
> §10 变更历史记录

---

## 1. 素材包目录布局

```
src/assets/packs/<name>/
├── manifest.json         # 包元信息（必填）
├── theme.css             # 视觉 CSS（必填，含 --pack-* 变量）
└── text/                 # 12 个事件类型 + 1 个引导组文本 JSON（11 旧键必填，新键可选）
    ├── outing.json
    ├── watching-water.json
    ├── counting-leaves.json
    ├── self-talk.json
    ├── brought-item.json
    ├── reply-letter.json
    ├── spontaneous-letter.json
    ├── aggregate-summary.json
    ├── system-announce.json
    ├── daily-grant.json
    ├── offer-received.json
    ├── first-meeting.json    # 可选（pack_schema 1.1.0）
    └── guidance.json         # 可选（pack_schema 1.1.0）
```

MVP 阶段不引入 `fonts/` / `icons/` / `particles/` 等目录（阶段 5 才开放）。

---

## 2. manifest.json 契约

**唯一权威**：`src/domain/packs/manifest-schema.ts` 中的 zod schema `PackManifestSchema`。
本节内容作为人读快照，与 schema 严格对齐；schema 变动时必须同步本节。

```jsonc
{
  // ===== 包元信息（顶层必填） =====
  "name": "default",                        // 包唯一标识（用作 activePackName；^[a-z0-9_-]+$，≤64）
  "display_name": "官方默认（手绘暖调）",     // 展示名（≤128）
  "version": "1.0.0",                       // 包本身版本（semver）
  "pack_schema_version": "1.0.0",           // 契约版本（本文件），仅支持 1.x.x
  "min_engine_version": "1.0.0",            // 最低引擎版本
  "author": "AetherPet core team",          // 作者（非空）
  "license": "MIT",                         // 授权（非空）

  // ===== 主题与视觉 =====
  "theme": {
    "css": "theme.css",                     // 相对路径，加载后内联到前端
    "palette": {                            // 前端可直接用 CSS 变量 --pack-* 引用
      "primary":     "#e8a87c",
      "accent":      "#85c485",
      "memory_ref":  "#d4b483",             // 记忆引用高亮色
      "paper":       "#f6efe4",
      "ink":         "#3d2f23"
    }
  },

  // ===== 资产（可选，key-value 映射） =====
  "assets": {
    "home_bg":   "images/home-bg.svg",
    "letter_bg": "images/letter-bg.svg"
  },

  // ===== 11 个事件文案（键名与事件类型一一对应，路径相对于包根目录） =====
  "texts": {
    "outing":              "text/outing.json",
    "watching_water":      "text/watching-water.json",
    "counting_leaves":     "text/counting-leaves.json",
    "self_talk":           "text/self-talk.json",
    "brought_item":        "text/brought-item.json",
    "reply_letter":        "text/reply-letter.json",
    "spontaneous_letter":  "text/spontaneous-letter.json",
    "aggregate_summary":   "text/aggregate-summary.json",
    "system_announce":     "text/system-announce.json",
    "daily_grant":         "text/daily-grant.json",
    "offer_received":      "text/offer-received.json"
  },

  // ===== 回退声明（MVP 阶段固定 null；未来若启用可选回退到另一包名） =====
  "fallback": null
}
```

**约束要点**（与 `PackManifestSchema` 一致）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 包唯一标识，正则 `^[a-z0-9_-]+$`，长度 1–64 |
| `display_name` | string | ✅ | 展示名，1–128 |
| `version` | string | ✅ | semver `x.y.z` |
| `pack_schema_version` | string | ✅ | 契约版本，仅支持 `1.x.x`；其他大版本被 loader 拒绝 |
| `min_engine_version` | string | ✅ | semver，提示素材包最低所需引擎 |
| `author` | string | ✅ | 非空 |
| `license` | string | ✅ | 非空 |
| `theme.css` | string | ✅ | 相对路径，文件必须存在于包目录 |
| `theme.palette.*` | string | ✅ | 5 个颜色字段全必填 |
| `assets` | object | 默认 `{}` | 键任意，值必须为相对路径 |
| `texts.{11 事件类型}` | string | ✅ | 11 个事件类型的相对路径，缺一即校验失败 |
| `fallback` | string \| null | 默认 `null` | MVP 恒 null |

其他未知字段：`passthrough()` 允许，loader 会保留但不消费（便于包作者加自定义元数据）。

**校验流程**：
1. `parsePackManifest(raw)` 用 `PackManifestSchema.safeParse(raw)` 校验结构
2. `isPackSchemaVersionSupported(v)` 拒绝非 `1.x.x` 的契约版本
3. loader 读取 `theme.css` 文件；若不存在，`fallbackReason = "theme_css_missing"`
4. 校验失败时 loader 回退到 default 包，并向 audit 表写 `pack_load_failed`

---

## 3. text/*.json 通用结构

```jsonc
{
  "title": {
    "mode": "fixed" | "template",              // 固定文本 or 模板
    "default": "...",                          // mode='fixed' 时使用
    "variants": ["...", "..."]                 // mode='template' 时使用
  },
  "body": {
    "mode": "template",                       // 目前仅支持 template
    "variants": {
      "daily": ["...", "..."],                // 日常废话档（占 90%）
      "poetic": ["...", "..."]                // 诗意档（占 10%）
    },
    "poetic_ratio": 0.1                       // 抽样概率（0.05~0.15 之间）
  },
  "sign_off": {
    "mode": "fixed" | "template",
    "default": "—— {pet_name}",                // fixed
    "variants": ["—— {pet_name}", "..."]       // template 支持多签名
  },
  "recall_required": ["pet_name", "item_name", ...],  // 契约要求的 memory kind
  "recall_min_count": 0                        // 最少引用条数
}
```

---

## 4. 占位符命名规范

| 占位符 | 来源 | 类型 | 适用事件 |
| --- | --- | --- | --- |
| `{pet_name}` | `pet.name` | 字符串 | 全部 |
| `{item}` | `params.item_display_name` 或 memory_refs 中 `item_name` | 字符串 | brought_item, reply_letter, daily_grant, offer_received |
| `{count}` | `params.count` | 整数（渲染为字符串） | counting_leaves |
| `{place}` | `params.place` | 字符串 | watching_water |
| `{destination}` | `params.destination` | 字符串 | outing |
| `{duration_hours}` | `params.duration_hours` | 整数（小时） | outing |
| `{duration_minutes}` | `params.duration_minutes` | 整数（分钟） | watching_water |
| `{span_days}` | `params.span_days` | 自然化字符串（"3 天"/"2 周"/"1 个多月"） | aggregate_summary |
| `{outings}` | `params.outings` | 整数 | aggregate_summary |
| `{items_collected}` | `params.items_collected[]` | 拼接字符串（"3 个 枯叶、5 个 浆果"） | aggregate_summary |
| `{recall_line}` | 从 memory_refs 提炼 | 字符串（"几天前发生过的事"等） | self_talk, spontaneous_letter 等 |
| `{announcement_title}` | `params.announcement_title` | 字符串 | system_announce |
| `{announcement_body}` | `params.announcement_body` | 字符串 | system_announce |

**约定**：
- 未识别占位符在渲染时**保留原样**（如 `{foo}` → `{foo}`），便于调试
- 占位符名使用 `snake_case`，全小写，仅含字母/数字/下划线
- 新增占位符必须同步更新 `docs/packs-contract.md` 与本表

---

## 5. 事件契约速查表

**FSM 列释义**：箭头 `A → B` 表示该事件触发的 FSM 转换；`no-op` 表示不改变 pet 状态。
**recall_required 列释义**：标注为（强制）的 kind 由生成器强制注入 memoryRefs；未标注为“期望”，引擎尽最大努力，不保证。

| 事件类型 | source | 关键 params | recall_required | recall_min_count | FSM 动作 |
| --- | --- | --- | --- | --- | --- |
| `outing` | engine | `destination, duration_hours` | `place`（期望）, `time_anchor`（期望） | 1 | at_home → out_walking |
| `watching_water` | engine | `place, duration_minutes` | `place`（期望）, `time_anchor`（期望） | 1 | no-op |
| `counting_leaves` | engine | `count` | `time_anchor`（期望） | 0 | no-op |
| `self_talk` | engine | `mood` | `time_anchor`（期望）, `pet_name`（期望） | 0 | no-op |
| `brought_item` | engine | `item_id, item_display_name` | `item_name`（强制）, `pet_name`（期望） | 1 | **out_walking → at_home** |
| `spontaneous_letter` | engine | `trigger` | `time_anchor`（期望）, `pet_name`（期望） | 0 | no-op |
| `reply_letter` | gift | `gift_event_id, item_display_name` | `item_name`（强制）, `pet_name`（强制）, `time_anchor`（期望） | 1 | no-op |
| `daily_grant` | gift | `item_id, item_display_name` | `item_name`（强制）, `pet_name`（期望） | 1 | no-op |
| `offer_received` | gift | `item_id, item_display_name, offer_event_id` | `item_name`（强制）, `pet_name`（强制）, `time_anchor`（期望） | 1 | no-op |
| `aggregate_summary` | catchup | `span_days, items_collected, outings, travel_nights` | `pet_name`（强制） | 1 | no-op |
| `system_announce` | system | `announcement_id, announcement_title, announcement_body` | — | 0 | no-op |
| `first_meeting` | creation | — | — | 0 | no-op |

> **注（pack_schema 1.1.0）**：`first_meeting` 的 source 为 `creation`（仅创建流程显式触发 1 次），
> 不进 `RANDOM_TYPES`、不进补算池、不进 dev FORCE_TYPES 白名单。

> 注（Round 2 修复 P2-012）：`aggregate_summary` 的 `nameForceProb=1` 与契约 `recall_min_count=1` 现已对齐（之前为 0，与实际强制注入 pet_name 行为不一致）。聚合摘要以“给 pet 的一句话总结”为目标，pet 名字必须出现在文案中才有上下文。

**FSM 一致性保证**（阶段 2 Round 2 修复 P1-004）：

- FSM 定义了 4 个真实动作：`outing_start` / `outing_end` / `trip_start` / `trip_end`。
- 目前只有 `outing_start`（outing）和 `outing_end`（brought_item）由引擎驱动。
- `trip_start` / `trip_end` 留给阶段 4 旅行玩法。
- 若 pet 当前状态与 FSM 动作不匹配（如在 `at_home` 触发 `outing_end`），引擎将其视为 no-op，事件仍入库但状态不变。

---

## 6. 渲染规则

### 6.1 抽样

- 抽样分**日常档**与**诗意档**两档，档位比例由 `body.poetic_ratio` 决定（默认 0.1 = 9:1）
- 档位内变体**均匀随机**（不重复抽）
- 空 `poetic` 数组时永不抽中诗意档
- 空 `daily` 数组时若档位抽中日常，回退到诗意档

### 6.2 占位符替换

- 替换在渲染时完成，用正则 `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g`
- 未匹配占位符保留原样，便于调试
- 替换源（`buildPlaceholderMap`）优先级：`params` > `memory_refs` > 调用方 extra

### 6.3 记忆引用高亮

- `renderEvent` 返回 `highlightTokens: [{kind, value}]`
- 前端用 `<span data-mem>{value}</span>` 包裹
- 高亮规则：若 `ref.value` 出现在渲染后的 title/body/sign_off 中，则加入 tokens
- 前端可用 CSS 变量 `--pack-memory-ref` 定义高亮样式

### 6.4 文案比例

- 日常 vs 诗意 ≈ 9:1（每事件文本的抽样比例）
- 全部素材包合计不少于 60 条独特文案（阶段 2 目标）

### 6.5 字段级回退优先级（pack_schema 1.1.0）

pack_schema 1.1.0 新增的可选键（`texts.first_meeting` / `texts.guidance` / `assets.first_meeting_note`）
由 loader 在加载完成后统一**物化**：非 default 包缺失上述任一键时，从 default 包同名键拷贝。
渲染消费方（renderEvent、前端 packs API）零改动。回退优先级（降序）：

1. **自身键** — 本包 manifest 存在该键 → 直接加载
2. **default 包同名键** — 本包缺键，且 default 包有 → 物化阶段拷贝
3. **降级形态** — default 包也缺键 → `renderEvent(null)` 纯文本 / 前端不显示插图

> 1.0.x 的 11 个必填键不走字段级回退——这些键缺失时整包回退到 default（`fallback.ts` 整包级语义），
> 不产生混合观感。
> 1.1.0 新增键维持「字段级回退不扩散」的原则：不会影响既有渲染逻辑。

---

## 7. 元数据（memory_refs）与文案的对应关系

素材包 JSON 的 `recall_required` 声明**期望**的 memory kinds，但**不强制**——引擎可能因为记忆池不足而不满足全部要求。生成器内部会尽量注入必需的 refs（如 `brought_item` 强制挂 `item_name`），但调用方不应假设。

例如 `brought-item.json` 声明：
```json
"recall_required": ["item_name", "pet_name"],
"recall_min_count": 1
```
引擎在生成时：
1. 通过 `recallForPet` 抽取 refs
2. 若结果不含 `item_name`，用 `params.item_display_name` 合成一条
3. 若结果不含 `pet_name` 且 `NAME_FORCE_PROB` 命中，合成一条

---

## 8. 契约演进规则

### 8.1 版本号策略

- `pack_schema_version` 与 `engine_version` 独立演进
- **major** 版本（如 1.0.0 → 2.0.0）：破坏性变更（新增事件类型、改变占位符、删事件），需要 loader 支持双版本
- **minor** 版本（如 1.0.0 → 1.1.0）：向后兼容扩展（新增占位符、新增可选字段），老引擎应能忽略
- **patch** 版本（如 1.0.0 → 1.0.1）：修文案错误、修 bug，不改契约

### 8.2 破坏性变更清单

以下变更必须升 major：

- 移除或重命名事件类型
- 修改占位符名（如 `{item}` → `{item_name}`）
- 修改 text 顶层结构（如 `body.variants.daily` → `body.variants.everyday`）
- 修改 `sign_off` 语义

### 8.3 向后兼容变更

以下变更可走 minor：

- 新增事件类型（旧引擎忽略）
- 新增占位符（旧引擎保留原样）
- 新增可选字段（旧引擎忽略）

### 8.4 新增事件类型清单

新增事件类型必须同步以下 10 项（阶段 2 Round 2 补充 3 项 UI/文档；pre-launch 增量 1 补充 RANDOM_TYPES/补算池排除）：

1. `src/domain/events/generators/<name>.ts` — 生成器实现
2. `src/domain/events/templates.ts` — 注册到 GENERATORS（及 RANDOM_TYPES，如适用）
3. `src/assets/packs/default/text/<name>.json` — 素材包文案（8 daily + 3 poetic 变体）
4. `docs/packs-contract.md §5` — 契约表追加一行
5. `src/domain/packs/manifest-schema.ts` — `texts` 对象中新增字段（1.1.0 起可选键用 `.optional()`）
6. `docs/architecture.md §7` — 事件类型表追加
7. **`src/ui/event-card.tsx`** — `TYPE_LABELS` 字典新增中文名标签（否则 UI 会直接显示 event type 字串）
8. **`src/app/page.tsx`** — 若需开发模式手动触发按钮，追加到 `FORCE_TYPES`；否则省略
9. **`docs/packs-contract.md §4`** — 若新增占位符，占位符表同步追加
10. **`RANDOM_TYPES` / 补算池** — 若不希望该类型被随机触发，必须显式排除（`first_meeting` 先例：不进 `RANDOM_TYPES`、不进 planner `CANDIDATE_TYPES`、不进 dev `FORCE_TYPES`）

### 8.5 已知限制（阶段 2）

- `on_trip` 状态目前只可选 `self_talk` / `spontaneous_letter`（travel 玩法到阶段 4）
- `brought_item` 强制触发 `outing_end`：即使 pet 不在 `out_walking` 也会产生事件（事件本身无 FSM 副作用），
  后续如需严格保证“必须先出门才能带回”，应在 engine.ts 的 `pickRandomTypesByState` 中根据状态动态排除。

---

## 9. 引擎-素材包解耦原则

- **引擎**（`src/domain/events/`）只产出结构（`type + params + memoryRefs`），不含文案
- **素材包**（`src/assets/packs/`）只提供文案与视觉，不含逻辑
- **渲染**（`src/domain/events/render.ts`）负责把两者粘合，产出最终字符串与高亮 tokens
- 领域层（`src/domain/**`）**禁止** import next/react；渲染纯函数可放在 domain 里，UI 组件放在 `src/ui/`

---

## 10. 变更历史

- **v1.1.0（pre-launch 增量 1 — 2026-09-15）**：
  - 新增事件类型 `first_meeting`（第 12 类），source = `creation`，FSM no-op；不进 `RANDOM_TYPES` / 补算池 / dev `FORCE_TYPES`（§5 表 / §8.4 清单同步）
  - 新增可选文案组 `guidance`（`desk_hint` + `first_session_farewell`）
  - §6 新增 6.5 字段级回退优先级（loader 物化，不扩散）
  - §8.4 新增第 10 项 RANDOM_TYPES/补算池显式排除
  - §1 目录布局更新（新增可选文件）
  - 兼容：1.0.x 旧包零改动继续可用（新键可选 + 物化回退 default）
- **v1.0.1（阶段 2 Round 2）**：
  - 修复 §2 manifest.json 契约与实际 `manifest-schema.ts` 不对齐（P1-003）
  - 修正 §5 brought_item 的 FSM 动作为 `out_walking → at_home`（P1-004）
  - §5 recall_required 列引入“强制/期望”标注（P2-010）
  - §8.4 新增事件类型清单补充 UI/占位符同步项（P3-005）
  - 新增 §8.5 “已知限制”小节，避免契约冻结误导后续开发
  - 文档修复不计入破坏性变更（patch bump）
- **v1.0.0（阶段 2 初版）**：首版冻结。11 个事件类型 + 11 个 text 文件 + 完整占位符表 + 记忆引用规则 + 契约演进策略。
