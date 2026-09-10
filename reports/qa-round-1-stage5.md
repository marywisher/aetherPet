# 质检报告 · 阶段 5（公告 + 档案页）Round 1

## 基本信息

| 项 | 值 |
|---|---|
| 测试日期 | 2026-09-10 |
| 测试范围 | 阶段 5：公告中心（domain/announce + API + UI）、档案页（/api/profile + UI）、备份 hash 铺逻辑（domain/backup） |
| 测试人员 | 质检 |
| 代码版本 | 工作区未提交（`git status`：13 未跟踪 + 2 修改；最近 commit `d991b56 feat(stage-4)`） |
| 依赖文档 | `docs/current-stage.md`、`docs/dev-stage-plan.md §3 阶段 5`、`docs/requirements.md §3.6/§3.8`、`docs/architecture.md §4.1`、`docs/database-schema.md`、`docs/pitfalls.md`、`reports/dev-report-stage5.md`、`reports/qa-final-stage4.md` |

**验证命令实跑结果（本次质检）：**

```
$ npx vitest run        → 40 files / 481 tests passed (4.79s)
$ npx tsc --noEmit      → 无输出，0 错误
$ npx next build        → ✓ Compiled successfully（/announcements、/profile、/api/announcements、/api/announcements/admin、/api/profile 均出现在路由表）
$ git status            → 阶段 5 变更全部未提交（未执行 git commit ✅）
$ grep -rn "打卡\|签到" src/ → 全部命中在注释（引用约束本身），UI 文案 0 命中 ✅
```

---

## 测试汇总

- **发现问题总数：13**
- **P0（阻塞）：1**
- **P1（严重）：2**
- **P2（一般）：5**
- **P3（轻微）：5**
- **测试通过：否**（存在 P0/P1 未修复，不进入提交环节）

**硬约束合规性：**

| 硬约束 | 结论 | 备注 |
|---|---|---|
| 契约版本不 bump（仍 v1.0.1） | ✅ 通过 | `docs/packs-contract.md` 首行仍标 v1.0.1；DB schema_version 仍 "1.0.0" |
| 事件结构不含文案（运行期） | ⚠️ 表面通过 / ⚠️ 潜在风险 | 运行期未写入 events 表（见 P2-003 生成器潜在违规） |
| 领域层零 next/react | ✅ 通过 | `src/domain/announce/*` 与 `src/domain/backup/*` grep `next|react` 均 0 命中 |
| MySQL 保持 | ✅ 通过 | 未新增 migration，复用 001_init.sql 中已存在的 announcements / user_announcement_reads 表 |
| 文案禁"打卡/签到" | ✅ 通过 | 6 处命中全在注释 |
| 无 git commit | ✅ 通过 | 阶段 5 变更全部未跟踪，最近 commit 仍为 d991b56 |
| 幂等（INSERT IGNORE / ON DUPLICATE KEY UPDATE / affectedRows） | ✅ 通过 | mark_read / mute / unmute 三条路径 SQL 语义正确 |

---

## 详细问题清单

### P0 — 阻塞性问题

| 编号 | 问题描述 | 所在文件 | 状态 |
|---|---|---|---|
| P0-001 | `GET /api/announcements` 路由未实现，UI 拉取列表必然 405 | `src/app/api/announcements/route.ts` | 待修复 |

#### P0-001 详情

**问题描述：**
`src/app/api/announcements/route.ts` 全文 178 行，仅导出 `POST`（第 42 行 `export async function POST`）；文件内没有任何 `export async function GET`、`handleGet`、`GET` 关键字。

```
$ grep -c "^export" src/app/api/announcements/route.ts    → 2（仅 runtime + POST）
$ grep -n "GET" src/app/api/announcements/route.ts          → 无匹配（除 handleMute 内 buildList 的局部变量名）
```

