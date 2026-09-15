# 会话摘要

## 已完成阶段

### 需求讨论（stage-req）
**完成时间**：2026-09-09
**阶段产出**：
- `docs/requirements.md`（v1.1）— MVP 需求 + 11 项验收（含评审修订）
- `CONTEXT.md` — 领域术语表（隐居模式、补算、退避间隔、数据主权、中心自治邮件等）
- `docs/asset-prompts.md` — 即梦素材产出示意词（用户可并行产出素材）
- `docs/pitfalls.md`（初始化 + 需求阶段 1 条记录）

**关键决策**：
1. Web 应用 + TypeScript + Next.js + MySQL（不用 flutter/不用 SQLite）
2. 账号 = 邮箱验证码（无密码），30 天 token，一个账号多 pet（MVP 先 1）
3. 佛系纪律：不追 KPI；「隐居」模式替代「单机」术语；退避间隔（1→3→7→30 天）
4. 数据主权：JSON 导出/导入 + schema 版本化 + 未来多中心迁移
5. 每日馈赠 = 首次登录系统奖励物品 → 用户主动放桌上送 pet → 24h 内回信（含 ≥1 记忆引用）
6. 素材包（theme/voice pack）可配置：事件-素材契约解耦，不写代码可换风格
7. 中心自治邮件：验证码由注册中心自己的 SMTP 发，邮件带中心身份标识

**遗留问题**：无

### 产品评审 + 架构设计（stage-review-arch）
**完成时间**：2026-09-09
**阶段产出**：
- `docs/product-review.md` — 评审报告（4 P0 + 10 P1 + P2 全部处理）
- `docs/architecture.md`（v1.1）— 架构设计
- `docs/database-schema.md`（v1.1）— MySQL DDL
- `docs/dev-stage-plan.md`（v1.1）— 6 阶段计划
- `docs/architecture-summary.md` — 总览

**关键决策**：
1. MySQL 8.x + mysql2 异步连接池（用户宝塔环境）；补算 async 事务
2. 领域层纯 TS 零框架依赖；ULID 主键；每表 hub_id + schema_version
3. 补算 ≤20 条 + 聚合摘要 + 渐进披露；契约冻结（阶段 2 末）
4. 部署：Next.js standalone + PM2 + 宝塔 Apache 反代
5. 记忆引用量化：≥30% 命名引用、回信 ≥1 条引用

**遗留问题**：Docker MySQL 集成实测待补（本机 Docker 未启动）

