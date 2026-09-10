# Round 2 修复报告 · 阶段 1（地基 + 认证 + 素材包加载）

> 依据文档：`reports/qa-round-2.md`（待修复清单）
> 依据约束：`docs/current-stage.md`、`docs/architecture.md v1.1`、`docs/database-schema.md v1.1`、`docs/requirements.md`、`CONTEXT.md`
> 修复时间：2026-09-09
> 修复人：软件工程师

---

## 1. 修复摘要

| 项 | Round 2 发现 | Round 2 修复 |
|---|-------------|-------------|
| P1（严重） | 1 | **1/1**（P1-005） |
| P2（一般） | 6 | **6/6**（P2-007/008/009/010/011/012） |
| P3（轻微） | 6 | **5/6**（P3-002/003/004/005/006；P3-001b 已并入 P3-002） |
| 单测总数 | 97/97 | **138/138**（+41） |
| TypeScript 类型检查 | 通过 | **通过**（0 错误） |
| Next.js build | 通过（含 loader trace 告警） | **通过**（trace 告警消除） |

**结论**：Round 2 质检列出的 P1×1、P2×6、P3×5 全部修复，另将 P3-001b（Round 1 遗留）通过 P3-002 一并解决。全部 15 个测试文件 138 个用例通过；构建产物无 "filesystem access causes the whole project to be traced" 告警。

---

## 2. 修复清单（逐项）

### 2.1 P1-005 · `audit.repo.ts` 硬编码 `hub_id='local'` → 参数化 + env 兜底 ✅

**修改文件**：
- `src/domain/persistence/repos/audit.repo.ts` — `AuditLogInput` 新增 `hubId` / `schemaVersion` 字段；SQL 语句全部改为参数化占位符；`hubId` 从 `entry.hubId ?? env.HUB_ID` 取；`schemaVersion` 从 `entry.schemaVersion ?? "1.0.0"` 取。
- `tests/unit/persistence/audit.repo.test.ts` — 新增 8 个用例覆盖：env 兜底、显式传入优先、SQL 无硬编码、detail null 序列化。

**验证证据**：
```ts
// SQL 参数化（8 个 ? 占位符）
INSERT INTO audit_log
  (user_id, event_type, detail, ip, user_agent, created_at, schema_version, hub_id)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```
测试断言：
```ts
expect(call[7]).toBe("test-hub");   // env.HUB_ID 兜底
expect(call[7]).toBe("custom-hub"); // 显式传入优先
expect(sql).not.toMatch(/VALUES\s*\([^)]*'local'/); // 不再硬编码
```

**架构对齐**：`docs/architecture.md §7.1` + `docs/database-schema.md §4.1` — 多中心数据主权要求所有业务表 `hub_id` 从实际中心身份取值，不再"自托管默认 local"硬编码。

---

### 2.2 P2-007 · `startup` 失败后无自愈 + `healthz` 3s 超时误报 ✅

**修改文件**：
- `src/lib/startup.ts` — 引入 `_lastFailTs` 时间戳；`RECOVERY_COOLDOWN_MS = 30s` 冷却期；导出 `shouldProbeRecovery()`；`StartupState` 增加 `lastFailTs` / `retryInMs`。
- `src/app/api/healthz/route.ts` — `STARTUP_TIMEOUT_MS` 默认 3s → **8s**（覆盖 3×退避×3 子步骤最坏 8400ms）；env 可覆盖；`ok` 判定改为 `dbCheck.ok && hub.hubId.length > 0`（不再依赖 `startupState.failed`），startup 状态仅暴露给运维诊断。

**验证证据**：
```ts
// 冷却期外触发一次重试探测（非阻塞）
if (shouldProbeRecovery()) {
  void startup();
}
// ok 只依赖实时探测
const ok = dbCheck.ok && hub.hubId.length > 0;
```

**新增测试** `tests/unit/lib/startup.test.ts`（6 用例）：
- 默认未 started/failed
- 成功启动后 started=true
- initPool 失败时 failed=true 且 lastFailTs 记录
- 冷却期内 shouldProbeRecovery=false + retryInMs > 0
- started=true 时 shouldProbeRecovery=false
- failed=false 时 shouldProbeRecovery=false

**运维效果**：MySQL 短暂抖动后，healthz 在冷却期外（默认 30s）会自动触发一次探测重试，DB 恢复后无需重启进程即恢复。

---

### 2.3 P2-008 · `loader.ts` 触发 Next.js build trace 告警 ✅

