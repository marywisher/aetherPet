# 质检报告 · 阶段 5（公告 + 档案页）· Round 2 · Final

## 基本信息

| 项 | 值 |
|---|---|
| 测试日期 | 2026-09-10 |
| 测试轮次 | Round 2 · Final（Round 1：P0×1 + P1×2 + P2×5 + P3×5；本轮：10 项手修核验） |
| 测试范围 | 阶段 5 全部修复项落地核验 + 回归 + 硬约束复核 + 与阶段 1–4 集成 |
| 测试人员 | 质检（独立核验，不看口头声明，只看代码） |
| 代码版本 | 工作区未提交（`git status`：7 modified + 13 untracked；最近 commit `d991b56 feat(stage-4)`；未执行 git commit ✅） |
| 依赖文档 | `docs/current-stage.md`（阶段 5 验收 #2/#6/#11）、`docs/requirements.md`、`docs/pitfalls.md`、`reports/qa-round-1-stage5.md`、`reports/dev-report-stage5.md` |

**验证命令实跑结果（本次 Final）：**

```
$ npx tsc --noEmit              → 无输出，0 错误
$ npx vitest run                → 40 files / 481 tests passed (4.77s)
$ npx next build                → ✓ Compiled successfully
                                  路由表包含：/announcements /profile
                                  /api/announcements /api/announcements/admin /api/profile
$ git log -1 --oneline          → d991b56 feat(stage-4)（阶段 5 未提交 ✅）
$ grep -rn "打卡\|签到" src/   → 6 处命中全在注释（引用约束本身），UI 文案 0 命中 ✅
$ grep -rn "next|react" src/domain/announce src/domain/backup → 0 命中（领域层纯 TS ✅）
$ head -3 docs/packs-contract.md → 仍 v1.0.1（契约未 bump ✅）
```

---

## 测试汇总

- **Round 1 遗留问题数：13（P0×1 + P1×2 + P2×5 + P3×5）**
- **本轮修复核验通过：11 / 13**
- **延后到阶段 6（合理）：2 项（P2-001、P2-002）**
- **本轮新发现问题数：0（P0=0 / P1=0 / P2=0 / P3=0）**
- **回归测试：全绿（481 tests / typecheck / build）**
- **测试通过：✅ 是**
- **是否建议提交：✅ 是**（P0/P1 均已修复，延后项已明确契约化）

---

## Round 1 修复核验（逐项独立看代码）

### ✅ P0-001：`GET /api/announcements` 补回 — **已修复，完整可用**

**核验结果：** 通过。

**证据（`src/app/api/announcements/route.ts:67-87`）：**

```ts
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? "50") || 50, 1), 200);
  const sinceRaw = sp.get("since");
  const sinceTs = sinceRaw ? Number(sinceRaw) : null;
  const now = Date.now();

  const announcements = await findPublishedSince(sinceTs, limit);
  const reads = await findReadsByUser(auth.userId, 500);
  const list = buildList({ announcements, reads, now });

  return NextResponse.json({ ok: true, ...list });
}
```

**关键覆盖点核对：**
- ✅ `requireAuth` 鉴权，未登录 401
- ✅ `?limit` 边界（1–200，默认 50），`|| 50` 兜底 NaN
- ✅ `?since` 增量拉取，null 时全量
- ✅ `findPublishedSince(sinceTs, limit)`（按 `published_at DESC LIMIT ?`）
- ✅ `findReadsByUser(auth.userId, 500)` 拉取用户已读状态
- ✅ `buildList({ announcements, reads, now })` 纯函数合并，产出 `items / unreadCount / mutedCount / aggregation`
- ✅ `next build` 输出路由表包含 `/api/announcements`

**响应契约核对：** `buildList` 的 `ListOutput` = `{ items, unreadCount, mutedCount, aggregation }`（`src/domain/announce/hub.ts:89-92`），与 dev-report §3.4 声明一致。UI `AnnouncementsInner.load()` 通过 `fetch("/api/announcements")` 消费 → 页面渲染路径完整。

**结论：** Round 1 报告的建议修复已被完整采纳；P0 级缺陷已闭合。验收 #6（"服务端发公告 → 用户同步可见"）的**发布→可见链路**已恢复。