**复现步骤：**
1. 管理员通过 `POST /api/announcements/admin` 发布一条公告（X-Admin-Token 路径，且 HUB_ADMIN_TOKEN 已设置）。
2. 用户浏览器访问 `http://localhost:3000/announcements`。
3. 页面 `AnnouncementsInner.load()` 执行 `fetch("/api/announcements", { cache: "no-store" })`（默认 GET 方法，见 `src/app/announcements/page.tsx` 第 78 行）。
4. Next.js App Router 对未定义 GET 的路由返回 **405 Method Not Allowed**。
5. UI 走 `if (!res.ok) setError(\`请求失败 (${res.status})\`)` 分支，页面只显示"请求失败 (405)"红色横幅，永远无法渲染公告。

**期望结果（对齐 `docs/requirements.md` §3.8 + 验收 #6）：**
服务端发布 → 用户打开 `/announcements` → 看到倒序列表 + 已读/未读状态点 + 空窗聚合摘要 + 静音按钮。dev-report §3.4 明确列出响应结构 `{ ok, items, unreadCount, mutedCount, aggregation }`，并声称"完整实现"。

**实际结果：**
路由只处理 POST，GET 请求 405。用户永远无法看到任何公告。

**建议修复：**
在 `src/app/api/announcements/route.ts` 追加 `export async function GET(req: NextRequest): Promise<NextResponse>`：

```ts
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) { /* 401 */ }
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);
  const sinceRaw = sp.get("since");
  const sinceTs = sinceRaw ? Number(sinceRaw) : null;
  const now = Date.now();
  const env = getEnv();
  const announcements = await findPublishedSince(sinceTs, limit);
  const reads = await findReadsByUser(auth.userId, 500);
  const list = buildList({ announcements, reads, now });
  return NextResponse.json({ ok: true, ...list });
}
```

**影响面：**
- 验收 #6 完全无法通过（"服务端发公告 → 用户同步可见"断链）
- `/announcements` 页面在功能上完全不可用（除显示"请求失败"外无任何信息）
- 静音、mark_read、unmute 三个 POST 分支即使代码正确，也无法通过 UI 触达（用户看不到要静音的公告）

**为什么 dev-report 声称"完成"：**
`reports/dev-report-stage5.md` §3.4 明确写道"GET /api/announcements（列表 + 状态 + 聚合）"完成，§7 变更文件清单也未标注此缺失。这是 dev-report 与代码不一致，属于交付声明与实交付脱节。

---

### P1 — 严重问题

| 编号 | 问题描述 | 所在文件 | 状态 |
|---|---|---|---|
| P1-001 | P5-003 回退鉴权路径恒返回 403（`email_plain_enc` 恒 null）；默认配置下 admin 无法发布公告 | `src/app/api/announcements/admin/route.ts` + `src/domain/auth/magic-link.ts` | 待修复 |
| P1-002 | `/profile` 与 `/announcements` 无任何导航入口，验收 #2 档案页从 UI 不可达 | `src/app/page.tsx`、`src/app/(pet)/timeline/page.tsx` 等 | 待修复 |

#### P1-001 详情（dev-report §6.1 P5-003 的实际影响）

**问题描述：**
`src/app/api/announcements/admin/route.ts` 第 46–70 行实现"回退鉴权路径"：登录用户且 `users.email_plain_enc === env.HUB_ADMIN_EMAIL` 才可发布。但：

```
$ grep -rn "emailPlainEnc:" src/domain/auth/magic-link.ts
src/domain/auth/magic-link.ts:228:            emailPlainEnc: null,
```

Magic-link 注册路径把 `email_plain_enc` 恒写为 `null`。DB schema 中 `email_plain_enc TEXT NULL`（`001_init.sql:44`）。全项目无任何路径把 `email_plain_enc` 写入非 null 值（`grep -rn "emailPlainEnc" src/` 只命中类型定义、repo 映射、admin 判断三处，均为读或 null 写）。

