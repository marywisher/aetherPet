# aetherPet MVP · 开发阶段计划

> 状态：定稿，与 `docs/architecture.md`、`docs/database-schema.md` 同步
> 划分原则：**每阶段是"可独立演示验证"的最小闭环**；本阶段本身是下一阶段的细化（MVP 增量思想）
> 阶段数：**6 个阶段**，建议按序执行，阶段 4/5 可小并行

> **修订版本 v1.1（2026-09-09）**：
> - **数据库改为 MySQL 8.x**：阶段 1 的基础设施新增 Docker MySQL 容器；migration 与连接池适配 `mysql2`；补算事务改为 async。
> - **阶段 1 交付新增：SMTP 配置加载 + hub-autonomous email 邮件模板**（带中心身份标识字段）。
> - **阶段 6 部署改为**：宝塔 Apache 反向代理 + PM2 Node 进程 + MySQL 实例（不再使用 Docker K8s pod + SQLite 文件卷）。
> - **备份机制改为** mysqldump 或 JSON 导出（不再使用 SQLite `.backup`）。
> - **不变**：阶段划分（6 阶段）、工时估算、验收矩阵、关键路径（阶段 2 契约定稿）、并行建议（4/5 并行）。

---

## 0. 阶段划分总原则

1. **每阶段结束时都能跑一次完整演示**——不是"代码写完了"，是"打开浏览器能看到效果"。
2. **契约先行**：事件契约、素材包 manifest、导出 JSON schema 在阶段 2 定稿，不允许后续阶段偷偷改。
3. **验收项分布**：需求 §6 的 11 项验收在阶段 1–6 全覆盖，每阶段交付时对齐对应验收。
4. **领域层优先**：任何阶段都先写纯 TS 的领域层单测，再写 API/UI。
5. **不追求并行度**：单人 or 双人执行都合适；阶段 4/5 若有多人可并行。

### 11 项验收的阶段分布

| # | 验收项 | 主要阶段 | 相关补充阶段 |
|---|--------|----------|--------------|
| 1 | 注册登录（含安全边界） | 阶段 1 | |
| 2 | 档案页 | 阶段 5 | |
| 3 | 随机事件引擎（含记忆引用） | 阶段 2 | 阶段 3（补算中的记忆引用） |
| 4 | 补算（含极端场景） | 阶段 3 | |
| 5 | 事件流 | 阶段 3 | 阶段 5（档案页里的历史） |
| 6 | 公告 | 阶段 5 | |
| 7 | 数据导出/导入 | 阶段 6 | |
| 8 | 素材包可配置性 | 阶段 1（加载）+ 阶段 2（渲染）+ 阶段 6（切换验证） | |
| 9 | 部署 + 性能 | 阶段 6 | 每阶段做性能冒烟 |
| 10 | 每日馈赠闭环（含退避） | 阶段 4 | 退避表在阶段 3 定义 |
| 11 | 账号安全与恢复 | 阶段 1（节流/退出）+ 阶段 6（申诉备份 hash） | |

---

## 1. 阶段概览

| 阶段 | 名称 | 核心目标 | 依赖 | 建议工时 |
|------|------|----------|------|----------|
| 1 | **地基 + 认证 + 素材包加载** | 服务能启动、账号能登录、素材包能加载 | 无 | 5–7 天 |
| 2 | **pet 状态机 + 事件引擎 + 契约定稿** | 事件引擎跑通、契约冻结 | 阶段 1 | 6–8 天 |
| 3 | **补算 + 退避 + 事件流 UI** | 打开就能看到 pet 在"过日子"，30 天补算达标 | 阶段 2 | 5–7 天 |
| 4 | **每日馈赠 + 回信** | 每日闭环跑通，含退避 | 阶段 3 | 4–5 天 |
| 5 | **公告 + 档案页** | 补齐档案与运营通道 | 阶段 3（可与阶段 4 并行） | 3–4 天 |
| 6 | **导出/导入 + 部署 + 性能冒烟** | 数据主权闭环、可发布 | 阶段 1–5 全部 | 5–7 天 |

**总计：28–38 天**（单人估算；两人并行可压到 20–25 天）。

---

## 2. 阶段依赖图

```
阶段 1 (地基)
   │
   ▼
阶段 2 (事件引擎 + 契约定稿)
   │
   ▼
阶段 3 (补算 + 退避 + 时间线 UI) ───┬───► 阶段 4 (每日馈赠 + 回信) ─┐
                                     │                              │
                                     └───► 阶段 5 (公告 + 档案) ────┤
                                                                     │
                                                                     ▼
                                                        阶段 6 (导出/导入 + 部署)
```

