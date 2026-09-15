# AetherPet 发布前增量（§7）· 架构影响评估

> 状态：评估完成，供实现排期参考
> 日期：2026-09-14（对应 requirements.md §7 冻结决策 + product-review-pre-launch.md P0/P1/P2 修订项）
> 评估输入：`docs/architecture.md`、`docs/architecture-summary.md`（v1.1 架构事实）、`docs/requirements.md` §7、`docs/product-review-pre-launch.md`、当前代码事实（engine.ts / loader.ts / fallback.ts / manifest-schema.ts / pet/create/route.ts / sync/route.ts / daily-grant.ts / planner.ts / db.ts / page.tsx / event-card.tsx / render.ts / export/importer.ts）
> 范围声明：只做影响评估与实现建议，不写代码；不覆盖 `docs/architecture.md` / `docs/architecture-summary.md`，本文档是两者的**增量附录**。

---

## 0. 结论速览（TL;DR）

| 维度 | 结论 |
|------|------|
| **DB migration** | **不需要**。`events.type` 为 `VARCHAR(64)` 无枚举约束，`first_meeting` 直接可存；首会话收尾句用 localStorage，无新列；馈赠跳过走既有 `pets.created_at` 字段判断 |
| **契约 major 变更** | **无**。pack_schema `1.0.0 → 1.1.0` 是 **minor**（新增可选键 `texts.first_meeting` / `texts.guidance`，旧包零改动继续可用）；event `schema_version` 保持 `1.0.0`（新类型是枚举扩展，Event 结构不变）；`packs-contract.md` 相应加补到 1.1.0 |
| 领域层改动面 | 事件引擎（新生成器 + typePool 选项）、packs（字段级回退物化）、gift（P0-1 跳过）、pet create（事务边界） |
| 前端改动面 | event-card TYPE_LABELS、首页状态图/页脚、login 页脚、gifts 空态 |
| 最大回归面 | 验收 3（引擎）、4（补算）、7（导出导入）、8（素材包）、10（馈赠闭环，P0-1 改口径） |

---

## 1. 事件引擎（first_meeting 生成器 + 类型池覆盖）

### 改动点
1. 新增第 12 类事件 `first_meeting` 的生成器与注册；
2. `EngineOptions` 新增「初始事件限定类型池」选项（P1-2 缩池：`watching_water / counting_leaves / self_talk`）；
3. 初始事件从 1–3 条降为 1–2 条，`ts` 倒推创建前 6~48h（见 §4）；
4. `EventSource` 联合类型新增 `creation` 值（P2-3）。

### 影响
- 现状 `src/domain/events/engine.ts` 的 `pickRandomTypesByState` 在 `at_home` 时直接返回 `RANDOM_TYPES`（`templates.ts` L38，6 类型）；create 路由 `generateBatchEvents(pet, [], initialCount)` 走的就是这个默认池——**新决策要求初始事件不走默认池**，必须加 opt-in 覆盖项，不能改默认路径（会污染常规随机行为与验收 3）。
- `generateBatchEvents` 内部每条事件复用同一个 `opts.ts`（同值）——倒推 6~48h 要求**每条 ts 不同**，需 per-event ts 能力。
- `first_meeting` 是「创建时刻一次性」事件：不进 `RANDOM_TYPES`（常规随机池）、不进补算池（planner 的 `CANDIDATE_TYPES` 是**独立硬编码副本**，天然排除）、不进开发端点 forceType 白名单。三处都需要守卫。

