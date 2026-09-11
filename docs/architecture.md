# AetherPet MVP · 架构设计文档

> 状态：定稿，交付软件工程师执行
> 关联文档：`docs/requirements.md`（MVP v1.1 · 权威需求）、`docs/product-review.md`（评审报告）、`docs/database-schema.md`、`docs/dev-stage-plan.md`、`CONTEXT.md`

> **修订版本 v1.1（2026-09-09）**：两项权威变更
> 1. **数据库 SQLite → MySQL**：驱动 `better-sqlite3`（同步）→ `mysql2`（异步，连接池）；补算事务改为 async；DDL 全部改写为 MySQL 方言；时间戳统一 BIGINT UTC ms；备份机制改为 `mysqldump` 或导出 JSON；开发环境用本地 Docker MySQL；部署走 Next.js standalone + PM2 + 宝塔 Apache 反代（不再有 SQLite 文件卷）；风险表 R2/R8 相应改写。
> 2. **中心自治邮件（hub-autonomous email）**：注册/验证码邮件由用户所注册的中心自己配置的 SMTP 发出（配置项而非官方硬编码），邮件模板带中心身份标识字段。见 §2.7。
>
> 其余内容（ULID 主键、事件-素材契约、补算/退避/馈赠机制、hub_id + schema_version 预留、阶段划分与工时估算等）不变。

---

## 0. 文档目标

本文件回答三个问题：

1. **AetherPet 的技术骨架长什么样**——四层结构、模块边界、契约接口。
2. **为什么这样选**——每个技术选择从"用在哪、给谁用、要做什么"倒推，不写"生态成熟"这种空话。
3. **未来怎么扩**——多中心迁移、货币市场、插件生态，从 MVP 就预留但不实现。

不回答的问题（明确排除）：具体 React 组件代码、后端每一行实现、测试用例、CI 脚本细节。这些属于工程师在阶段计划下自行的实现。

---

## 1. 架构概览

### 1.1 一句话架构

> **一个前后端同栈的 TypeScript Web 应用**：Next.js 提供 UI + API 层，中间是纯 TypeScript 写的领域层（事件引擎 / 补算 / 记忆 / 素材包 / 退避 / 公告 / 导入导出），底层是 MySQL 持久化（`mysql2` 异步连接池）；素材包与事件契约以 JSON 文件形式落在磁盘，运行期动态加载，实现"表现与逻辑完全解耦"。

### 1.2 四层结构（文字版架构图）