### 阶段 1 开发（stage-1）
**完成时间**：2026-09-09（提交 `d94a6b1 feat(stage-1)`）
**阶段产出**：
- 项目骨架：Next.js 16 + TS + MySQL 8（docker compose）+ Vitest（144 单测）
- 认证模块：验证码签发/校验/节流/30 天 token/退出/审计
- 中心身份邮件模板；素材包加载器（manifest 校验 + 损坏回退 + 路径防护）
- API：/auth/*、/packs、/pet、/healthz；页面：/login、/create-pet
- `src/lib/logger.ts` 按日日志；README 中英双版；.gitignore

**关键决策**：
1. 日志以日为单位生成 logs/YYYY-MM-DD.log（LOG_DIR/LOG_LEVEL/LOG_CONSOLE 可配）
2. 全部内容一次提交（用户要求）

**遗留问题**：
- P2-013：Edge Runtime 警告，阶段 6 部署前修（加 runtime="nodejs"）
- P3：env 邮箱正则延后；Docker 集成实测待补

---

### 阶段 2：pet 状态机 + 事件引擎 + 契约定稿（stage-2）
**完成时间**：2026-09-10（提交 `776a6cc feat(stage-2)`）
**阶段产出**：
- `src/domain/fsm/`、`src/domain/events/`（11 生成器+engine+render）、`src/domain/memory/`（加权抽样+时间锚点）
- `docs/packs-contract.md` v1.0.1 冻结（事件-素材契约）
- `docs/current-stage.md` 更新为阶段 3；`docs/pitfalls.md` 新增阶段 2 条目
- 新 API：/api/pet/generate-event（dev 白名单）、/api/pet/timeline；事件卡片 UI
- 259 单测全过；CONTRIBUTING.md 贡献指南（GFI/HW 任务清单）；README 双版更新

**关键决策**：
1. 契约冻结 v1.0.1 + contract-vs-schema 回归防护测试（契约与 TS 类型互相校验）
2. 记忆引用名字率实现 ≥50%（超出需求 30%）；poetic 抽样 10%
3. 用户手动删除需求溯源对话 JSON；提交含用户暂存内容

**遗留问题**：
- P2-006：MemoryRef.kind 语义扩展（不做，待阶段 5 档案页时随契约 bump）
- Edge Runtime 警告（阶段 6 修）；Docker 集成实测未执行（待阶段 6 CI）

---

### 阶段 3：补算 + 退避 + 事件流 UI（stage-3）
**完成时间**：2026-09-10（待提交）
**阶段产出**：
- `src/domain/catchup/`（planner ≤20 条+聚合+executor async 事务+aggregator）、`src/domain/backoff/`（1→3→7→30 天表）、`src/config/backoff-table.ts`
- `GET /api/sync`、`src/app/(pet)/timeline/`（渐进披露+类型标签+记忆高亮+状态徽章+分页）
- 355 单测全过（+96）；typecheck 0 错误；build exit 0（17 路由）

**关键决策**：
1. 质检轮 P0/P1=0；3 处 P2 由主 agent 手修（注释修正、入口卡片 eventCount 精确化、repo 死代码清理）
2. Edge Runtime 噪音：healthz/instrumentation 加 runtime="nodejs" 声明，build exit 0 确认可用
3. 链 429 限流 → 改单步串行 + P2 手修策略（已记 pitfalls）

**遗留问题**：
- P3×6 轻量项（延后阶段 6 / GFI）；Docker 集成实测待阶段 6 CI

---

### 阶段 4：每日馈赠 + 回信（stage-4）
**完成时间**：2026-09-10（待提交，终检建议提交）
**阶段产出**：
- `src/domain/gift/`（item-pool 9 种/加权/排除重复/空池兜底、daily-grant、offer、reply）、`src/domain/util/date.ts`（UTC+8 同日）
- repos 扩展（items/inventory/pets）、`002_seed_items.sql`、`src/lib/auth.ts`（requireAuth）
- API：/api/gift/daily、/api/gift/offer、/api/inventory、/api/letters；UI：/gifts、/letter
- 433 单测全过；build exit 0

**关键决策**：
1. 质检 Round 1 抓出 4 个真实 P1（退避字段未持久化/事件字段事务后回填/并发幂等缺失/UI 判定不一致），修复 + 终检确认
2. 幂等改由 DB 条件 UPDATE + affectedRows 保证（非应用层读判断）
3. 三条经验已记 pitfalls（跨阶段字段写入方、DB 级幂等、mock 字段需集成验证）

**遗留问题**：P3-002（inventory.consumed_at 语义复用，待阶段 5）；Docker 集成实测（阶段 6 CI）

---

### 阶段 5：公告 + 档案页（stage-5）
**完成时间**：2026-09-10（待提交，终检建议提交）
**阶段产出**：
- `src/domain/announce/`（hub/backfill/types）、`src/domain/backup/backup.ts`（hash 校验）
- API：/api/announcements（GET+POST：列表/状态/聚合、mark_read/mute/unmute）、/api/announcements/admin（X-Admin-Token/501）、/api/profile
- UI：/announcements、/(pet)/profile；首页导航补齐
- 481 单测全过（+48）；build exit 0

**关键决策**：
1. Round 1 手修 11 项（P0-001 GET 缺失 / P1-001 admin 501 / P1-002 导航 / P2-004-005 / P3×5）；终检独立核验通过
2. P2-001/P2-002/P2-003（system_announce 接入 + 文案剥离）契约化延后阶段 6
3. ⚠️ 重复踩坑标记：API 层零集成测试→P0 逃逸（已记 pitfalls，阶段 6 必修）

**遗留问题**：system_announce 接入（含 params 剥离）→ 阶段 6；API 集成测试 → 阶段 6

---

### 阶段 6：导出/导入 + 部署 + 性能冒烟（stage-6）← 当前阶段（收官）
**开始时间**：2026-09-10
**前置依赖**：阶段 1-5 全部
**核心内容**：数据导出/导入（数据主权闭环）、开发者模式、宝塔+Docker 双路径部署、SELF_HOST、CI、11 项验收全量回归、阶段 5 遗留闭环
**完成时间**：2026-09-10（代码完成，独立质检通过 P0/P1=0，评级「优」；待用户确认提交）
**阶段产出**：
- `src/domain/export/`（schema/exporter/importer/error-messages）+ `GET /api/export`、`POST /api/import`
- 页面 `/export` `/import` `/settings` `/developer` `/account/help`；备用素材包 `morning`；`POST /api/packs/activate`
- 部署：next.config standalone + trace；docker/Dockerfile + compose.yml；pm2-ecosystem；SELF_HOST.md；scripts/smoke|backup；.github/workflows（ci + release）
- 阶段 5 闭环：P2-001/002/003（system_announce 接入 + 文案剥离 + 聚合隐藏）；P3-007 rollback 测试
- 集成测试 `tests/integration/export-import.api.test.ts`（真实 MySQL，CI 跑）；单测 508 passed（+27）
**关键决策**：
1. 导入=恢复语义（先清空当前用户数据再按导出重建，单事务）；校验顺序版本→校验和→字段（§4.3）
2. P2-001 解法：admin 发布公告时为所有 pet 插 system_announce 事件（同一事务），渲染时反查公告表补文案
3. standalone 运行时相对路径文件（migrations .sql / 素材包）用 outputFileTracingIncludes 纳入产物
4. withTransaction 增加可选 pool 参数作测试缝；vitest beforeEach 用 resetAllMocks（踩坑已记）
**遗留问题**：
- 真 MySQL E2E 演示未跑（本机 Docker 不可用）；CI 已配临时 MySQL service，推送后自动补
- 基线 lint 债（stage 1-5 的 19 errors）未清理——已由 CI 限定 eslint src 并记录

---

## 项目全局状态
- 当前阶段：**全部 6 阶段完成（2026-09-10 收官）**，阶段 6 已提交 `f82c357`
- 完成情况：11/11 验收全量通过（最终验收报告 `reports/final-acceptance.md`）
- 关键文档索引：
  - `docs/requirements.md` — 需求 + 验收（权威）
  - `docs/architecture.md` / `docs/database-schema.md` — 架构 + MySQL DDL
  - `docs/dev-stage-plan.md` — 阶段计划 + 验收矩阵（7 表全 ✅）
  - `docs/packs-contract.md` — 事件-素材契约 v1.0.1（冻结）
  - `docs/SELF_HOST.md` — 自托管部署指南（宝塔 + Docker 双路径）
  - `docs/pitfalls.md` — 自学习日志（含跨项目可复用清单，收官整理）
  - `reports/final-acceptance.md` — 11 项验收最终报告
  - `README.md` / `README.zh-CN.md` — 项目简介（进度全 ✅）
- 遗留：真 MySQL 集成/E2E 待 CI（GitHub Actions MySQL service 自动补）；基线 lint 债 19 errors（阶段 1-5 遗留）

## 上下文压缩说明
> 此摘要由 AI 在阶段转换时自动生成。
> 之前的对话记录已被压缩至此，以控制 token 成本。
> 如有需要查阅更早的对话细节，请告知。

---

## 追加：QA / 验收接力 + 收官修复（2026-09-11 ~ 09-13）

**会话性质**：手动 E2E 验收推进 + 链路审计（code-audit 三步法）+ 三组修复。
**产出**：
- `docs/audit/`（step1 逻辑地图 / step2 反向验证 / step3 测试报告 / audit-summary）
- `docs/session-handoff-2026-09-13.md`（**交接文档，新会话必读**）
- 修复：补算前端接线（sync-client）、馈赠欢迎卡、开发工具区环境隐藏、新旧事件提示条（offlineStartTs 分界）、P1-001 退避始终写回、回信模板病句、gift-tray"pet"硬编码、品牌名抽离 .env

**关键决策**：
1. 补算/馈赠/回信的触发链路(前端)本次才接线——此前验收靠手动 curl,属"验收绿、产品断线"
2. 品牌名不硬编码:全部抽离到 `.env`(APP_NAME/APP_BRAND_KEY/NEXT_PUBLIC_*),改名只改配置
3. 未读角标方案否决(佛系原则),改用"你不在的时候发生了 N 件事"提示条 + 分隔线
4. 导入语义=恢复(全量覆盖,单事务)已实测逐字段一致;多出的新事件是导入后 sync 自动补算/馈赠,非残留

**遗留**：git 未提交(工作区 30+ 改动)；验收 8/11/7 错误分支未做；分割线待自然场景；详见交接文档。

---

## 追加：发布前增量（pre-launch，2026-09-15）

> 基于 `docs/session-handoff-pre-launch.md` 启动，dev-team-workflow 工作流 B。
> 需求讨论（阶段 1）→ 产品评审（阶段 2）→ 架构确认（阶段 3）→ 分增量开发（阶段 4）→ 收尾（阶段 5）。

### 已完成增量

| 增量 | 提交 | 内容 |
|---|---|---|
| 1 | `e3e4abe feat(prelaunch-1)` | 事件引擎 first_meeting（第 12 类）+ 初始事件倒推 + 契约 1.1.0 + 创建事务 + P0-1 馈赠跳过 |
| 2 | `07c4051 feat(prelaunch-2)` | 小刺猬素材 8 张 + 首页背景/状态图接线 + desk hint + 收尾句双落点 + 信纸背景 |
| 3 | `256f7a7 feat(prelaunch-3)` | README 借势叙事 + docs/why-self-hosted.md + pitfalls 复盘 |
| 机动 | `13e4e47 fix(mobile)` | 首页 nav wrap + pet 图移动端缩小 + first-meeting-note 真实插图 |
| 机动 | `1b44f1b fix(auth)` | mail-sender SMTP 连接/套接字超时（防卡死） |

### 关键决策

1. 默认 pet = 小刺猬（自然系，避开猫狗赛道，不与青蛙 IP 形象冲突）
2. 叙事修正：数据归个人 / 可迁移 / 不做反 AI（handoff 的「不喂第三方」叙事被否决）
3. P0-1：创建当日跳过每日馈赠，首馈赠 T+1；判据必须用 `pet.createdAt`（用 `dailyGrantLastDate` 会永久停摆）
4. first_meeting：不进 RANDOM_TYPES/补算池/dev 白名单（4 道守卫单测锁死）
5. 初始事件：1–2 条、限 at_home 类型池、ts 倒推 6~48h（“初见前它已在此”）
6. 契约 1.1.0：minor 兼容；texts.first_meeting/guidance 可选 + loader 字段级回退物化（旧包零改动可用）
7. 收尾句：双落点（首页页脚 pagehide 兑底 + /settings logout→/login?farewell=1），localStorage 按 petId 标记
8. 图片键不重复：仅 default 包放 PNG，morning/night 走字段级物化回退

### 验证结果

- `npx tsc --noEmit` → 0 errors
- `npx vitest run` → 543 passed / 8 skipped（与基线一致，新增 ~35 条单测）
- SMTP 通道确认可用（真实收到退信，example.com 无 MX 属预期）

### 遗留（用户侧操作）

- GitHub 公开 + 官方托管部署（域名 / 服务器）
- 发布前真 MySQL 全量回归 11 项（CI 可自动补）
- 发布后 30–60 天止损检查（star<200 且自托管实例<50 → 维护态）