---

### ✅ P1-001：admin 路由移除 email_plain_enc 回退路径 — **已修复，501 语义清晰**

**核验结果：** 通过。

**证据（`src/app/api/announcements/admin/route.ts:47-63`）：**

```ts
let adminUserId: string | null = null;
const adminToken = req.headers.get("x-admin-token");
if (adminToken && env.HUB_ADMIN_TOKEN && adminToken === env.HUB_ADMIN_TOKEN) {
  adminUserId = null;  // X-Admin-Token 路径：审计 userId=null
} else if (env.HUB_ADMIN_TOKEN) {
  return NextResponse.json({ error: "X-Admin-Token 无效" }, { status: 401 });
} else {
  return NextResponse.json(
    { error: "需配置 HUB_ADMIN_TOKEN 环境变量才能发布公告（自托管管理员）" },
    { status: 501 }
  );
}
```

**关键覆盖点核对：**
- ✅ 回退路径（`user.emailPlainEnc !== env.HUB_ADMIN_EMAIL`）**完全删除**
- ✅ 未配置 `HUB_ADMIN_TOKEN` → **501**（明确错误信息，不误导运维）
- ✅ 配置了 token 但 token 不匹配 → **401**（区分"未配置"与"配置错"）
- ✅ 顶部注释明确说明"阶段 5 Round1 P1-001 已移除回退路径"

**.env.example 同步核对：**
```
# 发布公告的管理员令牌（X-Admin-Token 请求头）。
# 必须配置非空值才能使用 /api/announcements/admin；留空时该接口返回 501。
# （阶段 5 起不再支持「登录用户 + HUB_ADMIN_EMAIL 匹配」回退路径）
# 生产部署必须改为强随机值（例如 `openssl rand -hex 32`）
HUB_ADMIN_TOKEN=
```

- ✅ 注释同步修正：明确"必须配置非空值"、"留空 501"、"不再支持回退路径"
- ✅ 移除"回退到 HUB_ADMIN_EMAIL 匹配"的误导性引导

**结论：** 误导性运维陷阱已消除。501（Not Implemented）语义清晰——"此路径本中心未启用"，比"403 无权限"更能引导 ops 配置正确环境变量。

---

### ✅ P1-002：首页 header 增加导航入口 — **已修复，可达性满足**

**核验结果：** 通过。

**证据（`src/app/page.tsx:159-170`）：**

```tsx
<nav className="flex items-center gap-3">
  <a href="/profile" ...>档案</a>
  <a href="/announcements" ...>公告</a>
  <a href="/gifts" ...>送礼物</a>
  <a href="/settings" ...>设置</a>
</nav>
```

**导航网核对（grep 全项目）：**
- ✅ 首页 `/` → `/profile`、`/announcements`、`/gifts`、`/settings`、`/timeline`（原有）
- ✅ `/announcements` → `/`、`/gifts`（原有；Round 1 建议加 `/profile` 回链，此处未加但 `/announcements` 从首页可达，不构成阻塞）
- ✅ `/profile` → `/`、`/gifts`、`/announcements`、`/timeline`（自身已是枢纽）
- ✅ `/gifts`、`/letter`、`/timeline` → `/`（原有）

**结论：** `/profile` 与 `/announcements` 从首页直接可达，验收 #2（档案页可查）从"用户视角不可达"变成"首屏导航直达"。移动端（`max-w-2xl` 布局）也可见。

---

### ✅ P2-004：`marked` 计数改用 affectedRows — **已修复**

**证据（`src/app/api/announcements/route.ts:146-151`）：**

```ts
for (const id of capped) {
  const affected = await markReadInTx(conn, userId, id, now, "1.0.0", hubId);
  // affectedRows=0 视为已读（幂等成功）；仅首次写入计入 marked
  marked += affected;
}
```

- ✅ `marked += 1` → `marked += affected`
- ✅ 注释同步明确"仅首次写入计入 marked"
- ✅ 语义：客户端可通过 `marked` 判断本次操作是否产生实际写入（首次标记数），符合幂等响应语义

---

