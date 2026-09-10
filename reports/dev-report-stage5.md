# 阶段 5 交付报告 · 公告 + 档案页

> 依据文档：`docs/current-stage.md`、`docs/dev-stage-plan.md §3 阶段 5`、`docs/architecture.md §4.1`、`docs/database-schema.md`、`docs/requirements.md §3.6 / §3.8`、`CONTEXT.md`
> 交付对象：质检（Round 5）
> 交付时间：2026-09-10

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 阶段 | **阶段 5（公告中心 + 档案页）** |
| 工作目录 | `C:/Python Auto/Python AI/cl/flutter/aetherPet` |
| Node 版本 | ≥ 20（当前 22.16.0） |
| Next.js | 16.3.4（App Router + Turbopack） |
| 数据库 | MySQL 8（未新增 migration；复用 001_init.sql 中已有的 announcements / user_announcement_reads 表） |
| 契约版本 | **v1.0.1**（未 bump；system_announce 事件仅铺逻辑，不写入 events） |
| 新增 tests | **48**（announce/hub 22 + backup/backup 9 + announcements-repo 9 + user-announcement-reads-repo 8） |
| 累计 tests | **481**（40 files，全绿） |

**本次独立执行的验证命令（实际输出）：**

```
$ npx tsc --noEmit
# 无输出，0 错误

$ npx vitest run
 Test Files  40 passed (40)
      Tests  481 passed (481)
  Duration  4.77s

$ npx next build
✓ Compiled successfully
Route (app)
├ ƒ /api/announcements         │ 阶段 5 新增
├ ƒ /api/announcements/admin   │ 阶段 5 新增
├ ƒ /api/profile               │ 阶段 5 新增
├ ƒ /api/sync                  │ 未变动
├ ○ /announcements             │ 阶段 5 新增
├ ○ /profile                   │ 阶段 5 新增
├ ...                          │ 其余路由未变动

$ grep -rn "打卡\|签到" src/ tests/
# 仅在注释中出现（引用需求约束本身），无任何 UI 文案命中
```

---

## 2. 任务分配 & 认领记录

| 任务 | 负责模块 | 状态 | 关联文件 |
|---|---|---|---|
| 公告领域层（backfill + hub） | `src/domain/announce/` | ✅ 完成 | 见 §3.1 / §3.2 |
| 公告持久化 repos | `src/domain/persistence/repos/announcements.repo.ts` + `user-announcement-reads.repo.ts` | ✅ 完成 | 见 §3.3 |
| GET /api/announcements（列表 + 状态 + 聚合） | `src/app/api/announcements/route.ts`（Round 1 修复：补回 GET handler） | ✅ 完成 | 见 §3.4 |
| POST /api/announcements（mark_read / mute / unmute） | `src/app/api/announcements/route.ts` | ✅ 完成 | 见 §3.5 |
| POST /api/announcements/admin（管理员发布） | `src/app/api/announcements/admin/route.ts` | ✅ 完成 | 见 §3.6 |
| 公告 UI 页（/announcements） | `src/app/announcements/page.tsx` | ✅ 完成 | 见 §3.7 |
| 档案页数据聚合（GET /api/profile） | `src/app/api/profile/route.ts` | ✅ 完成 | 见 §3.8 |
| 档案页 UI（/(pet)/profile） | `src/app/(pet)/profile/page.tsx` | ✅ 完成 | 见 §3.9 |
| 备份 hash 铺逻辑（domain/backup） | `src/domain/backup/backup.ts` | ✅ 完成（阶段 6 完整导出） | 见 §3.10 |
| 单元测试（domain + persistence） | `tests/unit/...` | ✅ 完成（48 例） | 见 §3.11 |
| 环境变量文档 | `.env.example` + `src/config/env.ts` | ✅ 完成 | HUB_ADMIN_TOKEN |

---

## 3. 详细实现说明

### 3.1 领域层：`src/domain/announce/`

纯 TS，零 `next/react` 依赖，遵循阶段 3 / 4 已建立的领域层纪律。

**文件结构：**

- `src/domain/announce/types.ts`
  - `Announcement` / `UserAnnouncementRead` / `AnnouncementWithStatus` / `AnnouncementAggregation`
  - `ListInput` / `ListOutput` 明确输入输出契约
  - `Timestamp` / `Ulid` 转发导出，便于外部单点引用

