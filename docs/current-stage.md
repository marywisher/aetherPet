# 当前执行阶段指令

> 本文件由主 agent 在启动阶段开发链前写入，链内工程师/质检员必须先读本文件确认范围。
> 请在**无上级指示冲突**时，以本文件为准执行。

## 当前阶段：阶段 5 — 公告 + 档案页

> ✅ 阶段 4（每日馈赠 + 回信）已完成：433 单测全过、终检 P0/P1/P2=0、建议提交。
> ⚠️ 阶段 4 教训（务必阅读 docs/pitfalls.md 最近 3 条）：
> 1. **跨阶段字段必须明确写入方**——上游「只计算不持久化」会让下游判断变死代码
> 2. **「限一次/去重/状态转换」必须由 DB 条件更新 + affectedRows 保证**，不得靠应用层先读后写
> 3. 单测 mock 的字段必须在集成用例里验证一次真实写入路径

**详细范围**：见 `docs/dev-stage-plan.md` §3「阶段 5」章节。

**权威文档**：
- `docs/dev-stage-plan.md`（阶段 5）
- `docs/requirements.md`（§3.6 档案页、§3.8 公告 + §3.13 邮件白名单、验收 #2 / #6 / #11）
- `CONTEXT.md`（术语：公告、数据主权）
- `docs/architecture.md`（公告模块 §4.1 announce）
- `docs/database-schema.md`（announcements / user_announcement_reads / memories / inventory / users.last_backup_hash）
- `reports/qa-final-stage4.md`（阶段 4 结论）
- `docs/pitfalls.md`（**最近 3 条必读**）

**工作目录**：C:/Python Auto/Python AI/cl/flutter/aetherPet（阶段 1-4 完成：认证、素材包、事件引擎、补算、退避、时间线、馈赠/回信、/api/sync）

## 阶段 5 验收覆盖

| 验收项 | 本阶段完成度 |
|--------|-------------|
| #2 档案页 | 完整：状态卡片、记忆片段、事件历史入口、储物罐 |
| #6 公告 | 完整：发布→同步可见、已读/未读、静音、倒序、空窗聚合 |
| #11 账号安全与恢复（申诉部分） | `users.last_backup_hash` 更新逻辑（完整闭环在阶段 6） |

## 阶段规划模块

1. **公告中心** `src/domain/announce/`：hub.ts（发布/倒序列出/已读未读/静音）、backfill.ts（空窗期聚合）
2. **公告 API**：`GET /api/announcements`、`POST /api/announcements/admin`（MVP 仅本地管理，无联邦）
3. **公告 UI** `src/app/announcements/page.tsx`：倒序列表、已读/未读、静音 N 条、空态
4. **档案页** `src/app/(pet)/profile/page.tsx`：状态卡片、记忆片段、事件历史入口、储物罐
5. **备份 hash**：每次导出后更新 `users.last_backup_hash`（本阶段先铺逻辑，导出功能在阶段 6）
6. `system_announce` 事件 + 素材包公告文案

## 关键约束

1. **公告空窗聚合**：>7 天未读走聚合摘要（沿用补算策略），不逐条轰炸
2. 公告倒序 + 已读/未读 + 静音（跳过 N 条）为硬需求
3. 领域层纯 TS（禁 next/react）；MySQL 条件更新保证幂等（借鉴阶段 4 教训）；事件结构不含文案
4. 不 bump 契约版本（v1.0.1）；P3-002（inventory.consumed_at 复用）本阶段可处理，但需说明是否变更数据模型
5. 本阶段不含导出/导入功能本身（阶段 6），仅铺 `last_backup_hash` 更新逻辑
6. **不要执行 git commit/push**（提交由主 agent 在用户确认后执行）