**复现步骤：**
1. 保持 `.env` 中 `HUB_ADMIN_TOKEN=` 为空（`.env.example` 默认即为空）。
2. 用户以任意邮箱走 magic-link 注册（`email_plain_enc` 写入 null）。
3. 用户登录（Bearer token）后 `POST /api/announcements/admin` 发布。
4. 请求头无 `X-Admin-Token`，进入回退分支：`user.emailPlainEnc !== env.HUB_ADMIN_EMAIL` → `null !== "admin@example.com"` → true → **403 "无权限：仅管理员可发布公告"**。
5. 换任何邮箱注册重复以上步骤，结果均 403。

**期望结果：**
`.env.example` 第 56–58 行注释明确"留空表示未启用 admin bearer-token 路径；此时 admin 请求回退到「登录用户 + HUB_ADMIN_EMAIL 匹配」"，运维按此部署后应能发布。

**实际结果：**
回退路径永真 403。运维唯一可用的路径是设置 `HUB_ADMIN_TOKEN` 走 X-Admin-Token 头。

**为什么定级 P1（非 P0）：**
- X-Admin-Token 路径本身工作正常，只要 ops 显式在 `.env` 里配置 `HUB_ADMIN_TOKEN` 即可发布。
- 但 `.env.example` 默认值为空 + 注释引导 ops 走回退路径，形成误导性运维陷阱。
- 与 P0-001 叠加时（GET 也缺失），"发布→用户可见"链路彻底断裂；但 P1-001 单独可修复（把 admin 判断改为读 `email_hash` 或直接拒绝回退路径并给出 501）。

**建议修复（择一）：**
- **短期**：把 `admin/route.ts` 的回退分支替换为 `return NextResponse.json({ error: "需配置 HUB_ADMIN_TOKEN 环境变量" }, { status: 501 })`，并在 `.env.example` 注释中删除"回退到 HUB_ADMIN_EMAIL 匹配"的引导，明确 ops 必须配置 token。
- **中期（阶段 6）**：新增独立 admin 表或 `users.role` 字段（dev-report §6.2 已规划）。
- **不建议**：在 magic-link 注册时把 email 明文 AES 写入 `email_plain_enc`。当前 schema 的 `email_plain_enc` 命名与实现矛盾，且当前代码没有任何解密路径，写入明文 AES 反而引入数据泄露面。

#### P1-002 详情

**问题描述：**
阶段 5 新增 `/profile` 与 `/announcements` 两个页面，但**全项目无任何反向链接指向它们**：

```
$ grep -rn 'href="/profile"\|href="/announcements"' src/
src/app/(pet)/profile/page.tsx:171:          <Link href="/announcements" ...   ← profile 页内部
```

即：
- `src/app/page.tsx`（首页）：仅链接到 `/settings`、`/timeline`。
- `src/app/(pet)/timeline/page.tsx`：仅链接回 `/`。
- `src/app/(pet)/gifts/page.tsx`：链接到 `/`、`/timeline`、`/letter`，无 `/profile`、`/announcements`。
- `src/app/(pet)/letter/page.tsx`：链接到 `/`、`/timeline`、`/gifts`，无 `/profile`、`/announcements`。
- `src/app/announcements/page.tsx`：链接到 `/`、`/gifts`（无回 `/profile`）。
- `src/app/(pet)/profile/page.tsx`：链接到 `/`、`/gifts`、`/announcements`、`/timeline`（profile 是唯一"向外发"的枢纽，但自身不可达）。

**期望结果（对齐验收 #2、#6）：**
用户登录 → 首页 → 有明确的"我的档案"/"公告"入口（或底部 tab / 顶部导航），无需知道 URL 也能触达档案页与公告页。

**实际结果：**
用户只能手动输入 `localhost:3000/profile` 与 `localhost:3000/announcements` 访问。移动端完全不可达。

**建议修复（最小集）：**
在 `src/app/page.tsx`（首页）与 `src/app/(pet)/timeline/page.tsx` 的 header 增加 `Link href="/profile"` 与 `Link href="/announcements"`（带未读 badge 更佳，但 MVP 可省）。同时给 `/announcements` 页面加回 `/profile` 的链接，形成基本导航网。

