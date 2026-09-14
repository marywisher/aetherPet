# 项目自学习日志

- 项目名称：AetherPet（开源佛系陪伴应用）
- 创建日期：2026-09-09
- 完成日期：（项目结束时填写）

## 踩坑记录

### [2026-09-09] 签到/投喂机制的语义歧义

**阶段**：需求讨论

**问题描述**：
初始设计为「系统随机生成今日小物→桌面出现→用户点击送出」，用户纠正为「当天首次登录系统奖励用户一件物品→用户主动放桌上送给 pet」。两版都叫「投喂/签到」，但主体与流程链不同。若未澄清，数据模型会做成「事件驱动礼物」而非「用户拥有物品→主动馈赠」，后续货币/市场体系将无从挂接。

**根因分析**：
用含糊术语「签到/投喂」描述交互，未澄清「物品归谁所有、由谁发起赠送」。这是需求层典型的术语二义性：
- 谁拥有物品？（系统 vs 用户）
- 谁发起这次互动？（系统自动 vs 用户主动）

**修复方案**：
在 CONTEXT.md 术语表中显式定义「物品（item）＝用户拥有」「馈赠/便当（gift/bento）＝用户主动送出」，并用旅行青蛙的真实机制（老妈备便当）作锚点对齐理解。数据模型由此确定为：用户物品栏 + 用户发起动作。

**预防措施**：
在需求讨论中，任何描述「A 给予 B」的交互，必须追问三要素：①谁拥有对象物 ②谁发起动作 ③是否有每日/频次限制。三个答案都明确后再进数据模型。

**标签**：`沟通`

**状态**：`已闭环`

---

### [2026-09-09] 多中心预留被 repo 层硬编码悄悄破坏（P1-005）

**阶段**：阶段 1 开发

**问题描述**：
审计日志 repo 层硬编码 `hub_id='local'`，违反「多中心数据主权」预留：未来导入到其它服务中心后，审计数据会全部被标为本地中心，跨中心溯源失效。

**根因分析**：
架构层定义了 `hub_id` 字段，但实现层 repo 没有把 hub id 作为入参，而是图省事写死常量。这是「预留字段只落在 DDL、没落到代码约定」的典型——schema 有、代码没跟。

**修复方案**：
`AuditLogInput` 新增 `hubId`/`schemaVersion` 字段，缺省从 env（`HUB_ID`）读取；SQL 全参数化（5→8 占位符）；补 8 个单测覆盖 env 兜底/显式优先。

**预防措施**：
任何「多中心预留字段」，开发时在 repo 层签名中必须作为显式入参或 env 读取，禁止硬编码常量；质检硬门新增「grep 硬编码 hub_id」检查项。

**标签**：`技术`

**状态**：`已闭环`

---

### [2026-09-09] Next.js 16 构建期 Edge Runtime 告警（fs/path 依赖）

**阶段**：阶段 1 开发（阶段 3 补充）

**问题描述**：
`next build` 时 4 处 Route（healthz 等）报 `A Node.js module is loaded ('path'/'fs'/'crypto') which is not supported in the Edge Runtime` 警告。构建成功但属隐患。阶段 3 构建中同类信息出现 6 条（instrumentation 静态分析），仍 exit 0。

**根因分析**：
Next.js 16 Turbopack 构建时会自动推断 Route/Instrumentation Runtime；Node-only 模块（fs/path/crypto，含 logger 的 node:fs）触发 Edge 兼容性检查信息。健康检查/启动链必然依赖这些模块，所以信息必然存在。

**修复方案**：
（阶段 3 部分解决）`healthz/route.ts` 与 `instrumentation.ts` 均已加 `export const runtime = "nodejs"`，构建 exit 0、产物正常。剩余信息为 Turbopack 对 instrumentation 的编译期静态分析噪音，不影响产物。

**预防措施**：
新增 API route 时若依赖 Node 内置模块，第一时间声明 `runtime = "nodejs"`；部署前（阶段 6）用 `output: standalone` 验证，忽略编译期噪音以 exit code 与产物为准。

**标签**：`技术`

**状态**：`已闭环`（构建可用；噪音为已知无害）

---

### [2026-09-10] 开发链限流中断：连续多 agent 调用触发 429

**阶段**：阶段 3 开发

**问题描述**：
阶段 3 开发链首次运行在第 2 步（质检）和第 4 步（工程师修复）连续触发 `429 inference exceeds tpm/rpm limit`，链中断。

