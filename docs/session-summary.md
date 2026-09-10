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

### 阶段 4：每日馈赠 + 回信（stage-4）← 当前阶段
**开始时间**：2026-09-10
**前置依赖**：阶段 3（退避调度、/api/sync、回信生成器）
**核心内容**：物品池 ≥8 种、首次登录奖励、赠送日限一次、24h 回信含记忆引用、物品栏 UI、退避联动

---

## 项目全局状态
- 当前阶段：阶段 2
- 已完成：阶段 1（含需求/评审/架构）
- 待完成：阶段 2–6
- 关键文档索引：
  - `docs/requirements.md` — 需求 + 验收（权威）
  - `docs/architecture.md` / `docs/database-schema.md` — 架构 + MySQL DDL
  - `docs/dev-stage-plan.md` — 阶段计划 + 验收矩阵
  - `docs/packs-contract.md` — 事件-素材契约（阶段 2 产出，届时冻结）
  - `docs/pitfalls.md` — 自学习日志（4 条）
  - `README.md` / `README.zh-CN.md` — 项目简介

## 上下文压缩说明
> 此摘要由 AI 在阶段转换时自动生成。
> 之前的对话记录已被压缩至此，以控制 token 成本。
> 如有需要查阅更早的对话细节，请告知。