**为什么定级 P1（非 P2）：**
验收 #2 明确"查看 pet 当前状态、记忆片段、事件历史、储物罐"——若页面不可达，"查看"这个动作在用户视角下不存在。功能实现本身正确（API 完整、UI 完整），但用户永远触达不到。这是"功能正确但验收不能通过"的典型场景，比代码 bug 更严重。

---

### P2 — 一般问题

| 编号 | 问题描述 | 所在文件 | 状态 |
|---|---|---|---|
| P2-001 | `system_announce` 事件未接入 events 表，公告在时间线不可见；与验收 #6"同步可见"的广义解读有分歧 | `src/domain/events/generators/announcement.ts`（生成器存在但未被调用） | 待修复 / 阶段 6 规划 |
| P2-002 | 空窗聚合摘要与下方全量列表内容重复，"不逐一轰炸"仅部分兑现 | `src/app/announcements/page.tsx` | 待修复 |
| P2-003 | 公告事件生成器 params 含 `announcement_title/body`，与"事件结构不含文案"硬约束相冲突；一旦被调用即违反约束 | `src/domain/events/generators/announcement.ts` | 阶段 6 阻塞项 |
| P2-004 | `handleMarkRead` 计数器无论 `affectedRows` 是否 0 都 `marked += 1`，返回给客户端的 `marked` 数字语义偏离"新增标记数" | `src/app/api/announcements/route.ts:92–95` | 待修复 |
| P2-005 | mark_read / mute / unmute 三类用户可见操作无 audit_log 记录，与阶段 4 建立的用户动作审计规范不一致 | `src/app/api/announcements/route.ts` | 建议修复 |

#### P2-001 详情

**问题描述：**
`docs/packs-contract.md` 明确定义了 `system_announce` 事件（关键 params：`announcement_id, announcement_title, announcement_body`），`src/domain/events/generators/announcement.ts` 也实现了 `generateSystemAnnounce` 并注册进 `src/domain/events/templates.ts`。但阶段 5 未在任何代码路径调用它，`src/domain/announce/hub.ts` 与 `src/app/api/announcements/admin/route.ts` 均未 `insert` 到 events 表。

**影响评估：**
- 狭义解读验收 #6（"公告页可见即可"）：只要 P0-001 修复，用户可通过 `/announcements` 看到公告 → **不影响验收**。
- 广义解读验收 #6（"用户在应用任意处同步可见"）：公告不会出现在 `/timeline`（时间线）里，`src/ui/timeline.tsx` 第 67 行有 `system_announce: "公告"` 标签但永远不会出现 → **广义不通过**。

**建议：**
- 阶段 5 保留当前状态（明确"仅铺逻辑"，dev-report §6.2 已列出"阶段 6 待补：接入 system_announce 事件生成器"）。
- **必须在阶段 6 前解决**，且解决时需同步处理 P2-003（生成器 params 违反"事件不含文案"约束）——建议改为 params 只存 `announcement_id`，UI 侧通过 `findById(announcement_id)` 反查文案，事件结构回归"只存引用不存文案"。

#### P2-002 详情

**问题描述：**
`src/domain/announce/backfill.ts` 第 73–88 行构建聚合摘要，但 `src/domain/announce/hub.ts` 第 78–90 行 `buildList` 返回的 `items` 仍包含**所有公告**（包括进入聚合的老公告）。UI `src/app/announcements/page.tsx` 第 190–238 行同时渲染：
1. 顶部聚合摘要卡片（`{data?.aggregation && ...}`）
2. 下方全部 items（`{items.map(...)}`），含已聚合的老公告

**用户实际体验：**
若 30 天前发布了 10 条公告，用户回来看到：
- 顶部卡片"过去 23 天有 10 条公告"（含 3 条 previewTitles）
- 下方 10 条老公告 + 近期公告，全部展开列表

**期望（对齐 requirements §3.8 "空窗期回补的公告走聚合摘要策略（不逐一轰炸）"）：**
聚合后的老公告应从主列表折叠 / 隐藏，只保留在聚合卡片下作为可展开的次级列表，避免"轰炸"感。