**根因分析**：
链内每一步都是大上下文模型调用（领域代码 + 多文档 reads），连续执行在短时间内超出 API 的 tokens-per-minute 限制；特别是首步工程师开发消耗大量上下文后，立刻接质检调用更容易触顶。

**修复方案**：
改为「单步串行 + 间隔执行」：每次只调用一个 agent，完成后再调用下一个；质检确认 P0/P1=0 后，P2 小问题由主 agent 直接手修（本轮 3 处 P2 手修 + 验证），不再等待完整链。

**预防措施**：
- 阶段链启动前评估任务体量，大阶段拆分或减短 chain（质检→修复→终检三段即可）
- 链中断时优先检查步骤产物是否已落盘（开发可能已完成），再决定续跑还是单步
- P2 级别问题可由主 agent 手修并跑全量测试验证，不必每次都启动修复链

**标签**：`流程`

**状态**：`已闭环`

---

### [2026-09-10] 跨阶段集成缺口：上游字段「只计算不持久化」，下游拿它做判断 → 死代码（P1-001）

**阶段**：阶段 4 开发（根源在阶段 3）

**问题描述**：
阶段 3 `/api/sync` 计算了 `backoff.nextProactiveTs` 但**只返回给客户端、从未写回 `pets.next_proactive_ts`**；阶段 4 的 `isReplyDue` 读该字段做退避判断（`nextProactiveTs > now → backoff_active`）——DB 中该列恒为 NULL，导致退避分支是生产环境死代码，单测却因 mock 数据而全绿。

**根因分析**：
跨阶段字段的「写入方 / 读取方 / 写入时机」没有明确契约。阶段 3 的验收只说退避「可观测」（返回即可），阶段 4 却假设它已持久化。两个阶段各自验收都过，集成处断掉。

**修复方案**：
`/api/sync` 在 catchup 后、replyCheck 前写回 `next_proactive_ts`（try/catch 不阻断主流程）；补 `pets-backoff.test.ts` + `reply.test.ts` 端到端用例（离开 3 天 → now+7d → backoff_active 生效）。

**预防措施**：
- 跨阶段的**状态字段**（各表可持久化状态）必须明确「谁写」：验收项写「可观测」不够，必须写「持久化到何处」
- 阶段开发前抽查上游产出：下游依赖的上游字段，实际读一次 DB 验证值非空
- 单测 mock 的字段必须紧跟着在集成/端到端用例里验证一次真实写入路径

**标签**：`技术` / `流程`

**状态**：`已闭环`

---

### [2026-09-10] 「每日限一次」靠事务外内存判断 → 并发下可双写（P1-003）

**阶段**：阶段 4 开发

**问题描述**：
`grantDailyItem` / `offerInventoryItem` 均在事务外基于已读 pet 对象判断 `hasGrantedToday` / `hasOfferedToday`，事务内无条件 UPDATE；并发（多标签页、重试、sync 与手动 API 撞车）时两个请求都通过判断，产生双份物品/事件。

**根因分析**：
用「先读后写」实现幂等——应用层判断天然有竞态窗口，而 DB 层无唯一约束/条件 WHERE 保护。

**修复方案**：
三个 repo 函数改为条件 UPDATE（`WHERE ... IS NULL OR ... < today` / `WHERE offered_at IS NULL`）并返回 `affectedRows`；领域层 `affectedRows === 0` → 抛 `IdempotencyError` → 事务 rollback → 返回 already_*。offer 用双门（pets 门 + inventory 门）。

**预防措施**：
- **所有「限一次 / 去重 / 状态机转换」语义必须由 DB 条件写入保证**（affectedRows 判定 + rollback），不得依赖应用层读判断
- 幂等类需求验收时至少设计一个并发（双请求）用例

**标签**：`技术`

**状态**：`已闭环`

---

### [2026-09-10] ⚠️ 重复踩坑：API 层零集成测试 → P0 级缺陷逃逸（P0-001）

**阶段**：阶段 5 开发

**问题描述**：
`POST /api/announcements` 路由已实现，但**缺失 `GET` handler**（文件只导出了 POST + runtime）。UI 拉取列表必然 405，验收 #6「发布→可见」断链。开发报告声称「GET /api/announcements 已完成」。481 个单测全绿，却没有任何 API 层测试覆盖 GET 路径，P0 缺陷完全逃逸。