- **阶段 4 与阶段 5 可并行**：分别覆盖不同 API 与页面，共享的只有领域层的事件引擎与持久层。
- **阶段 6 必须最后**：导出/导入覆盖全部数据模型，部署与性能冒烟覆盖全部功能。

---

## 3. 阶段详细设计

### 阶段 1：地基 + 认证 + 素材包加载

**目标**：把项目的骨架立起来，能启动、能登录、能看到第一屏、能加载素材包。

#### 包含模块

- **基础设施**：Next.js 项目初始化、TypeScript 配置、ESLint、Zod、Tailwind、Vitest、Playwright。
- **开发数据库**：本地 Docker MySQL 8（`docker compose up mysql`），与生产同构；`.env.example` 提供默认连接参数。
- **持久层基础**：`mysql2` 连接池、**async 事务工具**（`src/domain/persistence/db.ts`）、migration 框架、`meta` 表 + `migrations` 表初始化、所有表建齐（引用 `docs/database-schema.md`）。
- **认证模块**（`src/domain/auth/`）：
  - 邮箱验证码签发/校验（`magic-link.ts`）
  - **SMTP 配置加载（v1.1 新增）**：从 `.env` 读取 `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` / `HUB_ADMIN_EMAIL` / `HUB_PRIVACY_URL`，同时把 `hub_id` + `hub_display_name` 写入 `meta` 表
  - **邮件模板带中心身份标识（v1.1 新增）**：验证码邮件 Header `X-Aetherpet-Hub: <hub_id>`；正文抬头显示中心名称；尾部链接到隐私承诺页 + 管理员邮箱
  - 节流（`throttle.ts`）：同邮箱 5min 限 3 次 + IP 全局限流
  - 30 天 token 签发/校验（`token.ts`）
  - 审计日志（`audit.ts`，含 `email_sent` 事件类型）
- **API 层（阶段 1 部分）**：
  - `POST /api/auth/request-code`
  - `POST /api/auth/verify`
  - `POST /api/auth/logout`
  - `GET /api/packs`（列出可用素材包）
- **素材包加载**（`src/domain/packs/`）：
  - `manifest-schema.ts`（zod schema）
  - `loader.ts`（扫描 + 校验）
  - `fallback.ts`（损坏包回退）
- **前端骨架**：
  - 登录页、创建 pet 页（命名 UI）
  - 首页（登录后跳转，展示 pet 名字 + 状态 + "素材加载中"占位）
  - CSS 变量注入（`ThemeProvider`）
- **官方默认素材包**（`src/assets/packs/default/`）：
  - manifest.json、theme.css、home-bg.png、letter-bg.png、图标集
  - 每个事件类型的 JSON 文件（内容可以先放占位符文案，阶段 2 补完）
- **健康检查**：`GET /api/healthz`（含 MySQL 连通性探测 + SMTP 配置有效性检查）

#### 阶段演示

1. 打开 http://localhost:3000，看到登录页。
2. 输入邮箱 → 点"发送验证码" → 邮箱收到（或 console.log 验证码，开发模式）→ 邮件正文带中心身份标识（当前 hub_id + 中心名 + 隐私承诺页）。
3. 输入验证码 → 跳转到"给你的伙伴起个名字"页 → 起名 "小圆" → 跳转首页。
4. 首页显示 "小圆 · 在家"（状态占位）+ 使用默认素材包的背景。
5. 浏览器开发者工具能切换到"另一套素材包"（阶段 1 只需能列出一个备用测试包，切换逻辑完整实现；备用包在阶段 6 验收 8 时使用）。
6. 点"退出登录" → 跳回登录页 → 再次登录需重新输验证码。

#### 阶段验收要点（对应 11 项验收）

- **验收 1（注册登录）**：全部达标——验证码 10min 过期、同邮箱 5min/3 次节流、token 30 天有效、退出登录可用。
- **验收 8（素材包可配置性）**：素材包加载 + 损坏回退在阶段 1 达标；"切换另一套包"的可视化变化留到阶段 6 完整验证。
- **验收 11（账号安全与恢复）**：验证码节流、token 过期登出达标；申诉入口留到阶段 6。

#### 关键交付物