**建议修复：**
- 在 `buildList` 输出中新增 `aggregatedIds: Set<Ulid>`，UI 层过滤掉这些 ids 的 items，仅在聚合卡片下方提供"查看全部 N 条"次级展开。
- 或最小改动：UI 层通过 `aggregation.previewTitles` 判断"若存在聚合则隐藏所有 `publishedAt < boundary` 的 items"。

#### P2-003 详情

**问题描述：**
`src/domain/events/generators/announcement.ts` 第 36–40 行：

```ts
params: {
  announcement_id: ctx.announcementId,
  announcement_title: ctx.announcementTitle,
  announcement_body: ctx.announcementBody,
},
```

将 `announcement_title` 与 `announcement_body` 完整文本写入 event.params，直接违反 `docs/current-stage.md` 阶段 5 关键约束 3："**事件结构不含文案**；领域层纯 TS（禁 next/react）；MySQL 条件更新保证幂等"。

同时违反 `docs/requirements.md` §3.10 素材包可配置性精神——若事件 params 直接内嵌文案，素材包文案模板（`text/system-announce.json`）就成了死代码。

**为什么定级 P2：**
- 阶段 5 运行期没有调用该生成器（P2-001 已确认），**当前不产生违规事件**。
- 但生成器已注册进 `src/domain/events/templates.ts:32`（`system_announce: generateSystemAnnounce`），任何未来调用点都会静默违反约束。
- 阶段 6 一旦要"接入 system_announce 事件生成器"（dev-report §6.2 明确），必须先修此文件，否则契约违反。

**建议修复：**
- 在阶段 5 结束前，将 `announcement.ts` 改为 params 只含 `announcement_id`（不含 title/body），并在函数注释中明确"文案在 UI 层通过 findById 反查"。
- 同步更新 `docs/packs-contract.md` §4.1 占位符表与 §5 事件速查表，把 `{announcement_title}` / `{announcement_body}` 改为引用型（或在阶段 6 触发时把契约 bump 到 1.1.0，但本阶段禁止 bump）。
- 或者：在阶段 5 直接**移除**该生成器注册，把接入推迟到阶段 6 一并规划（更干净）。

#### P2-004 详情

**问题描述：**
`src/app/api/announcements/route.ts` 第 92–95 行：

```ts
for (const id of capped) {
  const affected = await markReadInTx(conn, userId, id, now, "1.0.0", hubId);
  // affectedRows=0 视为已读（幂等成功）；=1 首次写入
  marked += 1;         // ← 无论 affected 是否 0 都计数
}
```

即使所有 ids 都是重复标记（affectedRows 全 0），返回值仍为 `marked = ids.length`。

**影响：**
- 客户端无法通过 `marked` 判断本次操作是否产生实际写入。
- 若后续要引入"标记已读数量变更"作为通知触发条件（例如"首次标记一条公告后清掉未读 badge"），会得到错误信号。
- dev-report §3.5 声称"`mark_read`：`INSERT IGNORE`；重复标记无副作用"——"无副作用"字面上正确（DB 侧无写入），但"响应语义无差异"不成立。

**建议修复：**
把 `marked += 1` 改为 `marked += affected`；或在响应中新增 `newlyMarked` 字段（首次标记数）与 `alreadyRead` 字段（幂等命中数），保留 `marked` 作为"处理总数"以保持向后兼容。

#### P2-005 详情

**问题描述：**
阶段 4 建立了 `audit_log` 用户动作审计（`insertAuditLog` / `logVerificationAttempt` 等），`docs/requirements.md` §5 "审计日志（验证码尝试/登录失败/导出导入）" 未强制要求公告操作审计，但：

- `POST /api/announcements/admin` 已记录 `announcement_published`（第 116–131 行）。
- `POST /api/announcements` 的 mark_read / mute / unmute 三个用户动作**均未记录** audit_log。
- 阶段 6 计划导出功能，届时"用户导出行为"也会写 audit_log；届时若 mute/unmute 未审计，"用户申诉自证"的数据一致性会打折扣。

