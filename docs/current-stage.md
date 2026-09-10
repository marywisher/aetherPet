# 当前执行阶段指令

> 本文件由主 agent 在启动阶段开发链前写入，链内工程师/质检员必须先读本文件确认范围。
> 请在**无上级指示冲突**时，以本文件为准执行。

## 当前阶段：阶段 6 — 导出/导入 + 部署 + 性能冒烟（**收官阶段**）

> ✅ 阶段 5（公告 + 档案页）已完成：481 单测全过、终检 P0/P1/P2=0、建议提交。
> ⚠️ 阶段 5 教训（docs/pitfalls.md 最新 3 条必读）：
> 1. **⚠️ 重复踩坑：API 层零集成测试 → P0 逃逸**。本阶段必须补齐 API 层集成测试（临时 MySQL 容器或内存 DB）
> 2. 交付声明必须与代码一致（质检要 grep 关键导出符号，不采信报告）
> 3. 不存在的路径不该存在（备用路径要么实现可用要么删除）

**详细范围**：见 `docs/dev-stage-plan.md` §3「阶段 6」章节（模块清单、演示、验收、交付物）。

**权威文档**：
- `docs/dev-stage-plan.md`（阶段 6）
- `docs/requirements.md`（§3.9 数据导出规范 v1、§3.10 素材包、§3.12 部署、验收 #7/#8/#9/#11）
- `CONTEXT.md`（数据主权、公告、中心自治邮件）
- `docs/database-schema.md`（导出结构 §4.2）、《架构》§4.3.3（导出导入时序）
- `docs/pitfalls.md`（**最新 3 条必读**）
- `reports/qa-final-stage5.md`（阶段 5 结论与延后项）

**工作目录**：C:/Python Auto/Python AI/cl/flutter/aetherPet（阶段 1-5 完成，481 单测基线；Docker 本机不可用，集成/E2E 以静态 + 构建验证为主）

## 阶段 6 验收覆盖（最后 4 项 + 全量回归）

| 验收项 | 本阶段完成度 |
|--------|-------------|
| #7 数据导出/导入 | 完整：schema 版本 + SHA256 + 元信息 + 三类报错分文案 + 逐字段比对 |
| #8 素材包可配置性 | 开发者模式切换包验证 |
| #9 部署 + 性能 | standalone + 宝塔/Docker 双路径文档 + 冒烟（<3s 加载、补算秒级） |
| #11 账号申诉 | 申诉页面存在、备份 hash 作身份证明 |
| #1-#6、#10 回归 | 全量 E2E 覆盖（尽量） |

## 阶段规划模块

1. **导出器/导入器** `src/domain/export/`（exporter/importer/schema/error-messages）+ `GET /api/export`、`POST /api/import`
2. **前端**：/export（确认弹窗）、/import（导入 + 三类报错展示）
3. **申诉入口**：/account/help（备份 hash + 邮箱证明流程说明）
4. **开发者模式**：/developer + `POST /api/packs/activate`（素材包切换验证）
5. **部署**：next.config standalone、docker/Dockerfile + compose、pm2-ecosystem、SELF_HOST.md（宝塔 + Docker 双路径）、scripts/smoke-test.ts、scripts/backup.ts（mysqldump 包装）、.github/workflows（CI 用临时 MySQL）
6. **阶段 5 遗留闭环**：P2-001（system_announce 接入 events + **生成器 params 剥离文案只存 announcement_id**，P2-003）、P2-002（公告聚合列表隐藏已聚合项）、API 集成测试补齐
7. **清理**：Edge Runtime 噪音确认（healthz/instrumentation 已加 runtime 声明）；P3-007（withTransaction rollback 端到端测试）

## 关键约束

1. 导出 JSON 必须含 `schema_version`（1.0.0）/ `exported_at` / `exported_from`（hub_id）/ SHA256 checksum；导入三类错误分文案（版本不匹配/校验和失败/字段缺失）
2. 导入走单一事务，失败整体 rollback（不得出现半导入状态）
3. 领域层纯 TS；事件结构不含文案（**P2-003 必须改**）；MySQL 保持；契约评估后再决定是否 bump（system_announce 插槽改动需契约评审）
4. 部署文档是硬交付——宝塔（Apache 反代 + PM2 + MySQL + mysqldump 备份）与 Docker Compose 双路径都要写全
5. 不要 git commit/push；Docker 不可用时集成验证降级为静态 + 构建（标注遗留）