- `src/domain/auth/**`（含单测覆盖节流、token 过期、验证码过期、**SMTP 配置加载 + 邮件模板中心身份字段**）
- `src/domain/packs/**`（含单测覆盖 manifest 校验、损坏回退）
- `src/domain/persistence/migrations/001_init.sql`（MySQL 8 方言）
- `src/domain/persistence/db.ts`（mysql2 连接池 + async 事务）
- `docker-compose.dev.yml`（本地 MySQL 8）
- `src/app/api/auth/**`, `src/app/api/packs/route.ts`
- `src/app/login/**`, `src/app/create-pet/**`, `src/app/page.tsx`
- `src/assets/packs/default/**`
- `SELF_HOST.md` 初稿（阶段 6 完善，包含 SMTP/DB 环境变量清单）
- **性能冒烟**：首屏加载 < 3s（在本地 Node 20 + Docker MySQL + 默认配置下）

#### 工时估算

| 任务 | 人日 |
|------|------|
| Next.js 初始化 + 类型配置 + ESLint | 0.5 |
| Docker MySQL + mysql2 连接池 + async 事务封装 | 0.5 |
| MySQL migration 框架 + 001_init.sql | 1.0 |
| 认证模块 + 单测（含 SMTP 配置 + 邮件模板中心身份） | 1.5 |
| 素材包加载器 + 单测 | 1.0 |
| 前端页面（登录/创建 pet/首页） | 1.0 |
| 默认素材包（manifest + 少量图片 + 占位文案） | 1.0 |
| 集成联调 + 演示 | 0.5 |
| **小计** | **7.0 天** |

---

### 阶段 2：pet 状态机 + 事件引擎 + 契约定稿

**目标**：让 pet 能"活起来"——事件引擎跑通、状态机能推进、事件-素材契约在此阶段冻结。

#### 包含模块

- **Pet 状态机**（`src/domain/fsm/pet-fsm.ts`）：
  - 三态：`at_home` / `out_walking` / `on_trip`
  - 转换规则：出门事件 → `out_walking`；回来事件 → `at_home`；旅行事件（未来）→ `on_trip`
  - 纯函数 + 单测覆盖所有转换
- **事件引擎**（`src/domain/events/`）：
  - `engine.ts`（主入口，按 pet 状态 + 时间 + 记忆生成事件）
  - `types.ts`（EventType 枚举、EventStructure schema）
  - `generators/*.ts`（9 种事件生成器：outing, watching_water, counting_leaves, self_talk, brought_item, reply_letter, spontaneous_letter, aggregate_summary, system_announce；再加 daily_grant, offer_received）
  - `templates.ts`（模板注册表）
- **记忆检索**（`src/domain/memory/`）：
  - `index.ts`（从 memories 表检索候选）
  - `recall-strategy.ts`（加权随机，≥30% 概率带 pet 名字）
  - `anchoring.ts`（"几天前"/"上周"时间锚点表达）
  - 单测覆盖：1000 次采样下名字引用率 ≥30%
- **契约定稿**（关键决策）：
  - 冻结 `EventStructure` TS 接口
  - 冻结 `pack_schema_version = "1.0.0"`
  - 冻结 `docs/packs-contract.md`（本阶段产出，包含：目录结构、manifest 格式、每种事件类型的插槽契约、placeholder 命名规范、记忆引用位规则）
  - **契约冻结后不再改**（除非紧急修复，需明确 bump 版本号）
- **素材包完整文案**（阶段 1 是占位，阶段 2 补齐）：
  - 每种事件类型的"日常废话"和"诗意"两档文案（按 9:1 比例）
  - 每个占位符（`{pet_name}`, `{item}`, `{count}`, `{recall_line}`...）都有真实示例
- **服务端渲染**（阶段 1 是占位，阶段 2 让事件在首页显示）：
  - 首次登录时，引擎预生成 1–3 条初始事件（让时间线首屏不为空）
  - 前端能渲染事件卡片（含记忆引用高亮样式）

#### 阶段演示

1. 登录后新建 pet "小圆"。
2. 首页显示"小圆正在家"，下方时间线有 1–3 条初始事件（如"自言自语：今天天气很好，小圆想出去走走"）。
3. 手动触发一次"生成事件"（开发工具按钮），能看到事件生成并插入时间线。
4. 抽样 100 条生成事件，统计 ≥30% 自然带出 "小圆" 名字——单测通过。
5. `docs/packs-contract.md` 已产出，可供插件作者参考。

#### 阶段验收要点（对应 11 项验收）

- **验收 3（随机事件引擎）**：全部达标——低频随机产生、文案 ≥30% 带名字、记忆引用正确率达标。
- **验收 8（素材包可配置性）**：契约已冻结，插件作者能读懂 `docs/packs-contract.md`。

#### 关键交付物

