# 当前执行阶段指令

> 本文件由主 agent 在启动阶段开发链前写入，链内工程师/质检员必须先读本文件确认范围。
> 请在**无上级指示冲突**时，以本文件为准执行。

## 当前阶段：阶段 1 — 地基 + 认证 + 素材包加载

**详细范围**：见 `docs/dev-stage-plan.md` §3「阶段 1」章节（含模块清单、阶段演示目标）。

**权威文档**（务必阅读）：
- `docs/dev-stage-plan.md`（阶段计划，v1.1）
- `docs/architecture.md`（架构 v1.1：MySQL 8.x + mysql2 异步连接池 + async 事务）
- `docs/database-schema.md`（DDL 为 MySQL 方言）
- `docs/requirements.md`（验收标准 §6）
- `CONTEXT.md`（领域术语）

**工作目录**：C:/Python Auto/Python AI/cl/flutter/aetherPet（当前为空目录，从零初始化项目）

## 阶段 1 验收覆盖

| 验收项 | 本阶段完成度 |
|--------|-------------|
| #1 注册登录（含安全边界） | 完整：验证码节流、token 30 天、退出登录 |
| #8 素材包可配置性 | 加载部分：manifest 校验、损坏包回退逻辑+单测 |
| #11 账号安全 | 节流/过期部分 |

## 关键约束

1. **数据库必须是 MySQL 8.x**（不是 SQLite！）——开发环境本地 Docker MySQL，见架构 v1.1
2. **中心自治邮件**：SMTP 配置从 `.env` 读取；验证码邮件必须带中心身份标识（Header `X-Aetherpet-Hub` + 正文中心名 + 隐私承诺页 + 管理员邮箱），见 `CONTEXT.md`「中心自治邮件」术语
3. 领域层纯 TS（禁 import next/react），可独立 Vitest 单测
4. 项目根目录工作：若当前目录没有 package.json，先 `npx create-next-app` 初始化（TS + App Router + Tailwind，`--use-npm`）
5. 初始 git 仓库可在链内建立；**不要执行 git commit/push**（提交由主 agent 在用户确认后执行）
6. 每完成一个模块跑通相关单测；阶段结束跑一次演示路径（见 dev-stage-plan §3 阶段 1 演示）