**根因分析**：
这是阶段 4 已记录教训「mock 需集成验证」的**重复踩坑**：单测只覆盖 domain/repo（mock sql/db），API 层与 UI 层零自动化测试。dev-report 与代码不一致（声称完成但实际缺失）也是诱因——把「宣称」当「事实」交付。

**修复方案**：
补回 GET handler（requireAuth + limit/since 参数 + buildList 聚合）；修好 P1-001（admin 回退鉴权恒 403）与 P1-002（页面不可达）；补 validateIds / marked 计数 / audit。

**预防措施**：
- **阶段 6 必须补齐 API 层集成测试**（至少覆盖各新路由的 GET/POST 主轴 + 401/404 分支）——用内存 DB 或临时 MySQL 容器
- 质检增加「交付抽查」：grep 关键导出符号（`export async function GET`）核验 dev-report 声明，不采信报告文字
- 新路由开发后、提交前，必须手动 curl 一次真实 HTTP 路径

**标签**：`流程` / `技术`

**状态**：`已闭环`（修复）+ 预防措施待阶段 6 落地

---

### [2026-09-10] 误导性运维陷阱：保留「看起来能用其实永远失败」的路径（P1-001）

**阶段**：阶段 5 开发

**问题描述**：
admin 路由设计了「登录用户 email 匹配 HUB_ADMIN_EMAIL」回退鉴权，但 magic-link 注册恒写 `email_plain_enc=null`，全项目无任何路径写入非 null——回退路径永远 403。.env.example 还引导运维「留空→回退」，形成误导性陷阱：运维按文档配置后必然失败。

**根因分析**：
设计师「想当然」地认为 email 匹配路径可用，没有对照注册路径实际写入的字段值；文档注释与实现行为不同步。

**修复方案**：
移除回退路径：未配 HUB_ADMIN_TOKEN → 501 + 明确错误信息；配置但不匹配 → 401。.env.example 注释同步改写。

**预防措施**：
- **不存在的路径不该存在**：备用路径要么实现可用，要么直接删除，不能用「永远失败的显式回退」
- .env.example 注释是用户运维的契约，每次改鉴权逻辑必须同步更新，且文案不得承诺未实现的能力

**标签**：`流程` / `沟通`

**状态**：`已闭环`

---

### [2026-09-09] 本机 Docker 未启动 → MySQL 集成实测无法执行

**阶段**：阶段 1 开发

**问题描述**：
质检轮次中 Docker Desktop 未运行（`docker ps` 管道错误），MySQL 集成实测（db:up → dev server → /api/healthz）无法执行，只能以代码审查 + 单测 + DDL 静态比对替代。

**根因分析**：
开发链在无 Docker 环境的本机运行时，凡依赖容器的集成验证都会失效；质检员未在开始前确认环境可用性。

**修复方案**：
本次以静态核验降级通过；修复动作排期：Docker 可用时跑演示脚本，或纳入阶段 6 CI（拉临时 MySQL 容器跑 E2E）。

**预防措施**：
每个阶段开发链启动前，主 agent 先检查 Docker 可用性；若不可用，提前告知质检员「集成验证降级为静态」并在阶段计划中排期补测。

**标签**：`环境`

**状态**：`待验证`

---

### [2026-09-10] 阶段 2 质检：死代码与契约/实现不一致（P2-007/012、P3-001）

**阶段**：阶段 2 开发

**问题描述**：
Round 1 质检发现：① `anchoring.ts` 有 3 个不可达分支（daysAgo<=9/<=14/else）与 _now 死变量；② 契约文档 `aggregate_summary` 的 recall_min_count=0 与代码 nameForceProb=1 矛盾；③ 3 个生成器有 `void X;` 死代码；④ engineering 交付物 current-stage.md 文案数与实际不符。

**根因分析**：
①③ 是「重构后未清理」的经典技术债——时间锚点算法改成 1..6 四种表达后旧分支残留；
② 是「契约文档与实现逐字逐句对齐检查」缺失——实现改了、文档没同步；
④ 是人工统计口径漂移（121 条 vs 实际 113 条）。

**修复方案**：
删除不可达分支/死变量/未用 import；契约 §5 改为 recall_min_count=1 并加「Round 2 已对齐」注释；建立 `contract-vs-schema.test.ts`（10 用例）作为契约↔代码回归防护，从此契约文档与 TS 类型互相校验。

**预防措施**：
- 任何重构同时清理死代码（用 eslint no-unused / `void X` grep 前置检查）
- 契约类文档修改后，必须跑「契约 vs 实现」一致性测试
- 文案/统计数字必须在质检出报告前复核，不直接采信人工估计

