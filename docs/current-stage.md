# 当前执行阶段指令

> 本文件由主 agent 在启动阶段开发链前写入，链内工程师/质检员必须先读本文件确认范围。
> 请在**无上级指示冲突**时，以本文件为准执行。

## 当前阶段：阶段 4 — 每日馈赠 + 回信

> ✅ 阶段 3（补算 + 退避 + 事件流 UI）已完成（355 单测全过、build exit 0、质检 P0/P1=0，P2×3 已手修）。
> ⚠️ 阶段 3 经验：连续长链可能触发 API 限流 → 本阶段建议短链（开发→质检→终检三段），P2 由主 agent 手修。
> 阶段 3 遗留：P3×6（轻量，延后阶段 6 或作为 GFI）；Docker 集成实测待阶段 6 CI。

**详细范围**：见 `docs/dev-stage-plan.md` §3「阶段 4」章节。

**权威文档**（务必阅读）：
- `docs/dev-stage-plan.md`（阶段 4 章节）
- `docs/requirements.md`（§3.7 每日馈赠 + 回信、验收 #10）
- `CONTEXT.md`（术语：物品、馈赠/便当、回信、退避间隔）
- `docs/architecture.md`（§4.3.2 馈赠时序）
- `docs/database-schema.md`（items/inventory/pets 表：daily_grant_last_date、offer_last_date、reply_pending）
- `reports/qa-final.md`（阶段 3 质检结论与代码规范）

**工作目录**：C:/Python Auto/Python AI/cl/flutter/aetherPet（阶段 1+2+3 完成：认证、素材包、事件引擎、补算、退避、时间线、/api/sync）

## 阶段 4 验收覆盖

| 验收项 | 本阶段完成度 |
|--------|-------------|
| #10 每日馈赠闭环 | 完整：物品池 ≥8 种、每日限一次、24h 内回信含 ≥1 记忆引用、退避表可观测 |
| #3 事件引擎 | 补充：daily_grant / offer_received 事件类型与回信耦合（已有生成器，需与馈赠流程接通） |

## 阶段规划模块

1. **物品池**：`src/domain/items/`（seed 数据 ≥8 种、加权抽取 + 排除最近 3 次重复、空池兜底文案）
2. **馈赠流程**：`src/domain/gift/`（首次登录奖励、赠送日限一次、奖励/赠送/回信状态机）——结合 pets 表 daily_grant_last_date / offer_last_date / reply_pending
3. **回信调度**：馈赠后 24h 内随机生成回复事件（reuse 阶段 2 reply-letter 生成器）+ 退避表联动
4. **UI**：桌上物品展示、物品栏（inventory）、赠送交互、回信展示
5. **API**：`POST /api/gift`（赠送）、`POST /api/gift/claim`（领取每日奖励）或并入 /api/sync

## 关键约束

1. 物品归用户所有（物品栏），用户**主动**摆放（不是系统自动冒出）——见 CONTEXT.md「馈赠/便当」
2. 每日限一次、错过不惩罚；**用户文案禁止「打卡/签到」措辞**
3. 回信至少含 1 条记忆引用（物品名/命名/时间锚点任一），沿用 render/recall 机制
4. 事件结构不含文案；领域层纯 TS；MySQL 约束；不 bump 契约版本（v1.0.1 冻结）
5. 物品池数据放 `src/domain/items/`（代码级 seed），不入 DB migration（或入 migration 亦可，以 schema 文档为准）
6. 退避表联动：缺席期间回信检查按 next_proactive_ts 调度（阶段 3 backoff 可观测性落地）
7. P3×6 遗留项本阶段**不处理**
8. **不要执行 git commit/push**（提交由主 agent 在用户确认后执行）