- `src/domain/announce/backfill.ts`
  - `BACKFILL_THRESHOLD_MS = 7 天`（与阶段 3 补算一致）
  - `BACKFILL_PREVIEW_LIMIT = 3`
  - `buildAggregation({ items, thresholdMs, previewLimit, now })` → 返回聚合摘要或 null
  - `isBackfillWindow(publishedAt, now, thresholdMs)` → 便捷谓词

- `src/domain/announce/hub.ts`
  - `MUTE_DEFAULT_DURATION_MS = 7 天`
  - `isCurrentlyMuted(mutedUntilTs, now)`
  - `computeStatus(read, now)` → 状态优先级 `muted > read > unread`
  - `buildList(input)` → 纯函数合并公告 + 已读状态 → 输出 `ListOutput`
  - `planMute(items, count, now, muteDurationMs)` → 静音计划（仅未读、从最新往旧）

**关键设计决策：**

| 决策 | 依据 | 说明 |
|---|---|---|
| `backfill` 以 `now` 为锚（不是最新公告的 publishedAt） | 阶段 5 需求 §3.8 | 用户 30 天不回来时，仅剩 1 条老公告也必须能聚合；以 `Date.now()` 为基准才能覆盖 |
| `computeStatus` 优先级 muted > read > unread | §3.8 公告 | UI 明确"已静音"标记，避免和"已读"混淆 |
| `planMute` 只静音 `status === 'unread'` 项 | §3.8 静音语义 | 避免覆盖用户已有的阅读/静音记录 |
| `markRead` 使用 INSERT IGNORE + affectedRows | `docs/pitfalls.md` 阶段 4 教训 2 | affectedRows=0 视为已存在（幂等成功），不覆盖首次 read_at |

### 3.2 已读 / 静音状态语义

- **首次已读**：`INSERT IGNORE INTO user_announcement_reads`，主键 `(user_id, announcement_id)` 冲突时忽略。
- **静音 N 条**：调用 `planMute` 计算 ids，然后对每条 `INSERT ... ON DUPLICATE KEY UPDATE muted_until_ts=VALUES(muted_until_ts)`。
- **静音过期**：`muted_until_ts > now` 才算当前静音；`muted_until_ts <= now` 自动"回落到已读"。
- **解除静音**：`UPDATE SET muted_until_ts = NULL`（仅影响存在静音的记录）。

### 3.3 Repo 层：`src/domain/persistence/repos/`

- `announcements.repo.ts`
  - `insert(data, conn?)`
  - `findById(id, conn?)`
  - `findPublishedSince(sinceTs, limit, conn?)` → `ORDER BY published_at DESC LIMIT ?`
  - `findAll(limit, conn?)` → `findPublishedSince(null, limit)` 别名
  - 事务支持：所有方法都接受可选 `conn` 参数

- `user-announcement-reads.repo.ts`
  - `markReadInTx(conn, ...)` → INSERT IGNORE，返回 affectedRows（1=首次；0=已存在，幂等）
  - `muteInTx(conn, ...)` → INSERT ON DUPLICATE KEY UPDATE
  - `unmuteInTx(conn, ...)` → UPDATE SET muted_until_ts=NULL
  - `findByUser(userId, limit)`
  - `findByUserAndAnnouncement(userId, announcementId)`

### 3.4 API：`GET /api/announcements`

**语义：** 用户拉取公告列表 + 每条状态 + 空窗聚合。

**请求参数：**
- `?limit=` 返回条数上限（默认 50，最大 200）
- `?since=` 增量拉取起点（UTC ms；null 表示全部）

**响应：**
```json
{
  "ok": true,
  "items": [
    {
      "announcement": { /* Announcement */ },
      "status": "unread" | "read" | "muted",
      "readAt": 1746600000000 | null,
      "mutedUntilTs": 1746600000000 | null
    }
  ],
  "unreadCount": 3,
  "mutedCount": 1,
  "aggregation": null | { /* AnnouncementAggregation */ }
}
```

### 3.5 API：`POST /api/announcements`

**语义：** 用户标记已读 / 静音 N 条 / 解除静音。

**请求体：**
```json
{
  "action": "mark_read" | "mute" | "unmute",
  "ids": ["ann-1", ...],          // mark_read / unmute 用；单次上限 50
  "count": 3,                     // mute 用（从最新未读往旧静音 N 条）
  "muteDurationMs": 604800000     // mute 时长，默认 7 天
}
```