**标签**：`技术`

**状态**：`已闭环`

---

## 跨项目可复用清单

> 收官整理（2026-09-10）：从踩坑记录中筛选出对**其他项目**也有通用价值的条目。

### 流程类

1. **每阶段必须有 API 层集成测试，否则 P0 会逃逸**（阶段 4 → 阶段 5 重复踩坑 → 阶段 6 才闭环）。
   单测 mock repo 永远发现不了「路由 handler 缺失/参数接错」这类整链路缺陷。
   落地：新路由合并前提交清单必含 GET/POST 主轴 + 401/404 用例；CI 用服务的临时数据库跑集成测试。
2. **质检不采信报告文字，只采信代码**。开发报告声称「完成」≠ 存在：质检必须 grep 关键导出符号
   （`export async function GET`）+ 实跑构建/测试，逐条要证据、要文件行号。
3. **交付物验收清单化**：把「备用路径要么实现可用，要么删除」作为硬规则——
   保留一条永远失败的显式回退路径，比不存在更坏（误导运维）。

### 技术类

4. **「限一次/去重/状态机转换」语义必须由 DB 条件写入保证**（affectedRows 判定 + 事务回滚），
   不得依赖应用层先读后写（并发双写陷阱）。
5. **运行时按相对路径读文件（migrations/模板/素材）的项目，CI 改用 standalone/trace 部署时必须显式
   `outputFileTracingIncludes`**，否则生产环境启动即缺文件（本坑："*" 通配包含 migrations/*.sql 与素材包目录）。
6. **测试 mock 语义**：Vitest `clearAllMocks` 不清 `mockResolvedValueOnce` 队列，跨用例残留实现会导致
   「单测隔离通过、套件全跑失败」的伪失败；需要 `resetAllMocks`。
7. **文档里的「契约/决策」要与代码同步校验**：建一张「契约 vs 实现」回归测试（本项目 contract-vs-schema.test.ts），
   文档宣称的字段/值（如 recall_min_count）与代码不符时自动红。
8. **事务包装器留测试缝**（本项目 withTransaction 可选 pool 参数）：失败回滚/提交/释放语义可端到端单测，
   不必真实连库。

### 沟通/领域类

9. **需求术语必须结构化**：表格类配置用 `minX/maxX/intervalMs`，禁止口语化（"每天来"→ 歧义踩坑）；`null` 语义显式定义。
10. **MVP 也要预演「数据迁移」**：数据主权/导出导入独立成阶段，schema 版本与 checksum 从第一天预留，
    比事后补便宜得多。

---

### [2026-09-10] 阶段 3：aggregate_summary "聚合参数"合成 vs 真实统计

**阶段**：阶段 3 开发

**问题描述**：
补算聚合摘要（`aggregate_summary`）要求 params 含 `outings` / `items_collected` / `travel_nights`（架构 §5.3）。但聚合事件替换的是省略事件——这些事件不存在于 DB，没有真实数据可统计。若强行"统计"会产生空值，导致 pack 模板渲染失败或展示"出门 0 次"的荒谬摘要。

**根因分析**：
架构文档定义了 params schema 但未说明"数据从哪来"。阶段 2 的 aggregate 生成器（`aggregate-summary.ts`）接受 params 作为输入，但补算场景下 executor 需要自己生成 params。这是"契约定义数据形状、但没定义数据来源"的典型模糊地带。

**修复方案**：
`aggregator.ts` 新增 `synthesizeAggregateParams(spanDays, rng)`：
- 用 seeded RNG 每天 50% 概率合成 outing 次数（最少 1 次，最多 spanDays）
- 用 seeded RNG 每天 35% 概率合成 items_collected（type 从固定池随机、count 1-3）
- travel_nights 恒 0（MVP 无旅行玩法，与架构 §12 一致）
- 确定性：同 spanDays + 同 seed → 相同 params（可复现，便于测试与调试）

**预防措施**：
- 契约文档定义 params schema 时，必须同步说明"数据来源"（真实统计 vs 合成 vs 外部输入）
- 聚合类事件（替换省略事件）的 params 合成策略需在架构文档 §5 显式标注，避免实现时反复摸索

**标签**：`技术`

**状态**：`已闭环`

---

### [2026-09-10] 阶段 3："每天来"退避间隔的语义歧义

**阶段**：阶段 3 开发

**问题描述**：
CONTEXT.md 退避表首行"每天来"无具体间隔值。若解读为"1 天"，则近 24h 内访问的用户下次主动触达设为 1 天后——但用户每天来，间隔应为 0（保持当前频率）。若解读为"不限"，则前端无法计算 nextProactiveTs。

**根因分析**：
"每天来"是口语化描述，未用结构化表达。退避表本质是"缺席时长 → 下次间隔"的映射，但"每天来"行的缺席时长是 0，间隔未明确。

**修复方案**：
`BackoffBand` 接口新增 `minAbsenceHours`（而非 `minAbsenceDays`），避免 0 天与 1 天的歧义。"每天来"行 `intervalMs = null`，语义为"保持当前频率"（不设具体间隔，nextProactiveTs = null）。前端收到 null 时展示"随时可见"而非具体日期。

**预防措施**：
- 表格类配置用结构化字段（`minX` / `maxX` / `intervalMs`），禁止口语化描述
- `null` 语义在接口文档中显式定义（"null = 不适用/保持当前"而非"缺失"）

**标签**：`技术`

**状态**：`已闭环`

---

### [2026-09-10] 阶段 3：补算事件 ts 分布与聚合 ts 顺序的非对称性

**阶段**：阶段 3 开发

**问题描述**：
补算 planner 将离线窗口分为"近期 7 天"（生成常规事件）与"旧期"（生成聚合摘要）。常规事件 ts 在 `[recentStart, toTs]` 均匀分布，聚合事件 ts = `recentStart`（旧期末尾）。这意味着聚合事件 ts 早于最后一条常规事件——按 ts 升序插入时，聚合事件不在末尾。

**根因分析**：
架构文档 §3.4"聚合按时间序插入到时间线末尾"中的"末尾"有歧义：
- 解读 A：时间线视觉末尾（最旧事件，列表底部）→ 聚合 ts 应早于常规事件 ✓
- 解读 B：补算窗口末尾（最新事件，列表顶部）→ 聚合 ts 应等于 toTs

渐进披露入口卡片要求聚合摘要在首屏顶部，但时间线按 ts 降序排列时，聚合事件（ts = toTs - 7d）会出现在常规事件（ts ≈ toTs）之后。

**修复方案**：
- 聚合 ts = `slot.toTs` = `recentStart`（旧期末尾），chronologically 正确
- executor 按 plan 顺序插入（normal 先、aggregate 后），不强制 ts 升序
- 时间线页通过 `findLatestAggregate` 单独查询聚合事件（不依赖 ts 排序），在入口卡片中展示
- 事件流列表中，聚合事件出现在其 chronologically 正确的位置（常规事件之后）

**预防措施**：
- "时间线末尾/顶部"等空间隐喻在架构文档中必须用"ts 升/降序"或"列表位置"明确化
- 渐进披露入口卡片与事件流列表解耦：入口卡片通过独立查询获取最新聚合事件，不依赖列表排序

**标签**：`技术`

**状态**：`已闭环`
---

### [2026-09-10] 阶段 6：「重复踩坑」闭环——API 集成测试终于落地（含临时 MySQL）

**阶段**：阶段 6 开发

**问题描述**：
阶段 5 曾记录「重复踩坑：API 层零集成测试 → P0 逃逸（GET /api/announcements 缺失）」。阶段 6 起，新增路由一律配套 API 级集成测试，
且 CI 用 GitHub Actions MySQL service 跑临时容器；本地无 Docker/MySQL 时测试自动 skip（`INTEGRATION_DB=1` 才启用），不污染单测基线。

**根因分析**：
前几阶段「单测只 mock repo/sql、API 层零自动化」的结构性缺口，靠「手动 curl」与「质检 grep 导出符号」兜底，仍会漏（P0-001 漏了 GET handler）。

**修复方案**：
1. `tests/integration/export-import.api.test.ts`——直接调用 route 函数（`GET(req)`/`POST(req)`）+ 真实 MySQL：
   覆盖 401、三态校验错误（版本/校验和/字段缺失）、导出→清空→导入往返逐字段比对、素材包激活 404/200 落库。
2. `withTransaction` 增加可选 `pool` 参数作为测试缝——新增 `tests/unit/persistence/with-transaction.test.ts`（P3-007 闭环）：
   成功 commit / 失败 rollback / rollback 自身失败不吞原错误，全部端到端验证。
3. 构建期验证：`next build` 有 `output: "standalone"` 后，migrations/*.sql 与素材包必须显式 `outputFileTracingIncludes`，
   否则运行时按相对路径读取直接失败（见下一条）。

**预防措施**：
- 新路由合并前，提交清单必须含「该路由的 API 级测试」（至少 GET/POST 主轴 + 401/404）
- Route Handler 可直接用 `new Request(url, { headers: { cookie }, body })` 驱动测试，无需起 server
- CI 用服务的临时 MySQL 跑集成测试；本地降级为 skip 时在报告中显式标注「未实跑」

**标签**：`流程` / `技术`

**状态**：`已闭环`

---

### [2026-09-10] 阶段 6：standalone 部署的「运行时相对路径文件」陷阱（migrations / 素材包）

**阶段**：阶段 6 开发

**问题描述**：
`next.config.ts` 设 `output: "standalone"` 后，`.next/standalone` 只拷贝 trace 到的文件。
migration runner 按 `process.cwd() + "src/domain/persistence/migrations"` 运行时读 `.sql`，素材包 loader 按
`import.meta.url` 锚定的 `PROJECT_ROOT + "src/assets/packs"` 读文件——两者都不在默认 trace 里，生产容器/PM2 里会
「启动失败（migration 找不到）」或「加载全部素材包失败」。

**根因分析**：
「代码里运行时用 fs 读的文件」不属于构建期静态 import，Next standalone 不会自动包含；且 loader 刻意用
`import.meta.url` 锚点规避 whole-project trace（P2-008），这个锚点在 standalone 下解析到 `.next/standalone`——
如果只把素材包拷到别处而不动 ASSET_PACKS_DIR 就全错。

**修复方案**：
`next.config.ts` 加：
```ts
outputFileTracingIncludes: {
  "*": ["src/domain/persistence/migrations/**/*.sql", "src/assets/packs/**/*"],
}
```
实测 `.next/standalone/src/domain/persistence/migrations/` 与 `src/assets/packs/{default,morning}/` 均进入产物。
Dockerfile 只拷贝 standalone + static + public 即可，无需手工补拷。

**预防措施**：
- 任何「运行时 fs 相对路径读取」的目录，加 `outputFileTracingIncludes`，并在构建后 `ls .next/standalone/...` 验证
- 修改部署形态后必须实测 standalone 产物内容（QA 已把此项列入验收 #9 检查）

**标签**：`部署` / `技术`

**状态**：`已闭环`

---

### [2026-09-10] 阶段 6：vitest `clearAllMocks` 不清 once 队列 → 跨用例串扰的假失败

**阶段**：阶段 6 开发

**问题描述**：
导出器测试起初 `beforeEach(vi.clearAllMocks())`，多个用例共用同一 `mockResolvedValueOnce` 队列——前一个用例排队的
返回值串到后一个用例，导致「单独跑通过、整文件跑失败」的伪失败，排查一度以为是实现 bug。

**根因分析**：
`vi.clearAllMocks()` 只清 calls/results，**不清 `mockResolvedValueOnce` 实现队列**；需要 `vi.resetAllMocks()`（或
`mockReset()`）才会连 once 实现一起重置。这是 Vitest mock 语义的常见坑。

**修复方案**：
测试 `beforeEach` 统一用 `vi.resetAllMocks()`；涉及 mock 实现的用例显式重新赋值。

**预防措施**：
- 凡用 `mockResolvedValueOnce` 的套件，beforeEach 必须 `resetAllMocks` 而非 `clearAllMocks`
- 出现「单测隔离通过、套件全跑失败」时先怀疑 mock 状态残留

**标签**：`技术`

**状态**：`已闭环`

### [2026-09-10] 收官：git 历史采坑——「解耦」决策被业务验收事后反转（P2-001）

**阶段**：最终确认（git 历史审查）

**问题描述**：
阶段 2 的 `src/domain/announce/hub.ts` 头注释白纸黑字写着「公告是用户级触达通道，与 pet 事件流**解耦**，本文件不修改 event 表」。
阶段 5 质检据此把「公告在时间线不可见」定为 P2-001 延后；阶段 6 为兑现验收 #6 广义解读（同步可见），又在
`admin/route.ts` 里为所有 pet 插入 system_announce 事件——**解耦决策被业务验收事后反转**，注释语义需同步更新。

**根因分析**：
「解耦」写进了代码注释却没写进需求文档，验收 #6 用的是模糊词「同步可见」，导致两轮实现（先解耦、后耦合）都各自自洽；
更隐蔽的是——代码注释里承诺的设计约束，团队拿它当架构事实，业务推进时却没人提示要改注释。跨阶段决策漂移的典型。

**修复方案**：
阶段 6 反转接入时三个地方同步改：生成器 params 只存 announcement_id（渲染层反查，保持「事件结构不含文案」），
admin 发布走单事务（公告 + 全 pet 事件一起落，失败整体回滚），hub.ts 注释补一句「阶段 6 起发布时联动写入 events，
本文件仍不直接写 event 表」。

**预防措施**：
- 架构决策若写在代码注释里，必须同时登记到 `docs/architecture.md` / ADR 层，需求验收争议时以文档为准回溯
- 「解耦/独立」这类设计承诺放进需求验收原话（如 #6 明确「时间线可见」），不要用灰色表述
- 每次业务验收收窄/放宽时，git 审查 diff 里 grep 被反转的决策注释，同步修注释

**标签**：`流程` / `沟通`

**状态**：`已闭环`

---

### [2026-09-10] 收官：git 历史形态观察——「一次性大提交 + 阶段里程碑」对小项目是正分

**阶段**：最终确认（git 历史审查）

**问题描述**：
项目 8 个提交、每个阶段一次大提交（stage-1 达 103 文件 / 14k 行）。按「高频率小提交」标准看略激进，但回看每个阶段
质检/回滚需求，单阶段边界清晰，回退（`git revert` 到某阶段）非常干净；pitfalls 里阶段 4→5 的「重复踩坑」能从提交
粒度定位到是哪一次引入。

**根因分析**：
小团队 + 阶段验收制下，提交粒度和「验收单元」对齐比「代码单元」对齐更有操作性；代价是单提交审阅负担大，
需要质检独立出面。

**修复方案**：
维持现有策略，不做整改。补充两点：① 阶段提交信息统一 `feat(stage-N)`，检索与回滚友好；② 大提交前必须跑 tsc +
全量单测 + build（本项目每阶段提交信息后都有绿色构建记录）。

**预防措施**：
- 提交粒度跟「验收单元」走（阶段/迭代），但每提交必须自证绿（typecheck/test/build 全过）
- 大提交的 diff 审查交给独立质检（本项目质检报告逐文件给证据），主开发不自己审自己

**标签**：`流程`

**状态**：`已闭环`

---

### [2026-09-10] 收官后补：基线 lint 债清零——测试目录 any 用「豁免」而非「清除」

**阶段**：最终确认（收官后清理）

**问题描述**：
收官时 src/ 有 19 errors + 24 warnings（阶段 1-5 遗留），测试目录还有 55 个 no-explicit-any + prefer-const 等。
清理后发现两类性质完全不同：生产代码的债必须真修（未用 import、setState-in-effect、泛型默认 any），
测试代码的债（vi.fn mock 的 (...args: any[]) 转发、断言边缘 as any）是「测试惯用法」，硬塞类型系统只会生产噪音转型。

**根因分析**：
「lint 清零」不能一刀切：测试 mock 转发签名本就该宽松，用 unknown 会破坏生成器等异构注册表的类型兼容
（参数逆变拒绝所有子类型）——强改会造成比债更丑的 as 断言链。

**修复方案**：
- 生产 src/：**真修**——删 20+ 未用 import/变量、6 处 setState-in-effect 改微任务延迟、page.tsx 未转义引号；
  泛型默认 `any→unknown`（Row/query/findOne 等）、GeneratorRegistry 保留 any 但加 eslint-disable 注释豁免
  （异构注册表是类型系统边界，注释说明原因）
- 测试 tests/：eslint.config.mjs 对 tests/** 关 no-explicit-any（注释理由：mock 边缘类型豁免，无生产风险）
- coverage/ 加入 eslint globalIgnores（产物目录）
- 结果：`npm run lint` 从 120 problems → **0 problems**；tsc/tests/build 全绿

**预防措施**：
- lint 债分两类处理：生产代码真修，测试代码用「带注释的规则豁免」——豁免要写明原因，避免变成无脑关规则
- 0 problems 后 CI 可恢复 `npm run lint` 全量（不再是 eslint src 限定）

**标签**：`流程` / `技术`

**状态**：`已闭环`

### [2026-09-13] QA 收官：补算/馈赠链路"验收绿、产品断线"（integration gap）
**问题**：验收手册靠手动 curl `/api/sync` 通过补算/馈赠/回信验收,但前端**从未调用**该端点 → 真实用户登录永远看不到补算。"验收绿"≠"产品可用"。
**修复**：`src/lib/sync-client.ts` 封装 `runSyncOnce()`(in-flight 去重+失败静默),首页与时间线页首载调用;服务端幂等(offlineMs≤0 不生成)。
**预防**：审计/验收必须以"真实用户路径(页面→API→领域→DB)"核对,不能只跑接口冒烟。
**标签**：`流程` / `技术`
**状态**：`已闭环`

### [2026-09-13] 导入恢复历史 user_last_active_ts → 虚假缺席 → 退避压制回信
**问题**：导入=恢复快照,恢复出旧的 `user_last_active_ts`;导入后首次登录被判"缺席 N 天"触发退避,`next_proactive_ts` 写入后**只写不清**,
陈旧值让 `isReplyDue` 一直 `backoff_active`,回信被推迟到过期。
**修复**：sync 改为**始终写回** `next_proactive_ts`(用户活跃时 SET NULL 清除);已用两次刷新验证(72h→+7d→清零)。
**预防**：凡"只在非空时写库"的优化,先问"陈旧值何时被清"。
**标签**：`技术`
**状态**：`已闭环`

### [2026-09-13] 客户端 import 插入 "use client" 之前会静默失效
**问题**：脚本把 `import` 插到文件第 1 行,把 `"use client"` 挤成第 2 行 → React 忽略指令,useState 运行时报错但 `tsc` 不报。
**预防**：客户端文件加 import 必须放在 `"use client";` 之后;批量脚本插入要有 directive 感知。
**标签**：`技术`
**状态**：`已闭环`

### [2026-09-13] 品牌名硬编码治理：改名只改 .env
**要点**：AetherPet/aetherpet 曾散落 30+ 处(cookie 名/邮件头/UI fallback/错误文案)。现抽离 `APP_NAME`/`APP_BRAND_KEY`(+NEXT_PUBLIC_*),
`src/config/brand.ts`(领域)/`src/lib/brand.ts`(认证)/`src/config/client-brand.ts`(客户端)。
**预防**：应用名一律走配置；注意 server-only env 不能被客户端 import，品牌走 NEXT_PUBLIC_ 白名单。
**标签**：`技术`
**状态**：`已闭环`

### [2026-09-14] 品牌抽离“抽一半”：4 处漏网（<title>/meta/登录 H1/备份文件名）
**问题**：09-13 宣称“AetherPet 散落 30+ 处已全部抽离”，但实际仍有 4 处硬编码，改名后不会变：
- `src/app/layout.tsx` 的 `metadata.title` / `description` —— **每个页面的 `<title>` 都靠它**，最显眼；
- `src/app/login/page.tsx` 的 H1（登录页主标识）；
- `src/app/import/page.tsx` 的「字段缺失」错误提示文案；
- `src/app/export/page.tsx` 的备份下载文件名前缀 `aetherpet-backup-`。

**发现方式**：改名回归测试——把 `.env` 改为 `NEXT_PUBLIC_APP_NAME=星野Pet` / `APP_BRAND_KEY=xingye` 重启 dev，
`curl /login` 抓 HTML grep 品牌字面量，发现 title/H1 仍渲染 AetherPet。静态 grep（`grep -rn "AetherPet" src/`）也能定位，
但**“改了配置没生效”只有运行时验证能暴露**——grep 只能证明“代码里还有字面量”，不能证明“那处已经接上配置”。

**修复**：layout 走服务端 `appName()`（`@/config/brand`）；login/import 走 `APP_NAME_DEFAULT`；export 走 `APP_BRAND_KEY_CLIENT`；
新增 `tests/unit/lib/brand.test.ts`（8 例）覆盖默认兜底、改名联动（显示名/邮件头/cookie 名）、`readTokenCookie` 命中新名+忽略旧名、
`NEXT_PUBLIC_*` 通道；全量 539 passed。

**预防**：
- “抽离硬编码”类任务必须做**改名回归**（改配置 → 重启 → 运行时抓渲染产物），不能只 grep 就宣布闭环；
- 抽离完立刻补断言（本例：`tokenCookieName() === "${brandKey()}_token"`），否则下次重构又会漂回去。
- 客户端页记得 import 必须放在 `"use client"` 之后（见 09-13 同主题坑）。

**标签**：`技术` / `流程`
**状态**：`已闭环`