**建议修复：**
- 短期：不强制（P2 级建议）。
- 阶段 6 前：在 mark_read / mute / unmute 成功后追加 `insertAuditLog({ eventType: "announcement_mark_read" | "announcement_muted" | "announcement_unmuted", detail: { announcement_ids, ... }, userId })`；同步在 `src/domain/types.ts` `AuditEventType` union 追加三个类型。

---

### P3 — 轻微问题

| 编号 | 问题描述 | 所在文件 | 状态 |
|---|---|---|---|
| P3-001 | dev-report §3.4 声称 GET /api/announcements 已实现，与代码不一致（见 P0-001） | `reports/dev-report-stage5.md` | 待修复 |
| P3-002 | dev-report §3.5 描述 unmute SQL 含 `WHERE muted_until_ts IS NOT NULL`，实际 SQL 无此条件 | `reports/dev-report-stage5.md`、`user-announcement-reads.repo.ts` | 待修复 |
| P3-003 | `recordBackupHash` 参数 `_ts` 声明但未使用，实际调用 `updateLastBackupHash` 时忽略 ts | `src/domain/backup/backup.ts:52` | 待修复 |
| P3-004 | POST body `ids` 未做类型/长度校验，接受任意元素类型（数字、非字符串）会写入 DB | `src/app/api/announcements/route.ts:handleMarkRead/handleUnmute` | 建议修复 |
| P3-005 | Profile 页 `timeAgo(pet.userLastActiveTs)` 在 diff < 24h 时返回"今天"，即使用户 last active 在几小时前也显示"今天"，语义模糊 | `src/app/(pet)/profile/page.tsx:78` | 建议修复 |

#### P3-001 详情
见 P0-001。dev-report §3.4 明确写"GET /api/announcements（列表 + 状态 + 聚合）"完成，但代码只实现 POST。属于交付声明与实交付脱节。

#### P3-002 详情
dev-report §3.5："unmute: UPDATE ... WHERE muted_until_ts IS NOT NULL（隐式：affectedRows=0 表示本来就没静音）"。实际 SQL（`user-announcement-reads.repo.ts:82`）：
```sql
UPDATE user_announcement_reads SET muted_until_ts = NULL WHERE user_id = ? AND announcement_id = ?
```
无 `WHERE muted_until_ts IS NOT NULL`。实现本身仍是幂等的（MySQL 对 `UPDATE ... SET x = NULL WHERE x IS NULL` 返回 affectedRows=0），但 doc 描述与代码不一致。

#### P3-003 详情
`backup.ts:52`：
```ts
export async function recordBackupHash(userId, sha256Hex, _ts = Date.now()) {
  ...
  await updateLastBackupHash(userId, sha256Hex);  // _ts 未传入
}
```
`_ts` 参数前缀下划线明示"故意不用"，但保留参数会让调用方误以为可以覆盖写入时间戳。建议：删除 `_ts` 参数，或让 `updateLastBackupHash` 接受 ts 并写入 `users.updated_at`。

#### P3-004 详情
`handleMarkRead` / `handleUnmute` 直接 `for (const id of capped)` 迭代 `ids`，不校验：
- 元素类型是否 string（数字、对象会被 MySQL 驱动自动转换，可能产生脏数据）
- 元素长度 ≤ 32（`announcements.id` 是 ULID，VARCHAR(32)；超长字符串会被 MySQL 拒绝或截断）
- 是否包含 null / undefined

建议在 body 解析后追加：
```ts
if (!Array.isArray(body.ids) || !body.ids.every(id => typeof id === "string" && id.length <= 32)) {
  return NextResponse.json({ error: "ids 必须为字符串数组" }, { status: 400 });
}
```

#### P3-005 详情
`timeAgo` 在 diff 不足 1 天时返回"今天"，即使 last active 是 3 小时前。用户体验上会显得"今天活跃"过于宽泛。建议改为按小时/分钟分段（<1h 显示"刚刚"/"X 分钟前"，<24h 显示"X 小时前"）。

---

## 硬约束与阶段 5 教训符合性

