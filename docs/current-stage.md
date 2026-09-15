# 当前执行阶段指令

> 本文件由主 agent 在启动阶段开发链前写入，链内工程师/质检员必须先读本文件确认范围。
> 请在**无上级指示冲突**时，以本文件为准执行。

## 当前阶段：发布前增量（pre-launch）已完成 ✅

> **状态**：3 个增量 + 2 项机动修复全部提交（`e3e4abe` → `1b44f1b`，见 git log）。
> **验证**：`tsc` 0 错；`vitest` 543 passed / 8 skipped；SMTP 通道实测可用。
> **剩余 = 用户侧操作**：① GitHub 公开 ② 官方托管部署（域名/服务器）③ 发布后 30–60 天止损检查（star<200 且自托管实例<50 → 维护态）。
> 详细记录见 `docs/session-summary.md` 末尾「追加：发布前增量」章节。

---

## 历史阶段：阶段 6 — 导出/导入 + 部署 + 性能冒烟（已提交 `7aa9b07`）

## 阶段 6 已完成交付（质检已核验）

1. **导出器/导入器** `src/domain/export/`（schema.ts / exporter.ts / importer.ts / error-messages.ts）+ `GET /api/export`、`POST /api/import`
   - 导出含 `schema_version=1.0.0` / `exported_at` / `exported_from` / `SHA256` 校验和；排除 token/验证码/审计/邮箱明文
   - 导入三类错误分文案（版本不匹配 / 校验和失败 / 字段缺失），单事务恢复（先清空再重建，失败整体 rollback）
   - 导出更新 `users.last_backup_hash`（申诉身份证明）；导入更新 `imported_from_hub/imported_at`
2. **前端**：/export（确认弹窗：包含/不包含清单）、/import（文件预览 + 三类报错分类展示）、/settings（修复阶段 5 遗留 404 链接）
3. **申诉入口**：/account/help（备份 hash + 邮箱证明流程）；/api/profile 新增 emailHash/lastBackupHash/createdAt
4. **开发者模式**：/developer + `POST /api/packs/activate`（事务落库 pets + user_settings + 审计 pack_switched）；新增备用素材包 `morning`
5. **部署**：`next.config.ts` output: standalone + trace includes（migrations/*.sql + packs）；docker/Dockerfile + docker-compose.yml；
   pm2-ecosystem.config.js；SELF_HOST.md（宝塔 + Docker 双路径全流程）；scripts/smoke-test.ts + scripts/backup.ts（mysqldump 包装）；
   .github/workflows/ci.yml（含临时 MySQL service 跑集成测试）+ release.yml（tag 触发镜像构建）
6. **阶段 5 遗留闭环**：P2-001/P2-003（system_announce 生成器 params 只存 announcement_id + admin 发布时为全 pet 插入事件、
   时间线渲染反查公告）、P2-002（公告聚合列表主列表隐藏已聚合项 + 次级展开）；P3-007（withTransaction rollback 端到端测试）
7. **集成测试补齐**（阶段 5 重复踩坑闭环）：`tests/integration/export-import.api.test.ts`（真实 MySQL，`INTEGRATION_DB=1` 启用，CI 自动跑）

## 验证结果（当前工作区）

- `npx tsc --noEmit` → 0 错误
- `npx vitest run` → 508 passed / 8 skipped（集成测试需 INTEGRATION_DB=1 + 真实 MySQL；CI 中运行）
- `npm run build` → exit 0（6 条 Edge-runtime 噪音与基线一致，属 stage 3 已确认项）
- `npx eslint src` → 新文件 0 错误；剩余 errors 全为基线历史债（stage 1-5 遗留）
- `npm run smoke:skip-db` → 全通过（30 天补算平均 0ms；DB/事务 P99 项需真 MySQL，CI 跑）

## 待办与约束（历史，阶段 6）

> ℹ️ 以下 4 条为阶段 6 时的约束，其中第 1 条（不 commit）已于 09-11 执行完成（`7aa9b07`）；
> 其余 2–4 条仍适用于后续真 MySQL 演示场景。当前生效的待办见文件顶部「当前阶段」节。

1. **不要 git commit/push**——等待用户确认后再提交（提交信息建议：`feat(stage-6): 导出/导入+部署+性能冒烟`）
2. Docker 本机不可用：集成/E2E 以静态 + 单测 + 构建验证为准；CI 用临时 MySQL 容器补真实集成
3. 若需真 MySQL 演示（导出一致性/切换包视觉变化），用 docker compose（路径 b）或宝塔 MySQL 起
4. 11 项验收最终回归矩阵见 `docs/dev-stage-plan.md` §7（#7/#8/#9/#11 已由本阶段交付 + QA 核验）