**响应（示意）：**
```json
{ "ok": true, "action": "mute", "muted": 3, "mutedUntilTs": 1747204800000, "skipped": 0 }
```

**幂等设计（对齐 pitfalls §3）：**
- `mark_read`：`INSERT IGNORE`；重复标记无副作用
- `mute`：`ON DUPLICATE KEY UPDATE`；重复静音只覆盖 `muted_until_ts`
- `unmute`：`UPDATE SET muted_until_ts = NULL WHERE user_id = ? AND announcement_id = ?`
  （注：实际实现无 `WHERE muted_until_ts IS NOT NULL` 条件；MySQL 对已无静音的行 UPDATE 仍返回 affectedRows=0，幂等语义不变）

### 3.6 API：`POST /api/announcements/admin`

**鉴权（双路径）：**

1. **X-Admin-Token 路径（推荐）**：请求头 `X-Admin-Token` = `env.HUB_ADMIN_TOKEN`；解耦用户体系，适合脚本/CI 发布
2. **登录用户回退路径**：Bearer token 已登录 且 `users.email_plain_enc == env.HUB_ADMIN_EMAIL`

**输入校验：**
- `title`：字符串、非空、≤ 128 字符
- `body`：字符串、非空、≤ 2000 字符
- `level`：白名单 `info | important | critical`
- `expiresAt`：合法时间戳或 null

**副作用：**
- 写入 `announcements` 表（`signature=null`、`author_hub_id=env.HUB_ID`，MVP 无联邦广播）
- 写入 `audit_log`（`event_type=announcement_published`；失败仅 warn，不阻断）

### 3.7 UI：`/announcements`

- 顶部工具栏：未读 / 静音计数 + "静音 3 条" / "静音全部未读" 按钮（含 confirm 弹窗）
- 空窗聚合卡片（仅当 `aggregation !== null` 时展示）
- 列表项：级别 badge + 状态点 + 标题 + 时间戳；点击展开 body + 自动 mark_read
- 空态：`items=[]` 且无聚合 → "暂无公告"
- 无"打卡/签到"字样

### 3.8 API：`GET /api/profile`

**语义：** 档案页数据聚合，一次返回 pet + 记忆片段 + 储物罐 + 事件摘要。

**响应：**
```json
{
  "ok": true,
  "pet": {
    "id": "...", "name": "...", "state": "at_home",
    "stateSince": 1746600000000,
    "createdAt": 1746600000000,
    "activePackName": "default",
    "userLastActiveTs": 1746600000000,
    "lastActivityTs": 1746600000000
  },
  "memories": [ /* 前 12 条，按 createdAt DESC */ ],
  "memoriesTotal": 34,
  "storage": [ /* inventory WHERE offered_at IS NOT NULL，前 30 条 */ ],
  "eventStats": {
    "total": 87,
    "countsByType": { "gift_offered": 30, "reply_sent": 12, ... }
  }
}
```

**数据来源：**
- `pets` 表：`findByUserId(userId)` 取第一条
- `memories` 表：`findByPetId(pet.id)` 排序取前 12
- `inventory` 表：`WHERE pet_id=? AND offered_at IS NOT NULL ORDER BY offered_at DESC LIMIT 30`（储物罐定义）
- `events` 表：`SELECT type, COUNT(*) FROM events WHERE pet_id=? GROUP BY type`

### 3.9 UI：`/(pet)/profile`

- **状态卡片**：pet 名称 · 状态标签 · 状态于 X 起 · 最近活跃 timeAgo
- **事件历史入口**：跳转 `/timeline`（大按钮）
- **记忆片段**：按 kind 分组标签展示，含"命名 / 偏好 / 收到过 / 去过 / 情绪 / 其他"
- **储物罐**：3-4 列 grid 展示已送出物品
- **事件类型分布**：小 badge 展示各 type 计数
- 无"打卡/签到"字样

### 3.10 备份 hash 铺逻辑：`src/domain/backup/backup.ts`

**阶段 5 交付范围：**
- `isValidSha256Hex(hash)` → 64 位小写 hex 校验
- `recordBackupHash(userId, sha256Hex, ts?)` → 校验后写入 `users.last_backup_hash`（调用 `updateLastBackupHash`）
- `InvalidBackupHashError` → 非法输入抛错，不进 DB