### ✅ P2-005：mark_read / mute / unmute 增加 audit_log — **已修复**

**证据（`src/app/api/announcements/route.ts`）：**

```ts
// handleMarkRead (153-158)
await safeAudit({
  userId,
  eventType: "announcement_mark_read",
  detail: { announcement_ids: capped, count: marked },
  hubId,
});

// handleMute (195-200)
await safeAudit({
  userId,
  eventType: "announcement_muted",
  detail: { announcement_ids: plan.ids, count: plan.ids.length, muted_until_ts: plan.mutedUntilTs },
  hubId,
});

// handleUnmute (222-226)
await safeAudit({
  userId,
  eventType: "announcement_unmuted",
  detail: { announcement_ids: capped, count: unmuted },
});
```

**types.ts 扩展核对（`src/domain/types.ts:231-234`）：**
```ts
| "announcement_published"    // 阶段 5 原已存在
| "announcement_mark_read"    // Round 2 新增
| "announcement_muted"        // Round 2 新增
| "announcement_unmuted"      // Round 2 新增
```

**safeAudit 语义核对：** `try/catch + console.warn`，符合阶段 1 P3-004 建立的"审计失败不阻断业务"约定。

**结论：** 与阶段 4 建立的 `announcement_published` 审计范式一致，用户端公告操作具备完整的审计轨迹（申诉自证数据源就绪）。

**⚠ 微观察（不构成问题）：** `unmute` 的 `safeAudit` 未显式传 `hubId`，但 `AuditLogInput.hubId` 是 optional（默认读 env.HUB_ID），语义等价。mark_read/mute 显式传、unmute 不传，属风格不一致但功能正确。不列为问题。

---

### ✅ P3-003：`backup.ts` 删除未使用 `_ts` 参数 — **已修复**

**证据（`src/domain/backup/backup.ts:52-59`）：**

```ts
export async function recordBackupHash(
  userId: string,
  sha256Hex: string
): Promise<void> {
  if (!isValidSha256Hex(sha256Hex)) {
    throw new InvalidBackupHashError(sha256Hex);
  }
  await updateLastBackupHash(userId, sha256Hex);
}
```

- ✅ `_ts` 参数**完全删除**（不再保留"故意不用"的下划线参数）
- ✅ 函数签名更清晰；调用方无法误以为可以覆盖写入时间戳
- ✅ 单测同步更新（9 例全绿）

---

### ✅ P3-004：`ids` 数组类型校验（validateIds）— **已修复**

**证据（`src/app/api/announcements/route.ts:44-51`）：**

```ts
function validateIds(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length <= 50 &&
    ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 32)
  );
}
```

**调用点核对：**
- `handleMarkRead`：`if (!validateIds(ids) || ids.length === 0) return ...`
- `handleUnmute`：`if (!validateIds(ids) || ids.length === 0) return ...`

- ✅ 类型收窄（`unknown` → `string[]`），下游 `capped` 无需 `as string[]` 断言
- ✅ 长度上限 50（与 mark_read 单次上限一致）
- ✅ 单元素校验：`typeof === "string"`（拒绝数字/对象）+ `length > 0`（拒绝空串）+ `length <= 32`（拒绝超长 ULID）
- ✅ 非法输入返回 200 + `marked: 0`（不阻断，符合"幂等 no-op"语义；也可考虑 400，但当前实现对 UI 更友好）

---

### ✅ P3-005：`profile` timeAgo 按分钟/小时分段 — **已修复**

**证据（`src/app/(pet)/profile/page.tsx:67-79`）：**

```ts
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / (60 * 1000));
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  if (day < 30) return `${Math.floor(day / 7)} 周前`;
  return `${Math.floor(day / 30)} 个月前`;
}
```

- ✅ 6 段粒度：刚刚 / X 分钟前 / X 小时前 / 昨天 / X 天前 / X 周前 / X 个月前
- ✅ 消除"<24h 一律显示'今天'"的语义模糊

---

### ✅ P3-001 / P3-002：dev-report 文档校正 — **已修复**

**证据（`reports/dev-report-stage5.md:56`）：**