### 实现建议（具体文件路径）
| 落点 | 建议 |
|------|------|
| `src/domain/types.ts` | `EventType` 枚举加 `FIRST_MEETING: "first_meeting"`（12 类）；`EventSource` 加 `"creation"` |
| `src/domain/events/generators/first-meeting.ts`（新建） | 无 params、FSM **no-op**（`transition` 保持 `at_home`，A2 依赖此）；`ts` 用 ctx 传入值（创建时刻）；memoryRefs 允许为空（初见时尚无记忆，命名 ref 由 create 路由现有合成逻辑补上） |
| `src/domain/events/templates.ts` | `GENERATORS` 注册 `first_meeting`；**`RANDOM_TYPES` 保持 6 项不动** |
| `src/domain/events/engine.ts` | `EngineOptions` 加 `typePool?: EventTypeValue[]`（非空时替代 `pickRandomTypesByState` 结果）与 `tsPerEvent?: number[]`（按 i 取 ts，缺省沿用 `ts`）；两者均为追加式可选，缺省行为零变化 |
| `src/app/api/pet/create/route.ts` | 初始事件改 `typePool: ["watching_water","counting_leaves","self_talk"]` + `count = 1 + Math.floor(Math.random()*2)`（1–2 条）+ `tsPerEvent` 倒推序列；`first_meeting` 单独一次 `generateNextEvent(pet, [], { forceType: "first_meeting", ts: createdAt })`；两者合进 P2-2 事务（见 §3.2） |
| 守卫（P2-3） | 新增单测（建议 `tests/unit/events-engine.test.ts` 增补）：① `RANDOM_TYPES` 不含 `first_meeting`；② `src/domain/catchup/planner.ts` 的 `CANDIDATE_TYPES` 不含 `first_meeting`；③ `/api/pet/generate-event` 白名单（dev `FORCE_TYPES`，`src/app/page.tsx` L57）不含 `first_meeting`；④ sync 补算路径永不产出 `first_meeting` |

### 风险
- **实现者顺手把 `first_meeting` 塞进 `RANDOM_TYPES`** → 初见叙事在每次随机触发中重复出现。靠上面 ①②③④ 四个单测锁死。
- `typePool` 若做成默认值替换而非 opt-in，会静默改变验收 3 的随机分布。签名上必须保持「不传 = 现有行为」。
- 倒推 ts 会写入 `state_since`（transition 用 event.ts 计算 nextStateSince）：初始事件的 stateSince = 倒推时刻。当前无功能消费「state_since ≥ created_at」，但需在 `CONTEXT.md` 补一句领域语义（与 §4 同一处落笔）。

---

## 2. 素材包契约（pack_schema 1.1.0 + 字段级回退 + 官方三包补键）

### 改动点
1. `manifest.texts.first_meeting` / `manifest.texts.guidance` 两个**可选**键；`assets.first_meeting_note` 新资产键；`guidance.json` 结构定死（`desk_hint` + `first_session_farewell`，`{pet_name}` 占位符渲染期替换）；
2. pack_schema `1.0.0 → 1.1.0`（minor，向后兼容）；
3. 新增「**字段级回退**」语义：键缺失 → 回退 default 包同名键 → default 也缺 → 无插图纯文案降级；
4. 官方三包（default / morning / night）补键。

### 影响（基于代码事实，比评审报告多两条）
- `src/domain/packs/manifest-schema.ts`：现 schema 的 `texts` 对象是「11 必填键 + `.catchall(z.string())`」。**catchall 意味着旧包今天加 `first_meeting: "text/first-meeting.json"` 已经能通过校验**——真实改动是把这两个键**显式声明为 optional + 类型化**，语义上没有收紧，1.1.0 与 1.0.0 包在 loader 都合法。
- `src/domain/packs/loader.ts`：文本读取循环 `Object.entries(manifestData.texts)` 与图片循环 `Object.entries(manifestData.assets)` 都是**遍历 manifest 里实际存在的键**，未知键本来就会被读进 `pack.texts` / `pack.images`——文件缺失时静默跳过（现有逻辑）。所以**loader 的加载循环零改动**，字段级回退的真正缺口在「键不存在于 manifest 时没有补齐路径」。
- `src/domain/packs/fallback.ts` 是**整包级**回退（manifest/theme 损坏 → `effectivePack = defaultPack`），本次**不改动其语义**。
- `isPackSchemaVersionSupported` 正则 `^1\.` → 1.0.x 与 1.1.x 包混载无拒收风险。