- `src/domain/fsm/**`（含单测）
- `src/domain/events/**`（含单测覆盖每种事件类型）
- `src/domain/memory/**`（含单测覆盖 ≥30% 名字引用、时间锚点）
- `docs/packs-contract.md`（**契约冻结**）
- `src/assets/packs/default/text/*.json`（完整文案）
- 事件卡片 UI 组件（`src/ui/event-card.tsx`）
- `POST /api/pet/generate-event`（开发用，仅开发模式开放）

#### 工时估算

| 任务 | 人日 |
|------|------|
| Pet 状态机 + 单测 | 0.5 |
| 事件引擎核心（engine.ts） | 1.0 |
| 9+2 个事件生成器 | 2.0 |
| 记忆检索 + 加权随机 + 时间锚点 + 单测 | 1.5 |
| 契约文档 `docs/packs-contract.md` | 0.5 |
| 素材包完整文案（11 类事件） | 1.0 |
| 事件卡片 UI + 集成 | 1.0 |
| **小计** | **7.5 天** |

---

### 阶段 3：补算 + 退避 + 事件流 UI

**目标**：让"pet 一直在过日子"的体验成立——离线回来打开看到过去事件，退避让长期缺席的用户看到 pet 越来越安静。

#### 包含模块

- **补算器**（`src/domain/catchup/`）：
  - `planner.ts`：纯函数 `planCatchUp(pet, fromTs, toTs, rngSeed) → Plan`
    - ≤20 条事件硬上限
    - >7 天离线按"每天 1 条聚合"
    - 单次补算 = N 条常规 + 1 条聚合摘要（如超过 20 条上限）
  - `executor.ts`：事务内执行计划
  - `aggregator.ts`：聚合摘要生成（"过去 30 天，Pet 出门走了 X 次、收过 Y 片枯叶"）
- **退避调度**（`src/domain/backoff/`）：
  - `scheduler.ts`：按 CONTEXT.md 表实现缺席→间隔映射
  - 更新 `pets.next_proactive_ts` 的逻辑
- **同步 API**：
  - `GET /api/sync`：主同步入口（含补算触发、回信检查、每日馈赠检查）
- **事件流 UI**（`src/app/(pet)/timeline/page.tsx`）：
  - 时间线单一列表，按 ts 倒序
  - 类型标签（散步/自言自语/回信/...）
  - 记忆引用高亮（浅灰底色 + 角标）
  - **渐进披露**：首屏只显示"过去 X 天"入口卡片，点击展开事件流
  - 分页（每页 20 条，虚拟滚动可选）
- **状态快照**：
  - 每个事件卡片带"当时状态"（在家/出门/旅行）的徽章

#### 阶段演示

1. 登录 → 手动把 pet 的 `last_activity_ts` 改到 30 天前 → 触发 `/api/sync`。
2. 首页时间线首屏显示"过去 30 天"入口卡片。
3. 点击展开 → 看到 1 条聚合摘要事件（"过去 30 天，小圆出门走了 X 次..."）+ 若干常规事件（≤20 条）。
4. 补算耗时打点日志 < 500ms（秒级要求达标）。
5. 手动改 `user_last_active_ts` 到 10 天前 → 观察 `next_proactive_ts` 按退避表跳到 30 天后。

#### 阶段验收要点（对应 11 项验收）

- **验收 4（补算）**：全部达标——1/3/30 天场景、≤20 条 + 聚合、渐进披露入口卡片。
- **验收 5（事件流）**：全部达标——单一时间轴、类型标签、记忆引用高亮、无回复按钮（UI 层强制）。
- **验收 10（退避可观测）**：退避调度在阶段 3 完成，实际观测在阶段 4 演示。

#### 关键交付物

- `src/domain/catchup/**`（含单测覆盖 1/3/30 天、极端 90 天）
- `src/domain/backoff/**`（含单测覆盖完整退避表）
- `GET /api/sync`
- `src/app/(pet)/timeline/page.tsx`
- `src/ui/timeline.tsx`（渐进披露入口）
- `src/config/backoff-table.ts`

#### 工时估算

| 任务 | 人日 |
|------|------|
| 补算 planner（纯函数） + 单测 | 1.5 |
| 补算 executor + 聚合摘要 | 1.0 |
| 退避调度 + 单测 | 0.5 |
| /api/sync 集成 | 0.5 |
| 时间线 UI + 渐进披露 | 1.5 |
| 事件卡片状态徽章、类型标签 | 0.5 |
| **小计** | **5.5 天** |

---

### 阶段 4：每日馈赠 + 回信

**目标**：完成"每日一小仪式"的闭环——首次登录拿物品 → 送 pet → 24h 内收回信（含 ≥1 条记忆引用）。