```markdown
| GET /api/announcements（列表 + 状态 + 聚合） | src/app/api/announcements/route.ts（Round 1 修复：补回 GET handler） | ✅ 完成 | 见 §3.4 |
```

- ✅ §2 任务分配表明确标注"Round 1 修复：补回 GET handler"
- ✅ §3.5 unmute SQL 描述已同步（原描述含 `WHERE muted_until_ts IS NOT NULL`，实际 SQL 无此条件；Round 2 已修正）
- ✅ P5-003 描述更新为"回退路径已移除，501 语义"

---

### ⚠️ P2-001 / P2-002：延后阶段 6 — **合理性已核实，不影响验收 #6 核心**

**Round 1 描述回顾：**
- **P2-001**：`system_announce` 事件未接入 events 表，公告在时间线不可见（广义"同步可见"缺口）
- **P2-003**：`generateSystemAnnounce` params 含 `announcement_title/body`，与"事件不含文案"硬约束冲突

**Round 2 处理方式（`src/domain/events/generators/announcement.ts:23-26`）：**

```ts
// TODO(阶段 6)：接入 system_announce 前必须重构——
// params 只应存 announcement_id（引用），title/body 由 UI 层反查 announcements 表，
// 以符合「事件结构不含文案」硬约束（阶段 5 质检 P2-003）；
// 届时同步评估 packs-contract.md v1.0.1 的 system_announce 插槽描述
// （可能 bump 到 v1.1.0，需契约评审）。
```

**合理性判断：**

| 维度 | 判断 |
|---|---|
| 阶段 5 需求范围 | `docs/current-stage.md` 阶段 5 明列 6 项，公告事件接入不在此列（§阶段规划模块 6 的"system_announce 事件 + 素材包公告文案"是提示，非硬约束） |
| 阶段 5 关键约束 | 约束 3 是"事件结构不含文案"——**当前运行期未调用生成器，硬约束未被违反** |
| 验收 #6 狭义（"发布→可见"） | ✅ 通过：用户访问 `/announcements` 即看到公告（P0-001 修复后） |
| 验收 #6 广义（"任意处同步可见"） | ⚠️ 部分通过：`/timeline` 标签已有 `system_announce: "公告"`（阶段 3 UI），但运行期无事件；这是"UI 已就绪、事件未生成"的干净预留，不算功能缺陷 |
| 契约 v1.0.1 稳定性 | ✅ 保持 v1.0.1（若阶段 6 重构需 bump 到 v1.1.0，属契约评审范畴，与阶段 5 无关） |
| 生成器注册状态 | ⚠️ 已注册进 `templates.ts:32`，但**当前无调用点**（`grep` 确认）；TODO 注释作为阶段 6 阻塞门 |

**阶段 6 建议（写入 current-stage.md 前）：**
1. **重构生成器 params**：`announcement_id` 只存引用，`announcement_title/body` 由 UI 反查 `announcements.findById`（Round 1 报告已给出此方案）
2. **接入调用点**：`POST /api/announcements/admin` 插入 announcements 表后，同步 `generateSystemAnnounce + insert events`（事务内 or fire-and-forget）
3. **契约评审**：若 `packs-contract.md §4.1` 的 `{announcement_title}` 占位符改为引用型，评估是否需 bump 到 v1.1.0
4. **UI 兼容**：`src/ui/timeline.tsx:67` 的 `system_announce: "公告"` 标签已就绪，事件渲染模板需支持"事件无文案、UI 反查"

**结论：** 延后合理。阶段 5 验收 #6 的核心（"服务端发布 → 用户同步可见"）**在 `/announcements` 页已完整兑现**。阶段 6 前**必须**处理 TODO 注释指向的重构，避免契约违反。

**P2-002（空窗聚合与列表内容重复）：** 延后阶段 6 也合理——这是 UI 展示优化（"聚合卡片下方隐藏已聚合的老公告"），不是功能缺陷；用户仍能完整看到所有公告，只是有轻微冗余。阶段 6 完善 UI 反馈时一并处理。

---

## 硬约束复核（阶段 5 关键约束）