| 项 | 结论 |
|---|---|
| **契约版本不 bump** | ✅ 保持 v1.0.1；DB schema_version 保持 "1.0.0" |
| **事件结构不含文案（运行期）** | ✅ 运行期未产生 events 表写入（因未接入 system_announce） |
| **事件结构不含文案（潜在）** | ⚠️ 生成器实现含文案（P2-003），一旦被调用即违反 |
| **领域层纯 TS** | ✅ `grep -rn "next\|react" src/domain/announce src/domain/backup` 无命中 |
| **MySQL 保持** | ✅ 无新 migration，复用现有表 |
| **文案禁"打卡/签到"** | ✅ UI 0 命中（6 处注释命中合规） |
| **无 git commit** | ✅ 变更全部未跟踪 |
| **跨阶段字段写入方明确（pitfall #1）** | ✅ `users.last_backup_hash` 写入方：`backup.recordBackupHash → users.repo.updateLastBackupHash`，写入路径清晰（阶段 6 会追加导出触发点，不冲突） |
| **DB 级幂等（pitfall #2）** | ✅ `INSERT IGNORE`（mark_read）+ `ON DUPLICATE KEY UPDATE`（mute）+ `UPDATE ... WHERE` + affectedRows 判定（unmute）三条路径齐备 |
| **mock 需集成验证（pitfall #3）** | ⚠️ 阶段 5 单测均 mock `sql` / `db`，未做集成验证。P0-001（GET 缺失）就是"mock 层通过、实路径缺失"的典型案例——`announcements.repo` 单测覆盖 `findPublishedSince`，但没有 API 层的集成用例去触发 GET。建议阶段 6 前引入 `@/domain/persistence/db` 的内存 mock（如 sqlite 兼容模式或 mysql-memory-server）补 API 集成测试 |

---

## 与阶段 1–4 集成

| 集成点 | 状态 | 说明 |
|---|---|---|
| 认证（阶段 1） | ✅ | `requireAuth` 复用，Bearer token 鉴权一致 |
| 素材包加载（阶段 1） | ✅ | UI 使用 `useTheme().packDisplayName`，无硬编码文案 |
| 事件引擎（阶段 2） | ⚠️ | 事件生成器 `announcement.ts` 存在但未被调用（P2-001/P2-003）；events 表未因公告变更 |
| 契约 v1.0.1（阶段 2） | ✅ | 未 bump，`system_announce` 仍在契约中但运行期未使用 |
| 补算/退避（阶段 3） | ✅ | 空窗聚合阈值 `BACKFILL_THRESHOLD_MS = 7 天` 与阶段 3 退避策略对齐 |
| 时间线（阶段 3） | ⚠️ | `/timeline` 已有 `system_announce: "公告"` 标签但永不会有对应事件（P2-001） |
| 馈赠/回信/库存（阶段 4） | ✅ | 档案页储物罐 `WHERE offered_at IS NOT NULL` 复用阶段 4 定义；`memories.repo.findByPetId` 复用 |
| 审计日志（阶段 1–4） | ⚠️ | admin 发布有审计，用户操作（mark_read/mute/unmute）无审计（P2-005） |
| audit_log event_type union | ✅ | `announcement_published` 已加入 `AuditEventType`（`types.ts:231`） |
| DB schema（阶段 1） | ✅ | 复用 `announcements`、`user_announcement_reads`、`inventory`、`memories`、`events`、`users` 六表，无新 DDL |

---

## 测试覆盖