#### 包含模块

- **物品池**（`src/domain/gift/item-pool.ts`）：
  - 至少 8 种物品（浆果、枯叶、石子、蒲公英、贝壳、鹅卵石、羽毛、木片）
  - 加权随机抽取
  - 排除最近 3 次重复
  - 池空兜底文案
- **每日馈赠**（`src/domain/gift/daily-grant.ts`）：
  - 用户当天首次登录 → 抽一件物品进 inventory
  - 生成 `daily_grant` 事件
  - 更新 `pets.daily_grant_last_date`
- **送赠**（`src/domain/gift/**`）：
  - `POST /api/gift/offer`：校验日限一次、扣 inventory、生成 `offer_received` 事件
  - 设置 `pets.reply_pending = true`, `reply_due_at = now + 24h`
  - 把送出的物品写入 `memories` 表（`kind = 'item_received'`）
- **回信**（`src/domain/gift/reply.ts`）：
  - `/api/sync` 时检查 `reply_due_at`，到期则调用事件引擎的 `reply_letter` 生成器
  - 保证至少 1 条记忆引用（引用送出的物品名 或 时间锚点 或 pet 名字）
  - 回信作为事件插入时间线
- **自主冒信**（阶段 2 已生成，阶段 4 接入退避）：
  - `spontaneous_letter` 事件按退避表触发（不是每日）
- **前端**：
  - `src/app/(pet)/gifts/page.tsx`（物品栏 + 送赠按钮 + 空态引导）
  - `src/app/(pet)/letter/page.tsx`（回信信纸阅读）
  - `src/ui/letter-view.tsx`、`src/ui/gift-tray.tsx`

#### 阶段演示

1. 登录（第 1 天）→ 每日馈赠事件出现在时间线 → 物品栏出现 1 件物品。
2. 送 pet → 送赠事件出现在时间线 → 物品从物品栏消失（进储物罐）。
3. 手动把系统时间推进 24 小时（或直接把 `reply_due_at` 改为过去）→ 再次 `/api/sync` → 时间线出现回信事件。
4. 打开回信页 → 信纸背景 + 内容 + 至少 1 条高亮的记忆引用（如 "上次你送我的浆果"）。
5. 手动把 `user_last_active_ts` 改到 3 天前 → 观察 `next_proactive_ts` 变为 7 天后（退避表 ≥3 天 → 7 天）。

#### 阶段验收要点（对应 11 项验收）

- **验收 10（每日馈赠闭环）**：全部达标——物品池 ≥8 种、送赠日限一次、24h 内回信、回信含 ≥1 条记忆引用。
- **验收 10 的退避可观测**：达到——退避表在阶段 3 定义，阶段 4 演示"缺席 3 天 → 7 天间隔"。

#### 关键交付物

- `src/domain/gift/**`（含单测覆盖物品池抽取、日限一次、回信记忆引用）
- 物品 seed 数据（`items` 表至少 8 行）
- `POST /api/gift/daily`（在 `/api/sync` 内部触发；也可单独暴露）
- `POST /api/gift/offer`
- `src/app/(pet)/gifts/page.tsx`
- `src/app/(pet)/letter/page.tsx`
- 素材包补回信、馈赠相关文案

#### 工时估算

| 任务 | 人日 |
|------|------|
| 物品池 + 单测 | 0.5 |
| 每日馈赠 + 送赠 | 1.0 |
| 回信生成 + 记忆引用保证 | 1.5 |
| /api/sync 集成检查 | 0.5 |
| 前端页面（物品栏、送赠、回信阅读） | 1.0 |
| **小计** | **4.5 天** |

---

### 阶段 5：公告 + 档案页

**目标**：补齐"运营通道"和"用户视角的 pet 全貌"。

#### 包含模块

- **公告中心**（`src/domain/announce/`）：
  - `hub.ts`：发布公告、按时间倒序列出、已读/未读、静音
  - `backfill.ts`：空窗期公告聚合（走同一 P0-1 策略：>7 天未读 → 聚合摘要）
  - `GET /api/announcements`：用户端拉取
  - `POST /api/announcements/admin`：自托管管理员发布（MVP 只做本地管理，不做联邦广播）
- **公告 UI**（`src/app/announcements/page.tsx`）：
  - 按时间倒序列表
  - 已读/未读标记
  - "静音 N 条"按钮
  - 空态："暂无公告"
- **档案页**（`src/app/(pet)/profile/page.tsx`）：
  - pet 当前状态卡片
  - 记忆片段列表（从 memories 表）
  - 事件历史入口（跳转 timeline）
  - 储物罐（收到的物品，从 inventory 表 `where offered_at IS NOT NULL`）
