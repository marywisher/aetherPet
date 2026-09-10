# 当前执行阶段指令

> 本文件由主 agent 在启动阶段开发链前写入，链内工程师/质检员必须先读本文件确认范围。
> 请在**无上级指示冲突**时，以本文件为准执行。

## 当前阶段：阶段 2 — pet 状态机 + 事件引擎 + 契约定稿

**详细范围**：见 `docs/dev-stage-plan.md` §3「阶段 2」章节（模块清单、阶段演示、验收要点、关键交付物）。

**权威文档**（务必阅读）：
- `docs/dev-stage-plan.md`（阶段计划，v1.1）
- `docs/architecture.md`（架构 v1.1，重点 §5 事件-素材契约、§6 素材包机制）
- `docs/database-schema.md`（MySQL DDL v1.1）
- `docs/requirements.md`（验收标准 §6）
- `CONTEXT.md`（领域术语：退避间隔、事件、表现素材包）
- `reports/qa-final.md`（阶段 1 质检结论与遗留问题，含代码规范参考）

**工作目录**：C:/Python Auto/Python AI/cl/flutter/aetherPet（阶段 1 已完成：Next.js 16 骨架、MySQL 连接池、认证、素材包加载器、`src/domain/packs/` 已存在）

## 阶段 2 验收覆盖

| 验收项 | 本阶段完成度 |
|--------|-------------|
| #3 随机事件引擎（含记忆引用） | 完整：低频随机、≥30% 自然带 pet 名字（1000 次采样单测）、记忆引用正确率 |
| #8 素材包可配置性 | 契约部分：`docs/packs-contract.md` 定稿冻结（pack_schema_version=1.0.0） |

## 关键约束

1. **契约冻结**：本阶段结束产出 `docs/packs-contract.md` 并冻结，此后只允许 bump 版本号
2. **事件结构不含文案**：event 只有结构与参数（params），文案/插槽引用来自素材包（解耦铁律，见 CONTEXT.md「事件」）
3. 领域层纯 TS（禁 import next/react）；`src/domain/**` 保持零框架依赖
4. 时间戳统一 BIGINT UTC ms；主键 ULID；每表 hub_id + schema_version（沿用阶段 1 模式）
5. 单测覆盖：每种事件类型生成器、FSM 全部转换、记忆检索采样、时间锚点
6. 素材包 default/text/*.json 从占位符升级为完整文案（日常废话 + 诗意两档 9:1）
7. **不要执行 git commit/push**（提交由主 agent 在用户确认后执行）
8. 页面首页渲染事件卡片（事件卡片 UI + 记忆引用高亮）作为本阶段演示，但完整时间线 UI 是阶段 3 内容，本阶段只做最小渲染