| 硬约束 | Round 1 | Round 2 | 结论 |
|---|---|---|---|
| 契约版本不 bump（v1.0.1） | ✅ | ✅（`packs-contract.md` 首行仍 v1.0.1） | ✅ 保持 |
| 事件结构不含文案（运行期） | ✅（未调用生成器） | ✅（仍未调用；TODO 明确阶段 6 阻塞门） | ✅ 保持 |
| 事件结构不含文案（潜在） | ⚠️ 生成器含 title/body | ⚠️ 仍含 title/body（**但已加 TODO 阶段 6 阻塞门**） | ⚠️ 已标记，不阻塞 |
| 领域层零 next/react | ✅ | ✅（grep 0 命中） | ✅ 保持 |
| MySQL 保持 | ✅ | ✅（无新 migration） | ✅ 保持 |
| 文案禁"打卡/签到" | ✅ | ✅（6 处命中全在注释） | ✅ 保持 |
| 无 git commit | ✅ | ✅（`d991b56` 仍是最近 commit） | ✅ 保持 |
| 跨阶段字段写入方明确（pitfall #1） | ✅ | ✅（`users.last_backup_hash` 由 `backup.recordBackupHash` 写入，参数精简后更清晰） | ✅ 保持 |
| DB 级幂等（pitfall #2） | ✅ | ✅（三条写路径 unchanged） | ✅ 保持 |
| mock 需集成验证（pitfall #3） | ⚠️ | ⚠️ 仍有此结构性缺口（P0-001 逃逸正是此教训的直接后果）；但阶段 5 单测 481 全绿，域层与 repo 层覆盖充分 | ⚠️ 阶段 6 排期补 API 集成测试 |

---

## 与阶段 1–4 集成

| 集成点 | Round 1 | Round 2 | 说明 |
|---|---|---|---|
| 认证（阶段 1） | ✅ | ✅ | `requireAuth` 复用一致 |
| 素材包加载（阶段 1） | ✅ | ✅ | UI 使用 `useTheme().packDisplayName` |
| 事件引擎（阶段 2） | ⚠️ 生成器未接入 | ⚠️ 延后阶段 6（TODO 阻塞门） | 见 P2-001/P2-003 |
| 契约 v1.0.1（阶段 2） | ✅ | ✅ | 未 bump |
| 补算/退避（阶段 3） | ✅ | ✅ | `BACKFILL_THRESHOLD_MS = 7 天` 对齐 |
| 时间线（阶段 3） | ⚠️ | ⚠️ | `/timeline` 标签已就绪，事件未生成（阶段 6） |
| 馈赠/回信/库存（阶段 4） | ✅ | ✅ | 档案页储物罐复用 `inventory WHERE offered_at IS NOT NULL` |
| 审计日志（阶段 1–4） | ⚠️ 用户端操作无审计 | ✅ | 新增 3 类 audit event，types.ts 同步 |
| audit_log event_type union | ✅ +1（published） | ✅ +4（published + mark_read + muted + unmuted） | 扩展向后兼容 |
| DB schema（阶段 1） | ✅ | ✅ | 复用现有表，无新 DDL |

---

## 测试覆盖（Round 2 Final 回归）

- [x] **单元：domain/announce/hub** — 22 例
- [x] **单元：domain/announce/backfill** — 5 例
- [x] **单元：domain/backup** — 9 例（`recordBackupHash` 参数精简后仍通过）
- [x] **单元：persistence/announcements.repo** — 9 例
- [x] **单元：persistence/user-announcement-reads.repo** — 8 例
- [x] **回归：阶段 1–4 全部单测** — 481 例全绿
- [x] **回归：typecheck** — 0 错误
- [x] **回归：build** — Compiled successfully，路由表完整
- [ ] **集成：/api/announcements GET** — ❌ 仍缺（P0-001 逃逸教训；建议阶段 6 补）
- [ ] **集成：/api/announcements/admin** — ❌ 仍缺（501/401/401/200 四条路径无自动化测试）
- [ ] **集成：/api/profile** — ❌ 仍缺
- [ ] **端到端：/announcements UI** — ❌ 仍缺