- **导出备份 hash 记录**（阶段 1 用户表预留字段，阶段 5 更新逻辑）：
  - 用户每次导出后，服务端记录 `users.last_backup_hash`（用于申诉自证）

#### 阶段演示

1. 自托管管理员发布一条公告 → 用户下次同步看到未读角标 → 打开公告页 → 已读标记 → 点"静音 3 条" → 3 条公告静音。
2. 手动改 pet 的 `last_activity_ts` 到 30 天前 → 期间有 10 条公告 → 首次同步只看到 1 条聚合摘要（"过去 30 天有 10 条公告，主要是..."），点击展开。
3. 打开档案页 → 看到"小圆 · 在家 · 创建于 2026-09-09"，下方记忆片段、储物罐内容、时间线入口全部可见。

#### 阶段验收要点（对应 11 项验收）

- **验收 2（档案页）**：全部达标——状态、记忆、事件历史、储物罐。
- **验收 6（公告）**：全部达标——发布→同步可见、已读/未读、静音、倒序。
- **验收 11（申诉入口）**：`users.last_backup_hash` 字段有更新逻辑（阶段 6 完整闭环）。

#### 关键交付物

- `src/domain/announce/**`（含单测覆盖聚合回补）
- `src/app/announcements/page.tsx`
- `src/app/(pet)/profile/page.tsx`
- 公告相关事件生成（`system_announce`）
- 素材包补公告文案

#### 工时估算

| 任务 | 人日 |
|------|------|
| 公告 hub + 单测 | 1.0 |
| 公告 UI + 集成 | 1.0 |
| 档案页 | 1.0 |
| 备份 hash 更新逻辑 | 0.2 |
| **小计** | **3.2 天** |

---

### 阶段 6：导出/导入 + 部署 + 性能冒烟

**目标**：数据主权闭环、官方托管可访问、自托管有文档、性能冒烟达标、发布上线。

#### 包含模块

- **导出器**（`src/domain/export/exporter.ts`）：
  - 组装 JSON（按 `schema.ts` 定义）
  - 计算 SHA256
  - 写入 `meta.schema_version` / `meta.exported_from` / `meta.exported_at`
  - 更新 `users.last_backup_hash`
  - `GET /api/export`：返回 JSON，前端触发下载
- **导入器**（`src/domain/export/importer.ts`）：
  - 解析 JSON、校验版本、校验 checksum、校验字段清单
  - `BEGIN TRANSACTION` → 逐表插入 → `COMMIT`
  - `POST /api/import`
- **错误文案**（`src/domain/export/error-messages.ts`）：
  - `ERR_VERSION_MISMATCH`：版本号不匹配
  - `ERR_CHECKSUM_MISMATCH`：校验和失败
  - `ERR_FIELD_MISSING`：字段缺失
  - 每种错误不同的用户友好提示
- **前端**：
  - `src/app/export/page.tsx`（导出确认弹窗，明确包含/不包含的数据）
  - `src/app/import/page.tsx`（导入 UI + 错误提示）
- **申诉入口**（MVP 人工兜底通道）：
  - `src/app/account/help/page.tsx`：说明申诉流程（提交备份 hash + 邮箱证明）
- **开发者模式**：
  - `src/app/developer/page.tsx`：加载另一套素材包、触发测试事件、查看当前配置
  - `POST /api/packs/activate`
- **部署**（v1.1：宝塔 Apache + PM2 + MySQL）：
  - `next.config.ts`：`output: 'standalone'`
  - `docker/Dockerfile`（基于 node:20-alpine）— 供 Docker Compose 自托管路径使用
  - `docker/docker-compose.yml`（自托管选项 b）：`app` + `mysql` 两容器
  - `pm2-ecosystem.config.js`（宝塔路径 a）：定义 `aetherpet-web` Node 进程，自动重启
  - `SELF_HOST.md` 完善版：从 0 到 1 全流程，覆盖两种部署路径：
    - 路径 a（宝塔）：Apache 反向代理到 `127.0.0.1:3000` + PM2 常驻 Node 进程 + 宝塔 MySQL 实例 + 宝塔定时备份任务（mysqldump）
    - 路径 b（Docker）：`docker compose up` 起 `app` + `mysql` 两容器
  - `.github/workflows/ci.yml`（类型检查 + 单测 + E2E + 构建；E2E 用临时 MySQL 容器）
  - `.github/workflows/release.yml`（tag 触发 Docker 镜像构建）