- [x] **单元：domain/announce/hub** — 22 例覆盖 computeStatus / buildList / planMute 全部分支
- [x] **单元：domain/announce/backfill** — 5 例覆盖 buildAggregation 阈值、预览上限、边界
- [x] **单元：domain/backup** — 9 例覆盖 isValidSha256Hex 边界 + recordBackupHash 拒绝非法 hash
- [x] **单元：persistence/announcements.repo** — 9 例覆盖 insert / findById / findPublishedSince（含 conn 参数分支）
- [x] **单元：persistence/user-announcement-reads.repo** — 8 例覆盖 markReadInTx / muteInTx / unmuteInTx / findByUser / findByUserAndAnnouncement
- [ ] **集成：/api/announcements GET** — ❌ 缺失（P0-001 直接后果，没有测试去覆盖 GET 路径）
- [ ] **集成：/api/announcements POST** — ❌ 缺失（mark_read/mute/unmute 仅 repo 层单测，API 层无测试）
- [ ] **集成：/api/announcements/admin** — ❌ 缺失（鉴权双路径无测试；P1-001 若被覆盖会立即暴露）
- [ ] **集成：/api/profile** — ❌ 缺失（事件计数 SQL 直查无测试；profile 空态返回未测试）
- [ ] **端到端：/announcements UI** — ❌ 缺失（P0-001 若在 CI 里跑一遍 e2e 会立即失败）
- [ ] **回归：阶段 1–4 单测** — ✅ 481 例全绿，未被破坏

**关键缺陷：**
阶段 5 单测覆盖 repo 与 domain，但**完全跳过 API 层与 UI 层**，导致 P0-001 与 P1-001 两个致命缺陷在测试中完全不可见。这与阶段 4 pitfalls 第 3 条"mock 需集成验证"直接冲突——mock repo 层的字段/SQL 都通过，但没有一个用例真的去"发 HTTP 请求到 /api/announcements GET"。

---

## 质量评估

| 维度 | 评级 | 说明 |
|---|---|---|
| 代码质量 | 良 | 领域层清晰、repo 层职责单一、命名规范；API 层输入校验略薄弱 |
| 功能完整性 | 差 | GET /api/announcements 缺失（P0），档案页/公告页不可达（P1），P5-003 回退鉴权失效（P1） |
| 幂等设计 | 优 | 三条写路径均通过 DB 条件更新保证幂等，遵循阶段 4 教训 |
| 可维护性 | 良 | 生成器骨架已就位（P2-003 有隐患）；契约文档与实现略有脱节 |
| 测试覆盖 | 中 | 481 单测覆盖 domain+repo，但 API/UI 层零覆盖，P0 级缺陷逃逸 |
| 与文档一致性 | 中 | dev-report 有 2 处声明与代码不一致（P3-001、P3-002）；.env.example 注释与实现矛盾（P1-001） |
| 硬约束遵循 | 良 | 契约不 bump、事件不含文案（运行期）、领域层零 next/react、MySQL 保持、无 git commit、无违规文案均达标 |

---

## 是否建议提交

**否**（P0/P1 未修复前不建议提交）。

**通过条件：**
1. **必须修复**（阻塞）：P0-001（追加 GET handler）
2. **强烈建议修复**（验收依赖）：P1-001（回退鉴权改为明确 501 或补 email_plain_enc 写入路径）、P1-002（增加导航入口使 /profile 与 /announcements 可达）
3. **本轮建议修复**：P2-003（生成器文案剥离，为阶段 6 铺路）、P2-004（marked 计数语义）、P3-001/P3-002（dev-report 校正）
4. **可延后到阶段 6**：P2-001、P2-002、P2-005、P3-003、P3-004、P3-005

**建议 Round 2 修复最小集（估算 1–2 小时工作量）：**
```
src/app/api/announcements/route.ts
  + export async function GET(req) { ... }     ← P0-001
  + 追加 ids 类型校验                            ← P3-004
  + marked 改为 counted = affected               ← P2-004

src/app/page.tsx
  + 首页 header 增补 <Link href="/profile"> 与 <Link href="/announcements">   ← P1-002

src/app/api/announcements/admin/route.ts
  - 移除"回退到 email_plain_enc 匹配"分支
  + 若 HUB_ADMIN_TOKEN 未配置则返回 501 并附明确错误信息                       ← P1-001

.env.example
  - 修正 HUB_ADMIN_TOKEN 注释，明确必须配置

src/domain/events/generators/announcement.ts
  - params 移除 announcement_title / announcement_body                        ← P2-003
```

---

## 签名

质检：2026-09-10