### 实现建议
| 落点 | 建议 |
|------|------|
| `src/domain/packs/manifest-schema.ts` | `texts` schema 加 `first_meeting: z.string().min(1).optional()`、`guidance: z.string().min(1).optional()`（保留 11 必填键与 catchall）；类型 `PackManifest`（`src/domain/types.ts`）同步 |
| 字段级回退落点（P1-3） | **在 loader 后处理层「物化」**，而非渲染层运行时 merge：`loader.ts` `loadPacks()` 装载完全部包后，对每个**非 default** 包，若缺 `texts.first_meeting` / `texts.guidance` / `images.first_meeting_note`，从 default 包对应键拷贝进 `LoadedPack`。理由：① 渲染消费点（`sync/route.ts` 的 `pack?.texts[e.type]`、信件页、前端 packs API）**零改动**；② 物化发生在启动/刷新时刻，可单测（`_resetPacksCache` 已就位）；③ 边界清晰——字段级回退**仅限 1.1.0 新增的 3 个可选键**，1.0.0 的 11 必填键继续走整包级回退，语义不扩散 |
| 渲染降级兜底 | `src/domain/events/render.ts` `renderEvent(packText=null)` 已有最小文本路径；`src/ui/event-card.tsx` `TYPE_LABELS` 未命中显示裸 type 字符串（P1-4 观感事故点）→ 见 §5 |
| 官方三包补键 | `src/assets/packs/{default,morning,night}/manifest.json` bump `pack_schema_version: "1.1.0"` + 新增 `text/first-meeting.json`、`text/guidance.json`、`images/first-meeting-note.png`；`src/domain/events/types.ts` `PACK_SCHEMA_VERSION` 常量 `"1.0.0" → "1.1.0"` |
| 契约文档同步（P2-3 / §7.1.5 八项清单） | `docs/packs-contract.md`：§5 事件契约表加一行 `first_meeting | creation | 无 params | — | 0 | no-op`；§6 渲染规则补「字段级回退优先级：自身键 > default 包同名键 > 无插图占位」；§8.4 清单补「`RANDOM_TYPES` 显式排除」验收条件；§8.5 已知限制补「1.0.x 旧包渲染 1.1.0 事件走字段级回退」 |

### 风险
- **混合观感**：morning/night 若不补键，物化后是「morning 主题 + default 初见文案/插图」——评审已接受（A5 只断言不崩溃 + 文案来自 default），本期顺手补键即可消除。
- default 包自身损坏时，物化源为空 → `renderEvent(null)` 纯文本 + `TYPE_LABELS` 补 `first_meeting` 后不再是裸英文串，降级链完整（对应既有 R4 三层回退）。
- 物化是「启动快照」：default 包文本热更新（dev 模式 `refreshPacks`）后需重新物化——`refreshPacks` 清缓存重跑 `loadPacks` 即自动覆盖，无额外工作。

---

## 3. 创建流程

### 3.1 P0-1：创建当日跳过每日馈赠

- **改动点**：`grantDailyItem` 对「创建当日」跳过发放，首馈赠落在 T+1。
- **实现落点**：`src/domain/gift/daily-grant.ts`，在 `hasGrantedToday` 检查**之前**加：
  ```
  if (toLocalDateStr(pet.createdAt) === todayStr) → return { granted: false, skipReason: "created_today" }
  ```
  `DailyGrantSkipReason` 联合类型追加 `"created_today"`。
- **关键判据选择**：必须用 `pets.created_at`（该列已存在，`insertPet` 默认写 now），**不能用 `dailyGrantLastDate === null`**——因为 P0-1 跳过的当天不写 `daily_grant_last_date`，若以 null 判据跳过，T+1 仍为 null 会被再次误杀，馈赠永久停摆。
- **影响链（全部自然成立，无需改 UI 逻辑）**：
  - `sync/route.ts` 步骤 8：`dailyGrantResult = { ran: true, granted: false, skipped: "created_today" }` 原样回传；
  - `src/app/page.tsx` 现有分支（`granted` / `skipped==="empty_pool"` / 其他→`null`）→ 首日 `dailyWelcome=null`，馈赠卡缺席——**正是 desk hint 的 placeholder 落位**（A3，见 §5）；
  - T+1：`dailyGrantLastDate` 仍为 null → `hasGrantedToday=false` → 正常发放并写日期；馈赠卡 +「去送礼」按钮接手指引（§7.1.3 接力设计）。