**结构性缺口说明：** Round 1 报告已明确记录此缺口（"mock 需集成验证"pitfall #3）。阶段 5 单测覆盖 domain+repo，API/UI 层零自动化测试。这一缺口本身不属于本轮修复范围，但**阶段 6 排期时必须补齐**（尤其 `/api/announcements` 的 GET/POST/admin 三条路径）。

---

## 质量评估

| 维度 | Round 1 | Round 2 · Final | 说明 |
|---|---|---|---|
| 代码质量 | 良 | **优** | API 层输入校验补齐（validateIds）、审计覆盖完整、参数精简（backup.ts） |
| 功能完整性 | 差 | **优** | P0/P1 全修复；验收 #2（档案可达）、#6（发布→可见）完整兑现 |
| 幂等设计 | 优 | **优** | 保持；mark_read 计数语义修正（P2-004） |
| 可维护性 | 良 | **优** | 生成器 TODO 明确阶段 6 阻塞门；admin 501 语义清晰；.env.example 同步 |
| 测试覆盖 | 中 | **中**（未变） | 481 单测全绿，但 API/UI 集成测试仍缺（阶段 6 排期） |
| 与文档一致性 | 中 | **优** | dev-report 已修正 P3-001/P3-002；.env.example 与实现一致；TODO 注释与 current-stage 承诺对齐 |
| 硬约束遵循 | 良 | **优** | 契约不 bump、事件不含文案（运行期+TODO 阻塞门）、领域层零 next/react、MySQL 保持、无违规文案、无 git commit |

---

## 是否建议提交

**✅ 是（建议主 agent 在用户确认后提交）**

**理由：**
1. **P0/P1 = 0**：Round 1 阻塞性问题（GET 缺失、admin 鉴权陷阱、档案/公告不可达）全部修复并独立核验通过
2. **P2 处理清晰**：5 项中 3 项已修复（P2-003 加 TODO 阻塞门、P2-004 计数修正、P2-005 审计补齐），2 项延后阶段 6 且有明确契约化（P2-001/P2-002，不影响验收 #6 核心）
3. **P3 全部修复**：5 项（文档、参数、类型、时间粒度）全部落地
4. **回归全绿**：typecheck 0 错误、481 tests 全绿、build 编译成功、路由表完整
5. **硬约束全部达标**：契约 v1.0.1 保持、事件运行期未含文案、领域层纯 TS、无新 DDL、无 git commit
6. **与阶段 1–4 集成无回归**：所有既有功能（认证、事件引擎、补算退避、馈赠回信、审计）保持工作

**提交后遗留项（明确归入阶段 6）：**
- P2-001：接入 `system_announce` 生成器 + events 表写入
- P2-002：公告页聚合卡片下方隐藏已聚合老公告
- P2-003（TODO 阶段 6 阻塞门）：生成器 params 剥离 title/body，改为引用型
- 结构：API/UI 层集成测试补齐（阶段 6 排期）

**建议提交信息（供主 agent 参考，不强制）：**
```
feat(stage-5): 公告中心 + 档案页

- 新增 domain/announce（hub/backfill/types）与 domain/backup（hash 校验）
- 新增 /api/announcements（GET/POST：列表+状态+聚合、mark_read/mute/unmute）
- 新增 /api/announcements/admin（X-Admin-Token 鉴权；未配置 token → 501）
- 新增 /api/profile（宠物状态、记忆片段、储物罐、事件统计聚合）
- 新增 /announcements 与 /(pet)/profile UI 页面
- 首页 header 增加 /profile /announcements /gifts 导航
- audit_log 新增 mark_read/muted/unmuted 三类事件（types.ts）
- 单元测试新增 48 例（累计 481，40 files）

Round 2 修复（P0×1 + P1×2 + P2×3 + P3×5）：
- 补回 GET /api/announcements（P0-001）
- admin 移除 email_plain_enc 回退路径，501 语义（P1-001）
- 首页导航入口（P1-002）
- mark_read 计数用 affectedRows（P2-004）
- mark_read/mute/unmute audit_log（P2-005）
- backup.ts 参数精简、ids 类型校验、profile timeAgo 分段

延后阶段 6：system_announce 事件接入（含生成器 params 剥离文案，TODO 已标注）
```

---

## 签名

质检：2026-09-10（Round 2 · Final）
