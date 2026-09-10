# aetherPet

**一款开源、可插拔、低频互动的 AI 陪伴宠物。** 🍃🐾

aetherPet 是《旅行青蛙》的精神续作：你的宠物在自己的小世界里安静地过日子——它出门散步、看水、数叶子，偶尔给你写一封信。没有社交、没有排行榜、没有「你该回来了」的催促。只有一个小小的、温暖的、记得你的存在。

> English version: [README.md](./README.md)

---

## 为什么做它

《旅行青蛙》下架了。我们自己做一只。

aetherPet 被设计为**一个开源生态**，而不是一个封闭应用：

- **核心基座 + 可插拔素材包** — 事件引擎与表现层（视觉 + 文案）完全解耦。任何人只需提供一套 *theme/voice pack*（JSON + CSS + 图片）就能给宠物换风格，**无需写代码**。
- **默认隐居模式** — 每只 pet 独立生活，不与其他 pet 交互。没有社交压力，没有互动指标。
- **数据主权** — 宠物的记忆与时间线属于你。可一键导出 JSON，未来可迁移到其它服务中心。
- **设计上的低频** — 你离开越久，pet 的主动来信越克制（1 天 → 3 天 → 7 天 → 30 天，像个懂分寸的朋友）。什么时候回来都可以，它等着。

## 当前进度

| 阶段 | 模块 | 状态 |
|------|------|------|
| 1 | 地基 · 邮箱验证码登录 · 素材包加载 | ✅ 完成（质检通过） |
| 2 | pet 状态机 · 事件引擎 · 契约定稿 | 🔜 下一个 |
| 3 | 补算 · 退避 · 时间线 UI | 待开发 |
| 4 | 每日馈赠 + 回信 | 待开发 |
| 5 | 公告 + 档案页 | 待开发 |
| 6 | 导出/导入 · 部署 · 性能冒烟 | 待开发 |

完整规划见 [`docs/dev-stage-plan.md`](docs/dev-stage-plan.md)，MVP 规格见 [`docs/requirements.md`](docs/requirements.md)。

## 技术栈

- **TypeScript + Next.js（App Router）** — 全栈一体，单进程部署
- **MySQL 8.x**（`mysql2` 异步连接池）— 生产级，宝塔面板友好
- **领域层纯 TS** — 零 `next`/`react` 依赖，可独立 Vitest 单测
- 校验：`zod` · 测试：`vitest`（138+ 单测）

## 快速开始（开发环境）

前置：Node ≥ 20、Docker（本地 MySQL）、npm。

```bash
# 1. 安装依赖
npm install

# 2. 启动本地 MySQL（MySQL 8，与生产同构）
npm run db:up

# 3. 复制环境变量模板，填入 SMTP（任意 SMTP；中心用自己的邮箱发验证码）
cp .env.example .env.local   # 配置 DB_*、SMTP_*、HUB_* 等

# 4. 启动开发服务
npm run dev
# 打开 http://localhost:3000
```

体验路径：用邮箱注册 → 收到验证码（邮件正文带**中心身份标识**：中心名、隐私页、管理员邮箱）→ 给宠物起名 → 进入首页，宠物在家。

```bash
npm test          # 单元测试
npm run typecheck # tsc --noEmit
npm run build     # 生产构建
```

## 日志

服务端按日轮转文件日志（`logs/YYYY-MM-DD.log`）：

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `LOG_DIR` | `logs` | 日志目录 |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_CONSOLE` | `1` | 是否同时输出控制台（`0` 关闭） |

代码中使用：`import { createLogger } from "@/lib/logger"; const l = createLogger("auth");`

## 文档索引

| 文档 | 用途 |
|------|------|
| [`CONTEXT.md`](CONTEXT.md) | 领域术语表（隐居、补算、退避间隔等权威定义） |
| [`docs/requirements.md`](docs/requirements.md) | MVP 需求与 11 项验收 |
| [`docs/architecture.md`](docs/architecture.md) | 架构设计（事件-素材契约、补算、部署） |
| [`docs/database-schema.md`](docs/database-schema.md) | MySQL DDL 与索引设计 |
| [`docs/dev-stage-plan.md`](docs/dev-stage-plan.md) | 6 阶段开发计划与验收矩阵 |
| [`docs/asset-prompts.md`](docs/asset-prompts.md) | 手绘素材包产出示意词（即梦用） |

## 参与共建

欢迎共创者加入：

- **想参与核心开发？** 读 `docs/dev-stage-plan.md`，认领未完成阶段，先开 issue 沟通。
- **想贡献素材包？** 素材包契约将在阶段 2 冻结（`docs/packs-contract.md`）——一套 pack 就是 JSON + CSS + 图片，不写代码也能给宠物换风格。
- **发现 bug？** 开 issue，附上复现步骤与 `logs/` 下相关日志行。

路线图（不在 MVP 范围）：Live2D 表现、AI 对话、明信片生成、插件市场、货币/市场、多中心联邦。

## 许可证

开放核心模式：核心基座开源（首个版本发布前确定具体协议）；部分增值服务可能以闭源插件形式提供。具体待定。

---

*为一杯热茶和「有个小存在，而不是另一个信息流」的人而做。*