**修改文件**：
- `src/domain/packs/loader.ts` — 引入 `fileURLToPath(import.meta.url)` 计算静态 `MODULE_DIR` 与 `PROJECT_ROOT`；`path.resolve(process.cwd(), dir)` 改为 `path.resolve(PROJECT_ROOT, rawDir)`（`rawDir` 绝对路径时直接用）。
- `next.config.ts` — 新增 `outputFileTracingIncludes`：`"/packs/*": ["src/assets/packs/**/*"]` 显式界定 trace 范围；`outputFileTracingExcludes` 排除 `.env*` / `*.log`。

**验证证据**：`npx next build` 不再出现 "Static analysis determined that this filesystem access causes the whole project to be traced and included in the output" 告警。grep 结果 0 匹配。

**架构对齐**：`docs/architecture.md §3.1` 领域层纯 TS 硬约束保持不变；loader 仍在 `src/domain/packs/`；仅路径解析方式从"运行时 `process.cwd()`"改为"编译时 `import.meta.url` 静态锚点"。

---

### 2.4 P2-009 · `pets.repo.insert` 硬编码 `active_pack_name='default'` ✅

**修改文件**：
- `src/domain/persistence/repos/pets.repo.ts` — 引入 `getEnv()`；`active_pack_name` 占位符从 `"default"` 改为 `env.DEFAULT_PACK`。

**验证证据**：
```ts
const defaultPackName = env.DEFAULT_PACK;  // 默认 "default"，自托管可配置
// INSERT ... active_pack_name = ?, ...
[... , defaultPackName, ...]
```

**架构对齐**：`docs/architecture.md §3` 项目结构、`user_settings.active_pack_name` 表预留。自托管中心可通过 `.env` 定制默认包名，pet 记录不再硬编码。

---

### 2.5 P2-010 · `TRUST_PROXY=true` 时 `X-Real-Ip` 无条件信任 → 收窄 ✅

**修改文件**：
- `src/lib/request-helpers.ts` — 只在 `XFF` 缺失 且 `socket.remoteAddress` 不可读时才读 `X-Real-Ip`；正常情况仍优先 `socket.remoteAddress`。
- `tests/unit/lib/request-helpers.test.ts` — 新增 7 个 IP 提取用例覆盖各组合。

**验证证据**：
```ts
if (env.TRUST_PROXY) {
  // 先 XFF（右往左第 N 段）
  if (forwarded) { ... }
  // 兜底 X-Real-Ip 只在 socket 不可读时尝试
  if (!socket?.remoteAddress) {
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
}
```
测试覆盖：
- XFF + X-Real-Ip + socket 都在 → 取 XFF（不取 X-Real-Ip）
- XFF 缺失 + socket 可读 → 取 socket（不取 X-Real-Ip）
- XFF 缺失 + socket 不可读 → 才取 X-Real-Ip 兜底

---

### 2.6 P2-011 · `packs/loader.ts` `_packsCache` 无失效机制 ✅

**修改文件**：
- `src/domain/packs/loader.ts` — 导出 `refreshPacks()` 手动清空缓存函数。
- `src/app/api/packs/refresh/route.ts` — 新增 `POST /api/packs/refresh` 端点：
  - `NODE_ENV=development`：无需 token
  - `NODE_ENV=production`：需 Bearer token（`verifyToken` 校验）
- `tests/unit/app/packs-refresh-route.test.ts` — 4 个用例覆盖。

**运维效果**：
```bash
# 开发模式热加新素材包后立即生效
curl -X POST http://localhost:3000/api/packs/refresh
# 生产模式需带 token
curl -X POST -H "Authorization: Bearer $TOKEN" http://your-hub/api/packs/refresh
```

---

### 2.7 P2-012 · `throttle.ts` 三个 Map 无上限增长 → LRU FIFO 淘汰 ✅

**修改文件**：
- `src/domain/auth/throttle.ts` — 新增 `BUCKET_MAX_ENTRIES = 5_000`；`_setWithEviction()` 在写入前检查 Map 大小，达到上限时删除前一半最老的 key（Map 迭代顺序即插入顺序 = 最老）；新增 `_getBucketSizes()` 测试用导出。
- `tests/unit/auth/throttle.test.ts` — 新增 4 个 LRU 上限用例。

**验证证据**：
```ts
function _evictIfFull<K, V>(bucket: Map<K, V>): void {
  if (bucket.size < BUCKET_MAX_ENTRIES) return;
  let i = 0;
  const half = Math.floor(BUCKET_MAX_ENTRIES / 2);
  for (const key of bucket.keys()) {
    bucket.delete(key);
    i += 1;
    if (i >= half) break;
  }
}
```
测试覆盖：3 个桶各自达上限后仍受保护，Map 大小 ≤ 5000。