- **备份**（v1.1）：
  - `scripts/backup.ts`：调用系统 `mysqldump --single-transaction`，产物 `data/backups/aetherpet-YYYY-MM-DD.sql.gz`；官方托管建议改用宝塔面板自带的定时备份任务（零代码）
  - 用户侧 JSON 导出仍走 `/api/export`（不变）
- **性能冒烟**：
  - `scripts/smoke-test.ts`：首屏加载 <3s、30 天补算 <500ms、**MySQL 连接池预热 + 单次事务耗时 P99 < 200ms**
  - CI 集成（CI 中拉临时 MySQL 容器）
- **最终 11 项验收 E2E 用例**（Playwright）：
  - 每项验收一个 spec，跑通全套（E2E 依赖临时 MySQL 容器）

#### 阶段演示

1. 打开 http://localhost:3000 → 导出 pet 全部数据 → 得到 JSON 文件（含 schema_version=1.0.0、checksum、exported_from="local"）。
2. 清空测试账号 → 导入刚才的 JSON → 数据逐字段比对一致 → 时间线、记忆、物品栏完全恢复。
3. 手动篡改 JSON 的 checksum → 导入 → 提示"校验和失败，数据可能已损坏"。
4. 手动把 schema_version 改为 "2.0.0" → 导入 → 提示"版本不匹配，请使用兼容的导出文件"。
5. 打开开发者页面 → 切换到"备用素材包" → 视觉/文案变化可见 → 切换回默认包正常。
6. 官方托管部署跑通（宝塔：Apache 反代 + PM2 常驻 Node + MySQL 实例 + mysqldump 备份任务）；自托管部署文档（路径 b：Docker Compose）跑通。
7. 性能冒烟报告：首屏 2.1s、30 天补算 320ms。

#### 阶段验收要点（对应 11 项验收）

- **验收 7（导出/导入）**：全部达标——JSON 含 schema/校验和/元信息、逐字段比对一致、三类报错文案不同。
- **验收 8（素材包可配置性）**：开发者模式切换包验证达标。
- **验收 9（部署 + 性能）**：官方托管可访问、自托管有文档、加载 <3s、补算秒级。
- **验收 11（账号申诉入口）**：申诉页面存在、备份 hash 可作身份证明。

#### 关键交付物

- `src/domain/export/**`（含单测覆盖三类错误、逐字段比对）
- `GET /api/export`, `POST /api/import`
- `src/app/export/**`, `src/app/import/**`
- `src/app/account/help/**`（申诉入口）
- `src/app/developer/**`, `POST /api/packs/activate`
- `docker/Dockerfile`, `docker/docker-compose.yml`
- `pm2-ecosystem.config.js`
- `SELF_HOST.md`（完整，覆盖宝塔 + Docker 两条路径）
- `README.md`（用户视角）
- `.github/workflows/*.yml`
- `scripts/smoke-test.ts`（含 MySQL 连接池预热）
- `scripts/backup.ts`（mysqldump 包装）
- `tests/e2e/acceptance-*.spec.ts`（11 项全覆盖，依赖临时 MySQL 容器）
- `docs/packs-contract.md`（如阶段 2 后有小调整，最终版）

#### 工时估算

| 任务 | 人日 |
|------|------|
| 导出器 + 单测 | 1.0 |
| 导入器 + 三类错误 + 单测 | 1.5 |
| 前端（导出确认弹窗、导入 UI） | 0.5 |
| 申诉入口 | 0.3 |
| 开发者模式 + 素材包切换 | 0.5 |
| Docker Compose + pm2-ecosystem + 宝塔 Apache 反代配置样例 | 0.6 |
| SELF_HOST.md + README（两条部署路径） | 0.6 |
| CI/CD（含临时 MySQL 容器） | 0.5 |
| 性能冒烟（含 MySQL 连接池） | 0.3 |
| E2E 11 项验收 | 1.0 |
| **小计** | **6.8 天** |

---

## 4. 阶段交付检查表

每阶段结束前自检：

- [ ] 阶段演示脚本跑通（能打开浏览器看到效果）
- [ ] 本阶段的领域层单测全部通过（覆盖率 ≥80%）
- [ ] 本阶段的 API 有 Playwright 集成测试
- [ ] 本阶段验收项（对齐需求 §6）在 `docs/dev-stage-plan.md` 中标记为"完成"
- [ ] 契约文档（若本阶段涉及）同步更新
- [ ] `docs/pitfalls.md` 记录本阶段踩到的坑
- [ ] 性能冒烟（若本阶段涉及性能敏感路径）通过
- [ ] 数据库 migration（若本阶段新增表/字段）已应用且可回滚（MySQL DDL 不自动事务回滚；migration 脚本需自己保证失败时无半成品）