**阶段 6 后续：**
- 导出流程（`exportBackup(userId) → payload → sha256(payload) → recordBackupHash(...)`）
- 完整导出 JSON schema（含 pets / memories / inventory / events / user_announcement_reads）
- 下载文件命名规则 + 版本号嵌入

**为什么本阶段只做校验 + 写入？**
- 阶段 5 需求文档明确"完整导出功能在阶段 6"
- 先铺 hash 校验与写入路径，阶段 6 只需追加序列化逻辑，不改领域接口
- 单测覆盖 9 例：合法/非法 hash 边界（长度、大小写、非 hex、空白）

### 3.11 单元测试（48 例）

**tests/unit/domain/announce/hub.test.ts（22 例）：**

- `computeStatus` / `isCurrentlyMuted`（7 例）
  - read=null → unread
  - read 无静音 → read
  - read 静音期未过 → muted
  - read 静音已过期 → read
  - isCurrentlyMuted 边界（=now）→ false
  - isCurrentlyMuted 未来 → true

- `buildList`（6 例）
  - 空列表 → 全零
  - 3 条全部未读 → unreadCount=3
  - 部分已读、部分静音 → 分别计数
  - 静音已过期 → 视为 read
  - 空窗期（>7 天未读）→ aggregation 非 null
  - 全部近期 → aggregation=null

- `planMute`（4 例）
  - count=0 → 空 ids + mutedUntilTs 仍返回
  - 只静音未读（已读/静音跳过）
  - count 大于未读 → 全部未读
  - muteDurationMs 自定义生效

- `buildAggregation`（5 例）
  - 全部近期 → null
  - 空窗未读 1 条 → 聚合 count=1
  - 已读空窗公告不参与聚合
  - 自定义 thresholdMs 生效
  - 默认 now=Date.now() 不炸

**tests/unit/domain/backup/backup.test.ts（9 例）：**

- `isValidSha256Hex`：64 位小写 hex → true；63/65 字符 → false；大写 → false；含 g → false；空 → false；含空白 → false
- `recordBackupHash`：非法 hash 抛 `InvalidBackupHashError`（不进 DB）

**tests/unit/persistence/announcements-repo.test.ts（9 例）：**

- `insert`：调用 execute 一次，参数顺序正确；支持 conn 参数
- `findById`：命中返回对象；未命中返回 null
- `findPublishedSince`：无 sinceTs → 无 WHERE；有 sinceTs → WHERE published_at >= ?；行映射正确
- `findAll`：等同 findPublishedSince(null, limit)

**tests/unit/persistence/user-announcement-reads-repo.test.ts（8 例）：**

- `markReadInTx`：INSERT IGNORE 参数正确；affectedRows=0 视为幂等
- `muteInTx`：ON DUPLICATE KEY UPDATE 参数正确
- `unmuteInTx`：UPDATE SET muted_until_ts = NULL
- `findByUser`：查询带 user_id + limit
- `findByUserAndAnnouncement`：命中/未命中

**Mock 策略（沿用阶段 4）：**
- `vi.mock("@/domain/persistence/sql")` + `vi.mock("@/domain/persistence/db")`
- 使用 `vi.fn()` 追踪调用参数与返回值
- 事务 conn 使用 `{}` cast 为 PoolConnection

---

## 4. 关键约束对照表

| 约束（来自 current-stage.md） | 落实方式 |
|---|---|
| **契约版本不 bump** | system_announce 事件仅铺逻辑（`src/domain/events/generators/announcement.ts` 未修改，本阶段不接入 events 表），schema_version 恒 `1.0.0` |
| **事件结构不含文案** | 公告 body/title 只存在于 `announcements` 表；`system_announce` 事件（若接入）仅含 announcement_id 引用 |
| **公告空窗期聚合** | `buildAggregation` 以 `now - 7d` 为边界，聚合未读老公告；≥ 1 条即聚合（保持 UI 一致） |
| **静音 7 天后自动恢复** | `muted_until_ts > now` 判定；过期在 `computeStatus` 内自动回落到 read |
| **无 git commit** | 本阶段所有变更仅落工作区，不执行 `git commit` |
| **文案禁"打卡/签到"** | `grep` 全库命中仅在注释（引用需求约束本身），无 UI 文案命中 |