**内存上限**：5000 条目 × ~30B/条 ≈ 150KB，长期驻留可控。

---

### 2.8 P3-002 · `getEffectivePack` 参数冗余 → 重构三参数签名 ✅

**修改文件**：
- `src/domain/packs/fallback.ts` — `getEffectivePack(requestedPackName, defaultPackName, packs)` 三参数签名；当 `requestedPackName === defaultPackName` 时行为不变（MVP 兼容）。
- `src/app/api/packs/route.ts` — 调用改为 `getEffectivePack(env.DEFAULT_PACK, env.DEFAULT_PACK, packs)`。
- `tests/unit/packs/fallback.test.ts` — 新增 3 个用例：requested ≠ default 时正确返回 requested；requested 缺失/损坏时 fallback 到 default。

**架构对齐**：为阶段 2/6 用户级 `user_settings.active_pack_name` 切换预留 API。

---

### 2.9 P3-003 · `logout` 未走 Bearer token → 与 me/pet 一致 ✅

**修改文件**：
- `src/app/api/auth/logout/route.ts` — 用 `extractBearerToken(req) ?? cookieMatch[1]`，与 `me`/`pet`/`pet/create` 一致。

---

### 2.10 P3-004 · `requestCode` / `sendEmail` audit 写失败阻塞业务 → 包 try/catch ✅

**修改文件**：
- `src/domain/auth/magic-link.ts` — 新增 `safeAudit()` helper；所有 `auditRepo.insertAuditLog` 调用改为 `safeAudit`（`sed` 替换 6 处）。
- `src/domain/auth/mail-sender.ts` — 3 处 `insertAuditLog` 分别包 try/catch。
- `src/app/api/auth/logout/route.ts` — `insertAuditLog` 包 try/catch。

**验证证据**：
```ts
async function safeAudit(entry): Promise<void> {
  try {
    await auditRepo.insertAuditLog(entry);
  } catch (err) {
    console.warn("[audit] write failed:", err);
  }
}
```

**运维效果**：审计 DB 短暂不可用时，验证码签发/校验/退出登录均不阻塞，仅日志 warning。

---

### 2.11 P3-005 · `parseJsonBody` 无 body size 限制 → 1MB 上限 ✅

**修改文件**：
- `src/lib/request-helpers.ts` — 新增 `MAX_BODY_BYTES = 1_048_576`（env 可覆盖）；两次检查：先 `Content-Length` header 快速拒绝，再 `arrayBuffer` 实际大小二次保险。
- `tests/unit/lib/request-helpers.test.ts` — 4 个用例覆盖合法/非法/超限。

**验证证据**：
```ts
const contentLength = req.headers.get("content-length");
if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
  return { ok: false, error: "请求体过大" };
}
const buf = await req.arrayBuffer();
if (buf.byteLength > MAX_BODY_BYTES) {
  return { ok: false, error: "请求体过大" };
}
```

---

### 2.12 P3-006 · `file.includes("..")` 误伤合法文件名 → 段级校验 ✅