```
┌─────────────────────────────────────────────────────────────────┐
│  ① 前端表现层 (Frontend)                                          │
│     Next.js App Router · React · TailwindCSS · Zustand            │
│     ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│     │ 账号页    │ │ 档案页    │ │ 时间线页  │ │ 公告页    │         │
│     └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│     素材包注入：CSS 变量 + 图片资源 + 文案插槽值                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP (JSON) · bearer token
┌──────────────────────────────▼──────────────────────────────────┐
│  ② API 层 (Edge / Route Handlers)                                 │
│     Next.js Route Handlers (/api/*) · zod 输入校验                  │
│     /auth · /sync · /pet · /gift · /announcements · /export       │
│     /import · /announcements-admin · /healthz                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 函数调用（无跨进程）
┌──────────────────────────────▼──────────────────────────────────┐
│  ③ 领域层 (Domain) — 纯 TypeScript，无框架依赖                     │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│     │ EventEngine │ │ CatchUp     │ │ Backoff     │              │
│     │ 事件引擎     │ │ 补算器       │ │ 退避调度     │              │
│     └─────────────┘ └─────────────┘ └─────────────┘              │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│     │ MemoryIndex │ │ AssetPack   │ │ Gift /Reply │              │
│     │ 记忆检索     │ │ 素材包解析    │ │ 馈赠回信     │              │
│     └─────────────┘ └─────────────┘ └─────────────┘              │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│     │ PetFSM      │ │ Exporter    │ │ AnnounceHub │              │
│     │ 状态机       │ │ 导入导出     │ │ 公告中心      │              │
│     └─────────────┘ └─────────────┘ └─────────────┘              │
│     ★ 领域层不 import next/react/prisma；单元测试可独立跑             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ SQL (mysql2 异步连接池)
┌──────────────────────────────▼──────────────────────────────────┐
│  ④ 持久层 (Persistence)                                           │
│     MySQL 8.x · InnoDB · 事务内做补算（async）                    │
│     开发：本地 Docker MySQL（与生产同构）                          │
│     生产：宝塔环境 MySQL（Apache 反向代理）                        │
│     备份：mysqldump / 导出 JSON（不再依赖 SQLite .backup）          │
└─────────────────────────────────────────────────────────────────┘

旁路：
┌─────────────────────────────────────────────────────────────────┐
│  素材包文件系统 (Asset Packs)                                     │
│     /asset-packs/default/manifest.json                           │
│     /asset-packs/default/text/{散步.json,回信.json,聚合.json}      │
│     /asset-packs/default/images/{home-bg.png,letter-bg.png...}   │
│     ★ 领域层按契约解析；前端按契约消费；二者不感知彼此              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 关键设计决策（一句话版）

| # | 决策 | 一句话理由 |
|---|------|-----------|
| D1 | 前后端同栈 TS + Next.js | 事件契约与素材包 manifest 用同一套 TS 类型生成 JSON schema，让"表现与逻辑解耦"从类型层落到文件层 |
| D2 | 领域层纯 TS，无框架依赖 | 事件引擎、补算、退避调度都要能被单元测试直接跑，不能被 Next.js runtime 绑死 |
| D3 | 补算在服务端、下一次同步请求内做，事务内完成 | 上下文一致、无需分布式锁、秒级可完成；需求已明确补算非进程重启触发 |
| D4 | MySQL 8.x + InnoDB + 单中心单实例（`mysql2` 异步连接池） | 与用户生产环境（宝塔 Apache + MySQL）同构；避免 SQLite 文件卷在托管环境的运维负担；连接池替代 WAL 单写者，事务内做补算仍成立 |
| D5 | 素材包以 JSON 文件为契约，运行期动态加载 | 让"不写代码也能定制表现层"从第一天成立，是共创开发者进入的最低门槛 |
| D6 | 事件 schema_version 与素材包 schema_version 分离 | 事件契约升级与素材包升级独立节奏，避免"改一行文案要升级所有事件类型" |

---

## 2. 技术选型与理由

### 2.1 前端：Next.js 14+ (App Router) + React 18 + TypeScript

**为什么选它，不是 "React 生态好" 这种空话：**

- AetherPet 是**开源项目**，核心承诺是"共创开发者可插拔"。Next.js 的 TypeScript 类型系统 + App Router 让 API route、domain 类型、前端页面**共用一套 TS 定义**。事件契约、素材包 manifest 的 TS interface 一次定义，前端消费、服务端消费、JSON schema 生成三方对齐——这就是"表现与逻辑解耦"能落地的技术前提。
- Next.js 的 **App Router 让前端页面和 API 同仓同进程**，自托管用户 `git clone && npm run build && npm run start` 三步上线，不需要另开 Node 服务、不需要 Docker compose 拆两个容器。这对"官方托管 + 自托管"的双形态是关键——自托管门槛越低越好。
- **SSR 首屏加载 <3s** 是硬指标。App Router 默认 SSR + 静态资源边缘缓存，天然满足 Web Vitals；纯 CSR 前端（如 CRA/Vite SPA）首屏要等 JS bundle，很难保证 <3s。
- 素材包图片、CSS 变量、文案 JSON 都可以通过 `/_assets/packs/:name/*` 的动态路由由 Next.js 静态托管，运行期切换素材包无需重启。

**为什么不是 Vue 3 + Nuxt：**

- 功能等价，但 Nuxt 3 的 TS 类型推断能力（尤其跨目录复用）比 Next.js App Router 略弱。AetherPet 的核心是"契约共享"，契约的严谨度优先于模板语法简洁度。
- 开源生态对比：TypeScript 官方工具链、ESLint/TypeScript 深度集成、`npx @tsc-strict/no-control-regex` 等类型层守门，Next.js 生态更完备。
- 招聘/贡献者池：Node 前端招聘中 Next.js 熟悉者显著多于 Nuxt（尤其中文开发者社区），对开源项目长期贡献度更友好。

### 2.2 后端：Next.js Route Handlers (serverless 抽象)

**为什么不是独立 Express/NestJS/Fastify：**

- 独立后端意味着自托管用户要维护两个仓库、两个 CI、两套类型定义——MVP 阶段没必要。
- Next.js Route Handlers 支持 `export async function POST(req: NextRequest)`，与前端共享 `lib/types.ts`，token 校验、zod 输入验证可以直接 import 领域层函数。
- 部署形态上，Next.js 可以运行在 Node server（`output: 'standalone'`），不需要 serverless 平台，自托管友好。

### 2.3 数据库：MySQL 8.x + mysql2（v1.1 修订）

> **变更说明**：v1.0 采用 SQLite + better-sqlite3（同步）；v1.1 根据用户生产环境实际情况（宝塔 Apache + MySQL）改回 MySQL。驱动换成 `mysql2` 异步连接池；补算事务相应改为 async；DDL、备份、开发环境全部改为 MySQL 方言。领域层不变。

**为什么选 MySQL（而不是 Postgres / SQLite / MongoDB）：**

- **生产环境同构优先**：用户线上是宝塔环境，Apache + MySQL 是既定事实。选 MySQL 意味着无需为 SQLite 引入一套独立部署链路，也避免未来迁到 Postgres 时的方言重写。
- **MySQL 8.x InnoDB 完全满足 MVP 需求**：MVCC + 事务内多行原子写，补算在事务内完成（`async`）后一致性无损失；本地 SSD + 合理连接池下事务 P99 < 200ms。
- **自托管成本**：宝塔/常见 VPS 面板默认带 MySQL，比 SQLite 更熟悉运维；备份用 `mysqldump` 或 JSON 导出即可。
- **JSON 类型原生支持**：`events.params_json`、`events.memory_refs_json` 用 `JSON` 类型，服务端可读 JSON path，不需要 SQLite 的 TEXT 手动 parse。
- **导出 JSON 仍走领域层组装**，不依赖数据库导出能力——数据主权承诺不变。

**为什么用 mysql2（不是 Prisma/Drizzle ORM）：**

- Prisma/Drizzle 的 MySQL 支持在 Next.js standalone 下需要独立 client bundle，自托管复杂度上升；v1.1 仍保持手写 SQL + 类型安全薄封装。
- `mysql2` 是纯 Node、成熟稳定、支持连接池、prepared statements、异步 Promise API，与 async 事务模型契合。
- 事务统一模式：
  ```ts
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // ... INSERT/UPDATE
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  ```
- 连接池默认 `poolSize: 10, waitForConnections: true`，MVP 单中心 <10k 用户足够；补算事务持连接时长 ≤200ms，池不会被占满。
- 手写 SQL + 薄封装（`src/domain/persistence/sql.ts`）保持，避免 ORM 黑盒；**风险与缓解**：见 §9 技术风险第 R2 项。

**开发环境：**

- 本地用 Docker 起 MySQL 8（`docker compose up mysql`），与生产同构，避免方言差异；`.env.example` 提供默认连接参数。
- CI 跑 E2E 也用临时 MySQL 容器，不用 SQLite 降级。

### 2.4 状态管理：Zustand

- 前端只有 4 个页面，状态集中在 `pet`、`token`、`activePack`、`pendingGift`。Zustand 无 boilerplate、无 Provider 嵌套，适合"低频交互"应用。
- Redux Toolkit 过重；React Query 只适合纯服务端状态，AetherPet 有大量前端本地状态（当前素材包、渐进披露展开状态）需要独立管理。

### 2.5 UI 库：TailwindCSS + 手写组件

- 素材包要能"整体替换视觉"——Tailwind 的 CSS 变量系统天然支持通过一个 `pack.css` 覆盖颜色、间距、字体。
- 手写组件保证组件树精简、包体小（Web Vitals <3s 依赖于此）。
- 不用 AntD/MUI：它们的组件风格强、难以被"素材包 CSS 变量"完全接管，与"表现可插拔"的理念冲突。

### 2.6 输入校验：Zod

- API 层的每个 body/params 都用 zod schema 校验，schema 同时用于 TS 类型推导、错误消息、JSON schema 生成（素材包契约也用同一套）。
- 单一来源，避免"schema 定义和类型定义不一致"的经典事故。

### 2.7 邮件：Nodemailer + 中心自治 SMTP（hub-autonomous email，v1.1 新增）

> 术语对齐 `CONTEXT.md` 中的「中心自治邮件」：注册/验证码邮件由**用户所注册的服务中心自己配置的 SMTP** 发出，不由官方硬编码注入。

- **SMTP 配置为服务端配置项**（不是官方密钥）：
  - `.env` 里放 `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE`
  - 官方中心用官方 SMTP，自托管中心用各自 SMTP；同一份代码跑在不同中心自动生效
- **邮件模板带中心身份标识字段**（透明 + 防钓鱼，与 CONTEXT.md 三条配套机制对齐）：
  - 邮件 Header `X-Aetherpet-Hub`：当前中心 `hub_id`
  - 邮件正文抬头固定显示中心名称（来自 `meta.hub_id` + `meta.hub_display_name`）
  - 邮件正文尾部链接到该中心的隐私承诺页 + 管理员联系邮箱（配置项 `HUB_ADMIN_EMAIL`、`HUB_PRIVACY_URL`）
- 服务商不硬编码：Nodemailer 支持 SES / Resend / Gmail SMTP / 自建 SMTP / QQ/163 等主流服务
- 每次邮件推送写审计日志到 `audit_log` 表（需求 §3.13、评审 P1-8）
- **推论**：官方无法直接触达非本中心注册的用户——这是去中心化的本意；如需跨中心通知，走未来「联邦广播」通道（见 §7.1）

### 2.8 测试：Vitest + Playwright

- Vitest 跑领域层单元测试（事件引擎、补算、退避、导入导出）——纯 TS，跑得飞快。
- Playwright 跑端到端（注册 → 创建 pet → 送赠 → 收回信 → 导出）——对齐 11 项验收。

### 2.9 为什么不是这些（明确排除）

| 排除项 | 原因 |
|--------|------|
| Node.js 原生 fetch 服务端（不用 Next.js） | 自托管部署复杂度上升 |
| 独立微服务（pet-service、auth-service、asset-service） | MVP 阶段过度设计，"开源基座"需要简单可理解 |
| PostgreSQL / MongoDB | v1.1 根据用户生产环境（宝塔 Apache + MySQL）改回 MySQL；Postgres 保留为未来可选方言 |
| Redis 缓存 | 单中心小数据量下 MySQL 查询已足够快（连接池 + InnoDB）；引入 Redis 增加运维负担 |
| TypeScript ORM (Prisma/Drizzle) | 见 §2.3 |
| 前端框架 Vue/Nuxt | 见 §2.1 |
| 图片上传（用户上传头像） | MVP 无此需求；所有视觉来自素材包 |
| 消息队列（Bull/RQ） | 补算在同步请求内完成，不需要队列 |

---

## 3. 项目结构

```
aetherPet/
├── docs/                              # 本文档所在
│   ├── requirements.md
│   ├── product-review.md
│   ├── architecture.md                ← 本文件
│   ├── database-schema.md
│   ├── dev-stage-plan.md
│   ├── architecture-summary.md        ← 给编排者读的总览
│   ├── asset-prompts.md
│   └── pitfalls.md
├── CONTEXT.md                         # 领域术语表（权威）
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── layout.tsx                 # 根布局（素材包 CSS 变量注入点）
│   │   ├── page.tsx                   # 首页 / 登录
│   │   ├── (account)/                 # 账号区
│   │   │   ├── login/page.tsx
│   │   │   ├── verify/page.tsx
│   │   │   └── create-pet/page.tsx    # 命名入口
│   │   ├── (pet)/                     # pet 主页区
│   │   │   ├── profile/page.tsx       # 档案页
│   │   │   ├── timeline/page.tsx      # 事件流（渐进披露入口）
│   │   │   ├── gifts/page.tsx         # 每日馈赠 + 送赠
│   │   │   └── letter/page.tsx        # 回信阅读
│   │   ├── announcements/page.tsx     # 公告列表
│   │   ├── export/page.tsx            # 导出确认弹窗 + 下载
│   │   ├── import/page.tsx            # 导入 + 版本校验
│   │   └── api/                       # Route Handlers
│   │       ├── auth/
│   │       │   ├── request-code/route.ts     # 发验证码（含节流）
│   │       │   ├── verify/route.ts           # 校验 + 发 token
│   │       │   ├── logout/route.ts
│   │       │   └── token/refresh/route.ts
│   │       ├── sync/route.ts                 # 主同步入口（补算在这触发）
│   │       ├── pet/route.ts                  # 当前 pet 详情
│   │       ├── timeline/route.ts             # 事件流（分页 + 展开聚合）
│   │       ├── gift/
│   │       │   ├── daily/route.ts            # 每日馈赠（首次登录）
│   │       │   └── offer/route.ts            # 送赠（日限一次）
│   │       ├── letter/route.ts               # 回信详情
│   │       ├── announcements/route.ts        # 公告列表 + 已读标记
│   │       ├── announcements/admin/route.ts  # 发公告（自托管管理员）
│   │       ├── export/route.ts
│   │       ├── import/route.ts
│   │       ├── packs/route.ts                # 列出可加载素材包
│   │       ├── packs/activate/route.ts       # 开发者模式切换素材包
│   │       └── healthz/route.ts
│   ├── domain/                        # 领域层（纯 TS，无 next 依赖）
│   │   ├── events/
│   │   │   ├── engine.ts                 # 随机事件引擎核心
│   │   │   ├── types.ts                  # EventType 枚举、Event schema
│   │   │   ├── templates.ts              # 事件模板注册表
│   │   │   └── generators/               # 每个事件类型一个生成器
│   │   │       ├── outing.ts             # 外出散步
│   │   │       ├── watching-water.ts     # 看水
│   │   │       ├── counting-leaves.ts    # 数叶子
│   │   │       ├── self-talk.ts          # 自言自语
│   │   │       ├── brought-item.ts       # 带回物品
│   │   │       ├── reply-letter.ts       # 馈赠回信
│   │   │       ├── spontaneous-letter.ts # 自主冒信
│   │   │       ├── aggregate-summary.ts  # 聚合摘要
│   │   │       └── announcement.ts       # 系统公告事件
│   │   ├── fsm/
│   │   │   └── pet-fsm.ts                # 在家/出门/旅行 状态机
│   │   ├── catchup/
│   │   │   ├── planner.ts                # 补算计划（≤20 条 + 聚合）
│   │   │   ├── executor.ts               # 事务内执行
│   │   │   └── aggregator.ts             # 聚合摘要生成
│   │   ├── backoff/
│   │   │   └── scheduler.ts              # 退避间隔计算（表驱动）
│   │   ├── memory/
│   │   │   ├── index.ts                  # 记忆检索
│   │   │   ├── anchoring.ts              # 时间锚点（几天前/上周）
│   │   │   └── recall-strategy.ts        # 加权随机（≥30% 名字引用）
│   │   ├── gift/
│   │   │   ├── daily-grant.ts            # 每日馈赠（物品池抽取）
│   │   │   ├── item-pool.ts              # 物品池（≥8 种、加权、排除近 3 次）
│   │   │   └── reply.ts                  # 回信生成（24h 内）
│   │   ├── packs/
│   │   │   ├── loader.ts                 # 素材包加载器
│   │   │   ├── manifest-schema.ts        # manifest.json zod schema
│   │   │   ├── resolver.ts               # 事件 → 插槽文案/图片解析
│   │   │   └── fallback.ts               # 损坏包回退默认
│   │   ├── announce/
│   │   │   ├── hub.ts                    # 公告中心（发/列/已读/静音）
│   │   │   └── backfill.ts               # 空窗期聚合回补
│   │   ├── export/
│   │   │   ├── exporter.ts               # 导出 v1 JSON + SHA256
│   │   │   ├── importer.ts               # 导入 + 版本校验
│   │   │   ├── schema.ts                 # 导出 JSON schema（versioned）
│   │   │   └── error-messages.ts         # 三类不同报错文案
│   │   ├── auth/
│   │   │   ├── magic-link.ts             # 邮箱验证码逻辑
│   │   │   ├── throttle.ts               # 节流（邮箱/IP 维度）
│   │   │   ├── token.ts                  # 30 天 token 签发/校验
│   │   │   └── audit.ts                  # 审计日志
│   │   ├── persistence/
│   │   │   ├── db.ts                     # MySQL 连接池 + async 事务工具
│   │   │   ├── migrations/
│   │   │   │   ├── 001_init.sql
│   │   │   │   └── ...
│   │   │   ├── repos/                    # 每个表一个 repo
│   │   │   │   ├── users.repo.ts
│   │   │   │   ├── pets.repo.ts
│   │   │   │   ├── events.repo.ts
│   │   │   │   ├── items.repo.ts
│   │   │   │   ├── inventory.repo.ts
│   │   │   │   ├── memories.repo.ts
│   │   │   │   ├── announcements.repo.ts
│   │   │   │   └── sessions.repo.ts
│   │   │   └── sql.ts                    # 类型安全的 query helper
│   │   └── types.ts                      # 领域实体统一类型（前端复用）
│   ├── ui/                              # React 组件（素材包可覆盖样式）
│   │   ├── pet-card.tsx
│   │   ├── event-card.tsx                # 记忆引用高亮
│   │   ├── timeline.tsx                  # 渐进披露入口
│   │   ├── letter-view.tsx               # 信纸
│   │   ├── gift-tray.tsx
│   │   ├── announcement-list.tsx
│   │   └── shared/
│   │       ├── button.tsx
│   │       ├── modal.tsx                 # 导出确认弹窗
│   │       └── theme-provider.tsx        # 注入素材包 CSS 变量
│   ├── hooks/
│   │   ├── use-token.ts
│   │   ├── use-pet.ts
│   │   ├── use-sync.ts                   # 前端触发同步（服务端内部补算）
│   │   └── use-pack.ts                   # 素材包状态
│   ├── config/
│   │   ├── env.ts                        # 环境变量校验（zod）
│   │   └── backoff-table.ts              # 退避间隔表（CONTEXT.md 表落地）
│   └── assets/
│       └── packs/
│           └── default/                  # 官方默认素材包
│               ├── manifest.json
│               ├── theme.css
│               ├── text/                 # 每个事件类型的文案（废话+诗意）
│               │   ├── outing.json
│               │   ├── watching-water.json
│               │   ├── reply-letter.json
│               │   └── ...
│               └── images/
│                   ├── home-bg.png
│                   ├── letter-bg.png
│                   └── icons/*.png
├── tests/
│   ├── unit/                             # Vitest（领域层）
│   │   ├── events-engine.test.ts
│   │   ├── catchup-planner.test.ts       # 覆盖 1/3/30 天
│   │   ├── backoff.test.ts
│   │   ├── memory-recall.test.ts         # ≥30% 名字引用
│   │   ├── export-import.test.ts         # 逐字段比对
│   │   └── throttle.test.ts
│   └── e2e/                              # Playwright（11 项验收）
│       ├── acceptance-01-login.spec.ts
│       ├── acceptance-03-event-engine.spec.ts
│       ├── acceptance-04-catchup-30d.spec.ts
│       └── ...
├── scripts/
│   ├── seed-default-pack.ts
│   ├── run-migrations.ts
│   ├── smoke-test.ts                     # 性能冒烟
│   └── backup.ts                         # 每日 mysqldump 备份
├── asset-packs/                          # 用户可放置的第三方素材包
│   └── (用户挂载或 git 子模块)
├── data/                                 # 运行时备份目录（mysqldump/JSON；gitignore）
├── docker/
│   ├── Dockerfile                        # output: standalone
│   └── entrypoint.sh
├── .github/
│   └── workflows/
│       ├── ci.yml                        # PR: 类型检查 + 单测 + E2E
│       └── release.yml                   # tag: 构建 + 发布
├── package.json
├── next.config.ts                        # output: standalone
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── README.md                             # 自托管部署文档
├── SELF_HOST.md                          # 自托管详细指南
├── LICENSE-CORE                          # 核心基座开源许可
└── LICENSE-VALUE                         # 增值服务许可（保留商业空间）
```

### 3.1 关键约束

- **`src/domain/**` 不 import `next/**`、`react/**`**（CI 用 eslint rule 强制）——保证领域层可独立单测。
- **`src/app/api/**` 只做三件事**：解析请求 → 调领域层 → 序列化响应。业务逻辑不写在 route handler。
- **`src/ui/**` 不直接调 MySQL、不写 SQL**——只能通过 `src/hooks/**` 或 fetch 走 API。
- **素材包目录结构变更必须走 `docs/packs-contract.md`**（阶段 5 产出）——这是插件契约的一部分。

---

## 4. 模块划分与职责

### 4.1 模块清单

| 模块 | 位置 | 核心职责 | 输入 | 输出 |
|------|------|----------|------|------|
| 认证 (auth) | `src/domain/auth/` | 邮箱验证码（hub-autonomous email，由本中心 SMTP 发送） + 30 天 token | 邮箱、验证码、请求 | 会话、节流结果 |
| Pet 状态机 (pet-fsm) | `src/domain/fsm/` | 在家/出门/旅行三态转换 | 事件、时间戳 | 新状态 |
| 事件引擎 (event-engine) | `src/domain/events/` | 按状态+记忆+时间生成事件结构 | pet 上下文 | Event 结构（无表现） |
| 补算 (catchup) | `src/domain/catchup/` | 一次同步内推进流逝时间、生成事件（≤20 + 聚合） | 上次活动 ts、当前 ts | 事件批次 |
| 退避调度 (backoff) | `src/domain/backoff/` | 按缺席时长决定 pet 主动触达间隔 | 用户缺席天数 | 间隔天数 |
| 记忆检索 (memory) | `src/domain/memory/` | 从记忆表检索引用素材，加权 ≥30% 名字 | 事件上下文 | 记忆引用候选 |
| 素材包 (packs) | `src/domain/packs/` | 加载 manifest、解析插槽、回退兜底 | 包路径 | 素材包对象 |
| 馈赠/回信 (gift) | `src/domain/gift/` | 每日首次登录抽物品、送赠、24h 内生成回信 | 用户动作、物品池 | 物品、回信事件 |
| 公告 (announce) | `src/domain/announce/` | 发公告、已读/未读、静音、倒序、空窗聚合 | 管理员指令、用户同步 | 公告列表 |
| 导出/导入 (export) | `src/domain/export/` | JSON 序列化 + SHA256 + 版本校验 + 三类报错 | pet 数据 | JSON 文件 / 恢复结果 |
| 持久化 (persistence) | `src/domain/persistence/` | MySQL 连接池、async 事务、repo、迁移 | SQL | 行/对象 |

### 4.2 依赖关系

```
                    ┌──────────┐
                    │  API 层  │
                    └────┬─────┘
                         │ 调用
                         ▼
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌────────┐      ┌──────────┐     ┌─────────┐
   │  auth  │      │  sync    │     │  其它   │
   └────┬───┘      └────┬─────┘     └────┬────┘
        │                │                │
        │   ┌────────────┼────────┐       │
        │   ▼            ▼        ▼       │
        │  [补算]    [事件引擎] [退避]     │
        │    │           │        │       │
        │    └───────┬───┘────────┘       │
        │            ▼                    │
        │       [状态机] [记忆检索]         │
        │                 │               │
        │                 ▼               │
        │           [素材包]               │
        │                                 │
        ▼                                 ▼
   ┌────────────  持久层（MySQL）  ◄─────────┐
   │              所有 repo 收敛于此           │
   └──────────────────────────────────────────┘
```

**方向规则**：
- 领域层模块之间**只有单向依赖**：`sync → catchup → event-engine → fsm/memory`；`gift → event-engine`；`announce → catchup.aggregator`。
- **不允许**：事件引擎 → 素材包、事件引擎 → API 层、persistence → 其它领域模块。
- 素材包只在两处被读取：① 服务端渲染时解析插槽（信件页 SSR）；② 前端注入 CSS 变量与图片资源。领域层不主动 import 素材包内容。

### 4.3 关键流程时序

#### 4.3.1 用户下次同步 → 服务端补算

```
用户浏览器                     Next.js API                  领域层                 MySQL
    │                            │                            │                     │
    │ GET /api/sync              │                            │                     │
    ├───────────────────────────►│                            │                     │
    │                            │ getPetContext(petId)       │                     │
    │                            ├───────────────────────────►│ read pets/           │
    │                            │                            ├────────────────────►│
    │                            │                            │◄────────────────────│
    │                            │                            │                     │
    │                            │ planCatchUp(pet, now-ts)   │                     │
    │                            ├───────────────────────────►│                     │
    │                            │                            │ 计算缺席天数         │
    │                            │                            │ 退避调度查表         │
    │                            │                            │ 生成补算计划         │
    │                            │                            │ (≤20 条 + 聚合)     │
    │                            │◄───────────────────────────┤                     │
    │                            │                            │                     │
    │                            │ executeCatchUp(plan)       │                     │
    │                            ├───────────────────────────►│ BEGIN TRANSACTION    │
    │                            │                            ├────────────────────►│
    │                            │                            │ 逐条 event-engine    │
    │                            │                            │ → fsm/memory → 写    │
    │                            │                            ├────────────────────►│
    │                            │                            │ COMMIT               │
    │                            │                            ├────────────────────►│
    │                            │◄───────────────────────────┤                     │
    │◄───────────────────────────┤  { events, newAggregate }  │                     │
    │                            │                            │                     │
    ▼  时间线首屏显示"过去 X 天"卡片；点击展开事件流
```

**关键不变式**：
- 补算整体在一个事务内完成。中途失败则整个 rollback，用户下次同步重试——不会出现"半份事件"。
- 补算计划是纯函数（`planCatchUp(pet, fromTs, toTs, rngSeed) → Plan`），可以被 Vitest 独立验证 1/3/30 天场景。
- 事务内写入顺序：先 fsm 状态推进，再 event 插入，再 update pets.last_activity_ts。

#### 4.3.2 每日馈赠闭环

```
Day N 首次登录 ─► GET /api/gift/daily ─► 物品池加权随机（排除近 3 次）
                                                    │
                                                    ▼
                                          写入 inventory + 每日馈赠事件
                                                    │
用户点"送给 pet" ─► POST /api/gift/offer ─► 校验日限一次 ─► 写储物罐 + 送赠事件
                                                    │
                                                    ▼
                                          设置 reply_pending=true, reply_due_at=now+24h
                                                    │
                          ┌─────────────────────────┤
                          │ 下次 sync 时检测 due      │
                          ▼                          ▼
                    若到期：event-engine 生成 reply-letter
                            （含 ≥1 条记忆引用）
```

#### 4.3.3 导出/导入

```
GET /api/export
  → 领域层导出：
    ├─ 组装 JSON（按 schema v1.0.0 字段清单）
    ├─ 计算 SHA256
    ├─ 写入 meta.schema_version = "1.0.0"
    ├─ 写入 meta.exported_from = hub_id
    └─ 写入 meta.exported_at = now
  → 前端下载

POST /api/import (multipart/form-data: file, password)
  → 领域层导入：
    ├─ 解析 JSON
    ├─ 校验 meta.schema_version → 不匹配返回 ERR_VERSION_MISMATCH
    ├─ 校验 SHA256 → 不匹配返回 ERR_CHECKSUM_MISMATCH
    ├─ 校验必填字段 → 缺失返回 ERR_FIELD_MISSING
    └─ BEGIN TRANSACTION → 逐表插入 → COMMIT
```

三类错误对应三种不同文案，见需求 §3.9、评审 P0-2。

---

## 5. 事件-素材契约（插件生态起点）

### 5.1 事件类型枚举（MVP 定稿）

```typescript
// src/domain/events/types.ts
export const EventType = {
  OUTING:             'outing',              // 外出散步
  WATCHING_WATER:     'watching_water',      // 看水
  COUNTING_LEAVES:    'counting_leaves',     // 数叶子
  SELF_TALK:          'self_talk',           // 自言自语
  BROUGHT_ITEM:       'brought_item',        // 带回物品
  REPLY_LETTER:       'reply_letter',        // 馈赠回信
  SPONTANEOUS_LETTER: 'spontaneous_letter',  // 自主冒信
  AGGREGATE_SUMMARY:  'aggregate_summary',   // 聚合摘要
  SYSTEM_ANNOUNCE:    'system_announce',     // 系统公告（内嵌时间线）
  DAILY_GRANT:        'daily_grant',         // 每日馈赠事件
  OFFER_RECEIVED:     'offer_received'       // 送赠接收事件
} as const;

export type EventTypeValue = typeof EventType[keyof typeof EventType];
```

### 5.2 Event 结构（引擎产出，不含表现）

```typescript
export interface EventStructure {
  id: string;                          // ULID，时序天然
  pet_id: string;
  type: EventTypeValue;

  // 引擎语义字段（不含任何文案）
  ts: number;                          // 事件发生时间戳（ms）
  fsm_state: 'at_home' | 'out_walking' | 'on_trip';
  params: Record<string, unknown>;     // 事件类型专属参数，见 §5.3
  memory_refs: MemoryRef[];            // 引擎检索到的记忆引用（结构化）

  // 溯源
  source: 'engine' | 'catchup' | 'gift' | 'system' | 'admin';
  engine_version: string;              // 事件引擎版本
  pack_schema_version: string;         // 素材包契约版本（前端解析用）

  // 数据主权
  schema_version: '1.0.0';             // 事件 schema 版本
  hub_id: string;                      // 生成来源中心标识
}

export interface MemoryRef {
  kind: 'pet_name' | 'item_name' | 'time_anchor' | 'place';
  value: string;                       // e.g. "小圆", "浆果", "3 天前"
  weight: number;                      // 加权随机权重
  source_event_id?: string;            // 若引用某历史事件
}
```

**约束**：`EventStructure.params` 中**永远不出现文案字符串**。文案只存在于素材包中，通过插槽引用。

### 5.3 每种事件类型的 params schema

| 类型 | params 字段 | 说明 |
|------|------------|------|
| `outing` | `destination: string`, `duration_hours: number` | 目的地由素材包提供候选，引擎选 |
| `watching_water` | `place: string`, `duration_minutes: number` | |
| `counting_leaves` | `count: number` | 数了几片 |
| `self_talk` | `mood: 'calm'\|'curious'\|'nostalgic'` | 情绪标签（不影响文案） |
| `brought_item` | `item_id: string` | 引用 items 表 |
| `reply_letter` | `gift_event_id: string` | 关联哪次送赠 |
| `spontaneous_letter` | `trigger: 'dream'\|'moonlight'\|'silence'` | 触发线索（不写入展示） |
| `aggregate_summary` | `span_days: number`, `items_collected: {type:string, count:number}[]`, `outings: number`, `travel_nights: number` | 聚合结构化数据 |
| `system_announce` | `announcement_id: string` | 引用 announcements 表 |
| `daily_grant` | `item_id: string` | |
| `offer_received` | `item_id: string`, `offer_event_id: string` | |

### 5.4 素材插槽（packs 提供）

每个事件类型在素材包中对应一个 JSON 文件，声明需要的插槽：

```json
{
  "type": "reply_letter",
  "slots": {
    "title":      { "mode": "fixed",     "default": "给 {pet_name} 的一封信" },
    "body":       { "mode": "template",  "variants": {
      "daily":  ["今天收到 {item}，{recall_line}", "..."],
      "poetic": ["{pet_name}，你送来的 {item}，让我想起了 {recall_line}"]
    }, "poetic_ratio": 0.10 },
    "sign_off":   { "mode": "template",  "variants": ["— {pet_name}", "—— {pet_name}"] }
  },
  "assets": {
    "letter_bg":  { "path": "images/letter-bg.png" },
    "icon":       { "path": "icons/reply.png" }
  },
  "highlight": {
    "memory_refs": true,       // 引擎给的 memory_refs 需要在正文中高亮
    "anchor_style": "underline"
  },
  "recall_required": ["item_name", "pet_name", "time_anchor"],
  "recall_min_count": 1
}
```

**关键约定**：
- `{pet_name}` / `{item}` / `{recall_line}` / `{count}` 等 placeholder 由素材包声明，由事件引擎注入实际值。
- `poetic_ratio` 是"日常废话 vs 偶尔诗意"的比例（需求 §3.3，约 1/10）。
- `recall_required` + `recall_min_count` 是**契约层强制的记忆引用要求**——素材包声明本类型必须引用哪类记忆，事件引擎必须保证至少 1 条。
- `highlight.memory_refs=true` 告诉前端在渲染时把 `memory_refs` 值包上 `<span data-mem>`，前端用 CSS 变量上色（需求 §3.5、验收 5 的记忆引用高亮）。

### 5.5 契约演进规则

- `pack_schema_version` 独立于 `schema_version`。前者随素材包契约变，后者随事件结构变。
- 每次事件类型新增必须：① 更新 `types.ts` 枚举；② 更新 §5.3 表；③ 在 `docs/packs-contract.md` 补契约说明；④ 默认素材包补一个 JSON；⑤ 写一个 Vitest 单测。
- 素材包作者**不需要读 TS 代码**——只需读 `docs/packs-contract.md` + 示例 JSON 就能创作。

---

## 6. 素材包加载机制

### 6.1 目录结构（MVP 定稿，未来公开为规范）

```
asset-packs/<pack-name>/
├── manifest.json                    # 必需
├── theme.css                        # CSS 变量（颜色、字体、间距）
├── text/
│   ├── outing.json                  # 每个事件类型一个 JSON
│   ├── reply-letter.json
│   └── ...
├── images/
│   ├── home-bg.png
│   ├── letter-bg.png
│   └── icons/*.png
└── README.md                        # 作者说明（可选）
```

### 6.2 manifest.json 格式

```json
{
  "name": "default",
  "display_name": "官方默认（手绘暖调）",
  "version": "1.0.0",
  "pack_schema_version": "1.0.0",
  "min_engine_version": "1.0.0",
  "author": "AetherPet core team",
  "license": "MIT",
  "theme": {
    "css": "theme.css",
    "palette": {
      "primary":    "#e8a87c",
      "accent":     "#85c485",
      "memory_ref": "#d4b483",
      "paper":      "#f6efe4",
      "ink":        "#3d2f23"
    }
  },
  "assets": {
    "home_bg": "images/home-bg.png",
    "letter_bg": "images/letter-bg.png"
  },
  "texts": {
    "outing": "text/outing.json",
    "watching_water": "text/watching-water.json",
    "counting_leaves": "text/counting-leaves.json",
    "self_talk": "text/self-talk.json",
    "brought_item": "text/brought-item.json",
    "reply_letter": "text/reply-letter.json",
    "spontaneous_letter": "text/spontaneous-letter.json",
    "aggregate_summary": "text/aggregate-summary.json",
    "system_announce": "text/system-announce.json",
    "daily_grant": "text/daily-grant.json",
    "offer_received": "text/offer-received.json"
  },
  "fallback": null
}
```

### 6.3 加载流程

```
服务启动
  │
  ▼
读取 ASSET_PACKS_DIR 下所有 manifest.json
  │
  ▼
用 manifest-schema.ts (zod) 校验：
  ├─ 缺失字段 → 跳过该包，日志警告
  ├─ pack_schema_version 与当前引擎不兼容 → 跳过
  └─ 全部通过 → 加入可用列表

默认选择 manifest.name === 'default' 或 config.DEFAULT_PACK
  │
  ▼
前端 request /api/packs → 拿到当前生效 pack manifest
  │
  ▼
SSR 时注入 <link rel="stylesheet" href="/_assets/packs/default/theme.css">
  │
  ▼
用户点"切换素材包"（开发者模式） → POST /api/packs/activate
  │
  ▼
服务端重加载，重新走校验；失败则保持当前包 + 返回错误文案
```

### 6.4 损坏包回退

- 加载失败（文件缺失、JSON 解析错误、schema 校验失败）→ 记录错误、跳过该包、继续使用当前生效包。
- 若当前生效包本身损坏 → 强制回退到 `default` 包。
- 若连 `default` 也损坏 → 前端展示"素材加载失败"文案，事件流降级为纯文本模式（用 `text/plain` 的兜底文案）。
- 所有加载错误写入 `audit_log` 表，方便自托管管理员排查。

### 6.5 未来扩展为插件规范的预留

- MVP 的素材包契约与未来插件契约**共用 `manifest.json` 结构**。
- 未来插件（Live2D、AI 对话、明信片）会在 manifest 中新增 `plugin.kind` 字段（`pack` | `live2d` | `ai_chat` | `postcard` | ...），MVP 只允许 `pack`。
- 插件生态启动时，`docs/packs-contract.md` 会扩展为 `docs/plugin-contract.md`，向后兼容。

---

## 7. 可扩展性预留

### 7.1 多服务中心与数据迁移（v2 需求，MVP 预留）

**MVP 必须做的**：
- 每张表都有 `hub_id` 字段（`string`, NOT NULL, DEFAULT `local`）——标识该行数据归属的中心。
- 每张表都有 `schema_version` 字段（`string`）——允许未来"同一中心内 schema 演进"。
- 导出 JSON 强制带 `meta.schema_version` + `meta.exported_from (hub_id)` + `meta.checksum`。
- 事件结构中的 `hub_id` 是**事件的出生中心**，用于未来跨中心合并时溯源。

**MVP 不做但代码要留位子的**：
- 导入时**接收任意 `exported_from` 的值**（不仅校验本地），只是"导入到当前中心"时改写 `hub_id` 为本地。
- 不实现联邦广播协议，但公告表预留 `source_hub_id`、`signed_by`、`signature` 字段（MVP 写本地、留空签名）。

### 7.2 货币与市场（v2 需求，MVP 预留）

**不建表，但预留字段**：
- `items` 表新增 `base_price_cents` (INT, DEFAULT NULL)、`currency_code` (VARCHAR, DEFAULT NULL)——MVP 恒为 NULL，v2 货币上线时非空。
- `pets` 表新增 `wallet_ref` (VARCHAR, DEFAULT NULL)——MVP 恒为 NULL，v2 指向 `wallets` 表。
- 需求 §3.7 的"每日馈赠"未来变成"每日馈赠 + 货币奖励"共存时，只新增 `daily_currency_grant` 事件类型，不动现有表。

**为什么现在不建 `wallets` 表**：
- 需求 §4 明确"不实现"，建空表反而增加迁移成本。
- 通过 nullable 字段预留，v2 上线时新增 `wallets` 表 + migration 更清爽。

### 7.3 插件市场（v2/v3 需求）

**MVP 预留**：
- `manifest.json` 的 `license` 字段允许任意字符串（未来支持"商用"/"付费"标签）。
- `packs/` 加载器支持"多来源扫描"（`asset-packs/local/` + `asset-packs/market/` 两个路径），MVP 只填 `local/`。
- 未来插件市场上线时，服务端新增 `marketplace` 目录，通过 git submodule 或 API 拉取，`asset-packs/market/<plugin-name>` 与 `local` 平级。

### 7.4 P2P 组网（远期）

- 数据模型层的 `hub_id` 字段就是节点标识，与 Mastodon 的 `domain` 同构。
- 公告表结构预留 `signature` 字段，未来用 Ed25519 签名做可信广播。
- **架构上明确不做**：MVP 的事件引擎、补算、素材包解析都是**单中心内部逻辑**，不与"其它 pet 节点"通信。这是隐居模式的技术落地。

### 7.5 Live2D / AI 对话 / 明信片（插件形态）

- 三者都通过插件 manifest 扩展点接入：
  - Live2D：`plugin.kind = 'live2d'`，暴露 `pet_avatar` 插槽，前端渲染层可选用。
  - AI 对话：`plugin.kind = 'ai_chat'`，暴露 `dialogue_generate` 服务钩子，事件引擎回信时可以选"模板"或"AI"两条路径。
  - 明信片：`plugin.kind = 'postcard'`，暴露 `image_generate` 服务钩子，`brought_item` 事件带出图片。
- MVP 事件引擎**不主动 import 任何插件**——插件通过"实现约定接口 + 注册到扩展点"接入，与素材包机制同构。

---

## 8. 数据流总览

```
用户动作          ─────────────────────────── 服务端处理 ───────────────────────── 落库
─────────────        ───────────────────────                  ─────────────────────

[发验证码]     →    /auth/request-code      →  节流检查 → 生成 code → 写 verification_codes
[输验证码]      →    /auth/verify            →  校验 code → 创建/取回 user → 签 30 天 token → 写 sessions
[同步]         →    /sync                   →  BEGIN tx →
                                                ├─ 计算流逝时间
                                                ├─ planCatchUp (纯函数)
                                                ├─ 逐条生成 event（engine+fsm+memory）
                                                ├─ 插 events 表
                                                ├─ 更新 pets.last_activity_ts
                                                ├─ 检查 reply_pending → 到期则生成回信
                                                ├─ 检查 daily_grant 是否触发
                                                └─ COMMIT
                                             →  返回 { events, aggregate }
[首次登录]     →    /gift/daily             →  物品池抽取 → 写 inventory + events(daily_grant)
[送赠]         →    /gift/offer             →  校验日限一次 → 写 events(offer_received) + 设置 reply_due_at
[读公告]       →    /announcements          →  按时间倒序 → 更新已读
[导出]         →    /export                 →  组装 JSON → SHA256 → 返回
[导入]         →    /import                 →  校验版本/校验和 → BEGIN tx → 逐表插入 → COMMIT
```

---

## 9. 技术风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | **事件契约与素材包契约演进失控**：MVP 之后事件类型/插槽频繁变更，导致第三方素材包频繁失效 | 共创开发者体验崩塌 | 契约文件独立版本化（`pack_schema_version` + `event.schema_version` 分离）；契约变更走 `docs/packs-contract.md`；每次变更附迁移脚本示例；语义化版本 |
| R2 | **MySQL 连接池耗尽 / 事务内长持连接**：多用户同时触发补算时，async 事务若未及时释放连接会占满池子 | 高峰期补算排队，"秒级完成"目标失守 | 单中心场景下 MVP 用户量假设 <10k；连接池 `poolSize=10`、`connectionLimit=20`、`waitForConnections=true`、`queueLimit=100`；补算事务设计得短（≤200ms）；事务内不 sleep 不跨 await 外部 IO；监控 `pool.allConnections` 活跃连接数、事务耗时，>1s 报警；开启 InnoDB `innodb_lock_wait_timeout=5s` 避免死锁 |
| R3 | **补算 30 天场景性能**：即使 ≤20 条事件 + 1 条聚合，涉及状态推进 + 记忆检索 + 多次写入 | 补算超时 | planCatchUp 是纯函数，事务内只做 IO；记忆检索批量预取（一次 SELECT 而不是 N 次）；Vitest 单测固化 30 天场景 ≤100ms |
| R4 | **素材包损坏导致全站崩**：默认包被误删、用户激活了非法包 | 无法登录/无视觉 | 三层回退：损坏包跳过 → 强制回退 default → 纯文本降级；启动时预校验；管理员后台能看到加载状态 |
| R5 | **无密码登录被盗风险**：邮箱被黑，token 被盗 | pet 数据被劫持 | 30 天 token 支持"退出登录"（撤销所有会话）；验证码节流（邮箱 5min/3 次 + IP 全局）；申诉机制通过"导出备份 hash"自证身份；审计日志覆盖验证码尝试、token 撤销 |
| R6 | **导出/导入 schema 破坏兼容性**：v2 上线时字段变更导致旧导入失败 | 数据主权承诺失信 | schema_version 强制字段；导入时校验版本 + 校验和 + 字段清单；三类不同报错；未来版本升级写明确的 migration 说明 |
| R7 | **记忆引用检索质量达不到 30% 名字概率** | 验收 3 失败 | 检索策略是加权随机的纯函数，Vitest 用固定 seed 抽样 1000 次事件验证达标；权重可配置在 `config/memory-weights.ts`；不达标就调权重，不改算法 |
| R8 | **自托管部署复杂**：Next.js standalone + MySQL + SMTP + Apache 反向代理 + PM2，链路比原 SQLite 版长 | 自托管采纳率低 | `SELF_HOST.md` 覆盖两种部署路径：（a）宝塔面板：Apache 反代 + MySQL 实例 + PM2 常驻 Node 进程，（b）Docker Compose：`app` + `mysql` 两容器；环境变量走 zod 校验，缺失给出明确报错；README 覆盖从 0 到 1 全流程；`scripts/smoke-test.ts` 冒烟 MySQL 连通性 |
| R9 | **性能冒烟失败**：<3s 首屏或补算秒级未达成 | 验收 9 失败 | 首屏 SSR + 静态资源缓存 + 图片 WebP + 素材包懒加载；补算事务设计见 R3；`scripts/smoke-test.ts` 每次 CI 跑 |
| R10 | **领域层被 Next.js 依赖污染**：工程师图方便在 domain 里 import `NextRequest` | 单测跑不通，架构崩溃 | ESLint rule：`src/domain/**` 禁止 import `next/**`、`@next/**`、`react/**`；CI 强制失败 |

---

## 10. 部署形态

> v1.1 修订：不再以 SQLite 文件卷作为主要部署形态；开发/生产同构为 MySQL。

### 10.1 开发环境（本地）

- `docker compose up mysql` 启动本地 MySQL 8（与生产同构，避免方言差异）。
- Next.js 默认 `output: 'standalone'`；开发时 `npm run dev`。
- `.env` 提供默认连接参数（`DB_HOST=localhost`、`DB_PORT=3306`、`DB_USER=aetherpet`、`DB_PASS=***`、`DB_NAME=aetherpet`）。
- CI 中的 E2E 同样跑在临时 MySQL 容器里，不用 SQLite 降级。

### 10.2 官方托管中心（宝塔生产环境）

- 由 AetherPet 项目方运维一台或多台服务器，用户"打开即用"。
- **部署方式**：Next.js `output: standalone` → Node 进程由 **PM2** 常驻运行 → **Apache 反向代理**（宝塔面板配置：域名 + 证书 + proxy_pass 到 `127.0.0.1:3000`）。
- **数据库**：宝塔 MySQL 实例（MySQL 8.x，InnoDB，utf8mb4）。数据库连接走 `mysql2` 连接池。
- **备份**：宝塔面板自带 MySQL 备份任务（每日 mysqldump，保留 7 天）+ `scripts/backup.ts` 额外导出 JSON（跨中心迁移用）。**不再依赖 SQLite 文件卷**。
- **邮件**：按 §2.7 中心自治 SMTP，官方中心用官方 SMTP。

### 10.3 自托管

- 提供两种部署路径，写进 `SELF_HOST.md`：
  - **（a）宝塔面板路径**：Apache 反代 + 宝塔 MySQL 实例 + PM2 常驻 Node 进程。官方提供 `pm2-ecosystem.config.js`。
  - **（b）Docker Compose 路径**：`docker compose up` 起 `app` + `mysql` 两容器（Node 20-alpine + MySQL 8），供不用宝塔的用户使用。
- 环境变量走 zod 校验，缺失给出明确报错（含 SMTP/DB 全部字段）。
- 自托管中心**独立**，用户数据留在本地，官方看不到。

### 10.4 未来 v2

- 官方可多中心（多区域部署），每个中心独立 `hub_id`。
- 自托管可选择"联邦广播"接收官方公告，也可完全离线（MVP 已预留公告表签名字段）。

---

## 11. 交付给软件工程师的执行顺序（对齐 dev-stage-plan.md）

**详见 `docs/dev-stage-plan.md`**。此文件定义"每阶段做什么、依赖什么、如何验收"，本文档定义"整体架构长什么样、契约与选型"。两者配合执行。

**关键路径**：
1. 阶段 1（地基 + 认证）必须最先完成——所有后续模块依赖 token 校验、MySQL migration（`001_init.sql`）、素材包加载、SMTP 配置加载。
2. 阶段 2（pet 状态机 + 事件引擎）是产品灵魂——契约在此阶段定稿，不允许后续阶段"改契约"（改了要更新 `docs/packs-contract.md`）。
3. 阶段 3（补算 + 退避）依赖阶段 2 的事件引擎。
4. 阶段 4（馈赠/回信）依赖阶段 2 的事件引擎 + 阶段 3 的补算（回信触发靠 sync 检测 reply_due_at）。
5. 阶段 5（公告 + 档案）可与阶段 4 并行。
6. 阶段 6（导出/导入 + 部署）最后——因为它依赖所有前面模块的数据模型稳定。

---

## 12. 附录

### 12.1 与需求文档的可追溯映射

| 需求 § | 本文档 § | 备注 |
|--------|----------|------|
| 3.1 账号体系 | §4.1 auth 模块, §9 R5 | |
| 3.2 pet 状态机 | §4.1 pet-fsm, §5.2 fsm_state | |
| 3.3 事件引擎 | §4.1 event-engine, §5 契约 | |
| 3.4 补算 | §4.3.1, §4.1 catchup, §9 R3 | |
| 3.5 事件流 | §5.4 highlight, §4.3.1 渐进披露 | |
| 3.6 档案页 | §4.3 数据流, §11 阶段 5 | |
| 3.7 每日馈赠 | §4.3.2, §4.1 gift | |
| 3.8 公告 | §4.1 announce | |
| 3.9 导出/导入 | §4.3.3, §4.1 export | |
| 3.10 素材包 | §6 全文 | |
| 3.11 事件-素材契约 | §5 全文 | |
| 3.12 部署 | §10 | |
| 3.13 邮件推送 | §2.7, §9 R5 审计日志 | |

### 12.2 术语对齐（与 CONTEXT.md 保持一致）

- 本文件使用"服务中心 / service hub"，不使用"服务器"。
- 本文件使用"隐居模式 / hermit mode"，不使用"单机"。
- 本文件使用"补算 / catch-up simulation"，不使用"回放"。
- 本文件使用"退避间隔 / backoff interval"，不使用"冷却"。
- 本文件使用"素材包 / pack"，不使用"主题"或"皮肤"。

### 12.3 未在本文件覆盖的话题

- 具体 SQL DDL → `docs/database-schema.md`
- 每阶段验收、工时估算 → `docs/dev-stage-plan.md`
- 素材包契约的详细规范 → 阶段 5 产出 `docs/packs-contract.md`（本文件 §6 是骨架）
- 前端视觉规范 → 由素材包提供，MVP 官方默认包在阶段 1 交付

---

*本文档定稿于 2026-09-09。任何契约变更必须同时更新本文件与 `docs/packs-contract.md`，并同步 bump 语义化版本。*