- **风险**：验收 10 口径变化——「每日馈赠闭环」的起点从「创建当日」移到 T+1，runbook 需注明（§6 风险表已列）；已上线前创建的老 pet 不受影响（判据只看当日）。

### 3.2 P2-2：创建事务边界

- **现状（代码事实）**：`src/app/api/pet/create/route.ts` 串行非事务：`insertPet`（repo 走池，**无 conn 参数**）→ `insertMemory`（repo 有 conn 可选参）→ `generateBatchEvents`（纯函数）→ `insertMany(events)`（events.repo **有 conn 可选参**）→ `touchUserActivity` → `insertAuditLog`（audit.repo **无 conn 参数**）。中间任一步失败且 `insertPet` 已落库 → 重试 create 命中 409 → `first_meeting` 与初始事件**永久缺失且无补偿路径**。
- **基建核对**：`withTransaction`（`src/domain/persistence/db.ts`）能力齐备（commit/rollback/release + `*InTx` 仓库函数先例：`updateDailyGrantDateInTx` / `markOfferInTx` / `insertMany(events, conn)`）。**缺口只有两个 repo 函数**：`pets.repo.insert` 与 `audit.repo.insertAuditLog` 需要 `*InTx(conn, …)` 变体（照抄 `connExecute` 模式，改动极小）。
- **实现建议**：
  1. 新增领域函数（如 `src/domain/pet/create.ts` 或并入现有 pet 域模块）`createPet({ userId, name, hub })`：
     - 事务**外**：`newId()`、纯函数生成 `first_meeting`（ts=now）+ 1–2 条倒推初始事件（§1/§4 的参数）；
     - 事务**内**（`withTransaction`）：`insertPetInTx` → `insertMemory(naming)` → `insertMany(events)` → `insertAuditLogInTx(pet_created)`；`touchUserActivity` 并入或删（insertPet 已设 `user_last_active_ts` 默认值，属冗余调用，事务内二选一保留即可）；
     - 失败整体 rollback，路由回 500。
  2. 路由层维持架构铁律「解析 → 调领域 → 序列化」，不直接碰 repo。
  3. 幂等性：事务后重试 create 时 `findByUserId` 为空 → 可安全重建（ULID 不同，无主键冲突）。
- **风险**：事务内含 ~6 条 INSERT（pet + memory + 2–3 events + audit），远小于 R2 的 200ms 上界；「自愈兜底」（P2-2 不推荐项）不做，§7.2 已冻结。

---

## 4. 初始事件倒推 ts（创建前 6~48h）兼容性确认

| 既有机制 | 是否兼容 | 依据 / 说明 |
|----------|---------|-------------|
| 补算窗口 | ✅ 天然隔离 | `planner.ts` 窗口 = `[pet.lastActivityTs, now]`；`insertPet` 写 `last_activity_ts = 创建时刻`。倒推事件 ts **早于窗口起点**，永远不会被补算重排、聚合或二次生成 |
| 时间线分组 | ✅ 落「更早之前」侧 | `splitEventsByTs`（`src/lib/timeline-split.ts`）以 `offlineStartTs` 分界；倒推事件全部在旧侧，符合「初见=最新、小日子=更早」叙事。补 P3-2 QA 用例：创建后离线 8 天回归 → 倒推事件与每日聚合摘要同屏 |
| 导出 | ✅ 零改动 | `exporter.ts` 逐事件原样导出（`type` 字符串 + `ts` 数字），含 `first_meeting` 与倒推 ts，无顺序校验 |
| 导入 | ✅ 零改动 + 一条测试 | `importer.ts` 重建事件用 `ts: e.ts` 原样入库，**全链路不存在「事件 ts ≥ pet.created_at」断言**（必填校验只覆盖 `created_at` 本身类型）；`events.type` 是 `VARCHAR(64)`，未知值可存。需锁死一条回归测试：「导入路径永不重新生成 `first_meeting` / 初始事件」（P1-4 建议③） |
| 退避 / 回信 | ✅ 不消费事件 ts | `computeBackoff` 只看 `userLastActiveTs` |
| DDL | ✅ | 无 CHECK/ENUM 约束 |