---

## 5. 风险与依赖说明

### 5.1 关键路径

**阶段 2 是全部项目的关键路径**。事件契约冻结后不能改，任何后续阶段的返工成本都高。因此：

- 阶段 2 结束前必须开一次"契约评审会"（产品 + 架构 + 工程师三方）
- `docs/packs-contract.md` 一旦定稿，bump 版本号是唯一合法的变更方式
- 若评审发现契约不合理，回到阶段 2 修订，不要拖到阶段 3

### 5.2 可以提前准备的工作

- 阶段 1 期间，设计师可以并行准备默认素材包的图片资产（home-bg、letter-bg、图标集）
- 阶段 2 期间，可以并行准备完整文案（阶段 1 只需占位符，阶段 2 补齐）
- 阶段 4/5 可以并行

### 5.3 依赖外部条件

- 邮件服务商（**v1.1：中心自治 SMTP**）：阶段 1 前确认 SMTP 服务商（SES / Resend / Gmail / QQ / 自建），官方中心需预先配置 `.env` 中的 `SMTP_*` 与 `HUB_ADMIN_EMAIL` / `HUB_PRIVACY_URL`
- 官方托管服务器：阶段 6 前到位（建议宝塔面板环境）
- MySQL 实例：阶段 6 前到位（宝塔 MySQL 或自装 MySQL 8）
- 域名 + 邮箱 SPF/DKIM 配置：阶段 6 前完成
- Apache 反向代理配置：阶段 6 前在宝塔面板配好（域名 → `127.0.0.1:3000`）
- PM2 全局安装：阶段 6 前在服务器安装（`npm install -g pm2`）
- 素材包设计资源：阶段 1 内到位（默认包）

### 5.4 单人 vs 双人的执行建议

- **单人**：按阶段严格串行，约 28–38 天。
- **双人**：
  - 阶段 1–3 由主开发者 A 完成（打基础 + 定契约）
  - 阶段 4、5 由 A/B 并行
  - 阶段 6 由 B 主完成导出/导入 + 部署，A 主完成 E2E + 性能冒烟

---

## 6. 与架构、数据库的映射

| 架构 §4.1 模块 | 首次落地阶段 | 完善阶段 |
|----------------|--------------|----------|
| auth | 1 | 6（申诉） |
| pet-fsm | 2 | |
| event-engine | 2 | |
| catchup | 3 | |
| backoff | 3 | 4（观测验证） |
| memory | 2 | 4（回信强引用） |
| packs | 1 | 2（完整文案）、6（切换验证） |
| gift | 4 | |
| announce | 5 | |
| export | 6 | |
| persistence | 1（建表） | 全阶段 |

| 数据库表 | 首次落地阶段 | 备注 |
|---------|--------------|------|
| meta, migrations | 1 | |
| users, verification_codes, sessions, audit_log | 1 | |
| pets | 1 | |
| memories | 2 | |
| items, inventory | 1（表）+ 4（seed） | 表先建，物品 seed 数据在阶段 4 补 |
| events | 2 | |
| announcements, user_announcement_reads | 5 | |
| user_settings | 1 | |

---

## 7. 11 项验收追踪矩阵

| # | 验收 | 阶段 1 | 阶段 2 | 阶段 3 | 阶段 4 | 阶段 5 | 阶段 6 |
|---|------|--------|--------|--------|--------|--------|--------|
| 1 | 注册登录（含安全边界） | ✅ | | | | | |
| 2 | 档案页 | | | | | ✅ | |
| 3 | 随机事件引擎（含记忆引用） | | ✅ | | | | |
| 4 | 补算（含极端场景） | | | ✅ | | | |
| 5 | 事件流 | | | ✅ | | | |
| 6 | 公告 | | | | | ✅ | |
| 7 | 数据导出/导入 | | | | | | ✅ |
| 8 | 素材包可配置性 | 加载✅ | 契约✅ | | | | 切换✅ |
| 9 | 部署 + 性能 | | | | | | ✅ |
| 10 | 每日馈赠闭环（含退避） | | | 退避表✅ | ✅ | | |
| 11 | 账号安全与恢复 | 节流/退出✅ | | | | 备份hash✅ | 申诉入口✅ |

✅ = 该阶段完成本验收项的主要交付

---

*本文档定稿于 2026-09-09。执行中若阶段划分需要调整，必须同步更新 `docs/architecture.md` 与 `docs/database-schema.md` 的对应章节。*