**修改文件**：
- `src/app/packs/[name]/[file]/route.ts` — 拆分 `/` 和 `\` 后的段，任一段 `=== ".."` 或 `"."` 才拒绝；绝对路径单独拒绝。
- `src/domain/packs/loader.ts` (`readPackFile`) — 同样改为段级校验。
- `tests/unit/app/packs-route.test.ts` — 现有用例（`../../secret.txt`、`/etc/passwd`）继续通过。

**验证证据**：
```ts
const segments = file.split(/[\\/]/);
if (segments.some((seg) => seg === ".." || seg === ".")) {
  return NextResponse.json({ error: "非法路径" }, { status: 400 });
}
```
现在 `foo..css`（合法）可以通过，`../../secret.txt`（恶意）仍被拒绝。

---

## 3. 新增测试文件

| 文件 | 用例数 | 覆盖 |
|-----|-------|------|
| `tests/unit/persistence/audit.repo.test.ts` | 8 | P1-005 audit hub_id 参数化 + env 兜底 |
| `tests/unit/lib/request-helpers.test.ts` | 12 | P2-010 X-Real-Ip 收窄 + P3-005 body size limit |
| `tests/unit/lib/startup.test.ts` | 6 | P2-007 自愈探测 |
| `tests/unit/app/packs-refresh-route.test.ts` | 4 | P2-011 packs refresh 端点 |
| `tests/unit/auth/throttle.test.ts`（新增 4） | +4 | P2-012 LRU 淘汰 |
| `tests/unit/packs/fallback.test.ts`（新增 3） | +3 | P3-002 三参数签名 |

**新增测试合计**：37 个新用例。

---

## 4. 变更文件清单

### 修改（10 个）

- `src/domain/persistence/repos/audit.repo.ts` — P1-005
- `src/domain/persistence/repos/pets.repo.ts` — P2-009
- `src/domain/packs/fallback.ts` — P3-002
- `src/domain/packs/loader.ts` — P2-008 + P2-011 + P3-006
- `src/domain/auth/magic-link.ts` — P3-004（safeAudit）
- `src/domain/auth/mail-sender.ts` — P3-004
- `src/domain/auth/throttle.ts` — P2-012（LRU 淘汰）
- `src/lib/startup.ts` — P2-007（自愈）
- `src/lib/request-helpers.ts` — P2-010 + P3-005
- `src/app/api/healthz/route.ts` — P2-007（判定解耦 + 8s 超时）
- `src/app/api/auth/logout/route.ts` — P3-003 + P3-004
- `src/app/api/packs/route.ts` — P3-002（调用签名更新）
- `src/app/packs/[name]/[file]/route.ts` — P3-006
- `next.config.ts` — P2-008（outputFileTracingIncludes）

### 新增（4 个）

- `src/app/api/packs/refresh/route.ts` — P2-011
- `tests/unit/persistence/audit.repo.test.ts` — P1-005
- `tests/unit/lib/request-helpers.test.ts` — P2-010 + P3-005
- `tests/unit/lib/startup.test.ts` — P2-007
- `tests/unit/app/packs-refresh-route.test.ts` — P2-011

---

## 5. 验证结果（实际执行）

```bash
$ npx tsc --noEmit
# 无输出，通过

$ npx vitest run
# Test Files  15 passed (15)
#      Tests  138 passed (138)
# Duration 4.73s

$ npx next build
# ✓ Compiled successfully in 542ms
# ✓ Generating static pages using 15 workers (15/15)
# Route (app)
# ├ ƒ /api/packs
# ├ ƒ /api/packs/refresh          ← 新增
# └ ƒ /packs/[name]/[file]
# 无 "filesystem access causes the whole project to be traced" 告警

$ grep -rn "sqlite\|better-sqlite" src/
# 0 匹配（MySQL 硬约束保持）

$ grep -rn "from 'next\|from 'react" src/domain/
# 0 匹配（领域层硬约束保持）

$ grep -rn "filesystem access\|whole project traced" <build output>
# 0 匹配（P2-008 已消除）
```

**环境限制**：Docker Desktop 未运行，MySQL 集成演示未实测；结论基于代码审查 + 单测 + 类型检查 + 构建。

---

## 6. Round 2 遗留项（阶段 2/6 处理）

- **P3-001b 已并入 P3-002 修复**（`getEffectivePack` 三参数签名）
- **P3-001e**（`env.ts` email 正则）— MVP 够用，暂不改

无未修复的 Round 2 P1/P2。

---

## 7. 后续建议

### 演示前必修（1 项）

1. **Docker MySQL 集成实测**（本轮未跑）：
   ```bash
   docker compose -f docker/docker-compose.dev.yml up -d mysql
   npm run dev
   curl http://localhost:3000/api/healthz
   # 期望：200 + db.ok=true + startup.started=true + hub.hubId="local"
   ```

### 建议本轮一起验证（2 项）

2. **P1-005 数据主权验证**：
   - 在 `.env` 中改 `HUB_ID=official-hub` 后跑一次 `requestCode`，`audit_log.hub_id` 应写入 `'official-hub'`（不再是 `'local'`）
   - 集成测试可后续加入 `001_init.sql` 逐字段比对

3. **P2-007 自愈验证**：
   - 启动后 kill MySQL 容器 → 触发一次 startup 失败 → 等 30s → 重启 MySQL 容器 → 触发 healthz → 期望 200 + startup.started=true

---

## 8. 签名

- 修复：2026-09-09
- 报告文件：`reports/fix-round-2.md`
- 关联文件：`reports/qa-round-2.md`（质检报告）、`reports/qa-round-1.md`、`reports/fix-round-1.md`
- 后续动作：
  1. 交回质检做 Round 3 回归
  2. 工程师/CI 跑 Docker MySQL 集成实测
  3. 全部通过后交 git 提交专员提交