**语义落点**：在 `CONTEXT.md` 补一句领域语义：「pet 的倒推初始事件 ts 可早于 pet.created_at，属『初见前它已在此』叙事的一部分，非数据异常」——防 QA 脚本 / 未来审计误判（P1-4 建议④）。

**风险**：唯一的长期风险是未来功能若引入「事件时间单调性校验」会误报——靠 CONTEXT 语义注记 + 回归测试双保险；本期不额外改代码。

---

## 5. 前端改动点

| 项 | 落点（文件路径） | 实现建议 | 风险 |
|----|----------------|---------|------|
| first_meeting 事件卡 | `src/ui/event-card.tsx` | `TYPE_LABELS` 加 `first_meeting: "初见"`；未知类型降级（P1-4 规则「保留 + 降级渲染」）：`TYPE_LABELS[type] ?? type` 保留为最底层兜底，但在其上加一层 default 包兜底文案映射，避免旧版实例看到裸英文串 | 无 |
| 图片接线分级（P2-6） | 首页 `src/app/page.tsx` header；`src/ui/event-card.tsx`；`src/ui/timeline.tsx` **不动** | ① 首页状态图：header 区按 `petState` 挂图，asset key 建议 `pet_at_home` / `pet_out_walking` / `pet_on_trip`（manifest `assets` 是 `z.record` 自由键，loader 图片循环已兼容；键缺失 → 不渲染图，现状即行为，零回归）；② 信纸类卡（`reply_letter` / `spontaneous_letter` / `first_meeting`）加小头像角标（asset key `pet_avatar`，可选渲染）；③ 普通时间线卡不挂图 | 若三包只补了 `first_meeting_note` 未补状态图 key，首页自动走「不挂图」降级——验收不受阻，但需在素材包任务里把 key 清单写全 |
| desk hint（②） | `src/app/page.tsx`（`dailyWelcome === null` 时渲染浅灰小字）+ `src/app/(pet)/gifts/page.tsx`（`unoffered` 与 `storage` 皆空时渲染） | 文案源 = pack 的 `guidance.desk_hint`（经 §2 物化后前端从 packs 文本接口取，`{pet_name}` 客户端替换）；**纯文字无链接**；渲染规则写死在 UI 侧的条件判断（placeholder 语义），文案本身零硬编码（红线：UI 不写文案，只消费 pack 文本） | P2-1 已澄清「卡片在场时小字隐藏是预期行为（含首日）」——实现时按条件互斥写，勿做成常驻 |
| 首会话收尾句（③） | 双落点：`src/app/page.tsx` 页脚 + `src/app/login/page.tsx` 页脚；建议新 client util `src/lib/farewell.ts` | 文案源 = `guidance.first_session_farewell`；localStorage 标记 `aetherpet_farewell_shown_<petId>`（P2-4 语义：每只 pet 各亮一次）；**关键时序**：退出登录清 token 之前，client 先写 `aetherpet_pet_last = { petId, petName }`（/login 页已登出，无 API 可取 pet），login 页读该标记 + 判断对应 farewell 未亮过 → 渲染 → 置标记；「先触发者置标记」天然去重 | 用户从未进过首页直接登出时 login 落点拿不到 petName → 收尾句漏一次，属 §7.2 已接受的边界；换浏览器重复一次同为此边界 |
| /gifts 空态 | `src/app/(pet)/gifts/page.tsx`（`GiftTray` 空容器分支） | 空物品栏 + 空储物罐时显示 `guidance.desk_hint` 一行浅灰小字 | 与 desk hint 首页落位共用同一 pack 文本，勿在 UI 里写死第二份文案 |

---

## 6. 回归风险清单（对照原 11 项验收 + 新增 A1–A5）