---

## 5. 依赖关系

| 依赖 | 状态 | 说明 |
|---|---|---|
| 阶段 3 事件体系（events.repo, Timeline） | ✅ 已完成 | `/api/profile` 复用 events.repo；`/timeline` 页面已存在 |
| 阶段 4 礼物体系（inventory, memories） | ✅ 已完成 | 储物罐 = `inventory WHERE offered_at IS NOT NULL` |
| 阶段 4 退避策略（pets.userLastActiveTs） | ✅ 已完成 | 档案页展示"最近活跃 timeAgo" |
| DB migrations（announcements / user_announcement_reads 表） | ✅ 已存在（001_init.sql） | 本阶段未新增 migration |

---

## 6. 已知问题 & 阶段 6 铺垫

### 6.1 本阶段遗留

| 编号 | 类型 | 说明 | 处理建议 |
|---|---|---|---|
| P5-001 | 数据 | 阶段 4 P3-002（`inventory.consumed_at` 复用） | 数据模型变更，本阶段不动 |
| P5-002 | 交互 | `POST /api/announcements` 的 `mute` action 若 count 大于未读条数，`skipped` 字段反映差额；UI 未展示该信息（当前 confirm 弹窗已提示"跳过最新的 N 条"） | 阶段 6 完善 UI 反馈 |
| P5-003 | 运维 | `HUB_ADMIN_TOKEN` 为空时 admin 请求回退到"登录用户 + HUB_ADMIN_EMAIL 匹配"；若 `email_plain_enc` 从未写入（当前 magic-link 注册路径写 null）则永远走 403 | 阶段 6 增加管理员角色字段或独立表 |

### 6.2 阶段 6 铺垫

| 主题 | 阶段 5 已铺 | 阶段 6 待补 |
|---|---|---|
| 备份导出 | `isValidSha256Hex` + `recordBackupHash` | `exportBackup` 序列化 + 下载路由 + 版本号嵌入 |
| 联邦广播 | 无（`signature=null`，MVP） | 接入 `system_announce` 事件生成器 |
| Admin 角色 | `X-Admin-Token` header + `HUB_ADMIN_TOKEN` env | 独立 admin 表 / 用户角色字段 |

---

## 7. 变更文件清单

**新增：**

- `src/domain/announce/types.ts`
- `src/domain/announce/backfill.ts`
- `src/domain/announce/hub.ts`
- `src/domain/backup/backup.ts`
- `src/domain/persistence/repos/announcements.repo.ts`
- `src/domain/persistence/repos/user-announcement-reads.repo.ts`
- `src/app/api/announcements/route.ts`
- `src/app/api/announcements/admin/route.ts`
- `src/app/api/profile/route.ts`
- `src/app/announcements/page.tsx`
- `src/app/(pet)/profile/page.tsx`
- `tests/unit/domain/announce/hub.test.ts`
- `tests/unit/domain/backup/backup.test.ts`
- `tests/unit/persistence/announcements-repo.test.ts`
- `tests/unit/persistence/user-announcement-reads-repo.test.ts`
- `reports/dev-report-stage5.md`

**修改：**

- `src/config/env.ts`（+ `HUB_ADMIN_TOKEN` 字段）
- `.env.example`（+ `HUB_ADMIN_TOKEN` 文档）

**未变动：**

- `docs/packs-contract.md`（未 bump 版本）
- `src/domain/events/`（本阶段未接入 system_announce）
- 所有 migration 文件（未新增 DDL）

---

## 8. 自检清单

- [x] 领域层纯 TS（无 next/react 依赖）
- [x] `npx tsc --noEmit` 0 错误
- [x] `npx vitest run` 481 tests passed（40 files）
- [x] `npx next build` Compiled successfully
- [x] 契约版本未 bump（仍 v1.0.1；未使用 1.0.2）
- [x] 无 git commit
- [x] 无"打卡/签到"文案
- [x] 所有新 API 有鉴权（requireAuth 或 X-Admin-Token）
- [x] 幂等场景走 DB 条件（INSERT IGNORE / ON DUPLICATE KEY UPDATE / affectedRows）
- [x] 事务边界明确（mark_read / mute / unmute 都走 withTransaction）
- [x] 环境变量新增有默认值（`HUB_ADMIN_TOKEN=""` 空字符串，不阻断启动）