| 验收 | 受影响？ | 说明 |
|------|---------|------|
| **3 事件引擎** | ⚠️ 是 | `GENERATORS` 新增注册项 + `EngineOptions` 扩展；随机默认路径必须行为不变。回归：既有 engine 单测全绿 + §1 四个守卫断言（RANDOM_TYPES / 补算池 / dev 白名单不含 first_meeting） |
| **4 补算** | ⚠️ 轻 | 代码零改动（`CANDIDATE_TYPES` 独立副本）；倒推 ts 在窗口外。回归：补 1 条「含倒推事件的 pet 做 30 天补算，聚合摘要不含倒推事件、时间线旧侧正常展示」用例（P3-2） |
| **7 导出/导入** | ⚠️ 轻 | 链路零改动；回归：新增「导入含 first_meeting 的导出 JSON → 不重新生成、降级渲染不崩溃」用例 + CONTEXT 语义注记 |
| **8 素材包** | ⚠️ 是 | manifest-schema 扩展 + loader 物化 + 官方三包补键。回归：A5 三用例（旧包缺键 / 部分键 / 资产键缺失）+ 既有「损坏包回退 default」用例保持绿 |
| **10 馈赠闭环** | ⚠️ 是（口径变更） | P0-1 后首开日无馈赠卡，首馈赠在 T+1；`grantDailyItem` 新增 `created_today` 分支。回归：T+1 正常发放 + 日限一次 + 24h 回信全链路；runbook 更新验收 10 文案 |
| 1 注册/创建 | ⚠️ 轻 | create 改事务后失败可安全重试（无 409 死锁）；回归 create 正常路径 + 事务回滚路径各 1 条 |
| 2 / 5 / 6 / 9 / 11 | ✅ 否 | 档案/事件流/公告/部署性能/账号安全均不触碰本次改动面（TYPE_LABELS 扩展对 5 是纯增益） |
| A1–A5 | 新增 | 依赖以上全部：A1 靠 P0-1 + first_meeting 生成；A2 靠 typePool + 倒推 ts + FSM no-op；A3/A4 靠前端两落点 + guidance 文本；A5 靠 §2 物化 + 三包补键 |

**最高优先回归面**：验收 3/4/8 是引擎与契约的直接面，建议作为实现完成后的第一批自测；验收 10 口径变更需要**产品侧同步改写 runbook**（`docs/acceptance-runbook.md`）一句。

---

## 7. 结论：DB migration / 契约 major 变更

1. **DB migration：不需要。**
   - `events.type VARCHAR(64)` 无枚举/CHECK 约束，`first_meeting` 直接可写可读；
   - 无新增列（收尾句走 localStorage；馈赠跳过走既有 `pets.created_at`）；
   - `001_init.sql` 之外零 DDL 变更。
2. **契约：无 major 变更。**
   - pack_schema `1.0.0 → 1.1.0` 为 **minor**：仅新增可选键（`texts.first_meeting` / `texts.guidance` / `assets.first_meeting_note`），1.0.x 旧包继续合法加载（loader 版本正则 `^1\.` 已覆盖），第三方包零改动可用；
   - event `schema_version` 保持 `1.0.0`：第 12 类事件是枚举扩展，Event 结构体与 JSON 字段不变；
   - `docs/packs-contract.md` 同步至 1.1.0（§5 表 / §6 字段级回退优先级 / §8.4 清单 / §8.5 已知限制四处加补）。
3. **建议实现顺序**（依赖向）：
   ① 引擎（生成器 + typePool/tsPerEvent + 守卫单测）→ ② create 事务（P2-2，含 first_meeting 与倒推初始事件生成）→ ③ daily-grant P0-1 一行分支 → ④ loader 物化 + manifest-schema + 三包补键 → ⑤ 前端五处接线 → ⑥ 回归批（§6 表）+ `packs-contract.md` / `CONTEXT.md` 文档同步。
   ①–③ 可一个 PR；④–⑤ 可并行双人；⑥ 收口。

---

*本文档为 `docs/architecture.md` / `docs/architecture-summary.md` 的发布前增量附录；实现完成后请将 §7 建议实现顺序的结果回填至 `docs/current-stage.md`。*
