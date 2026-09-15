# 增量 1 开发报告（pre-launch · 契约/引擎/创建流程/馈赠跳过）

## 改动清单

### 核心代码

| 文件 | 改动 |
|------|------|
| `src/domain/types.ts` | EventType 枚举添 `first_meeting`；EventSource 加 `"creation"` |
| `src/domain/events/types.ts` | PACK_SCHEMA_VERSION → `1.1.0` |
| `src/domain/events/engine.ts` | EngineOptions 加 `typePool` + `tsPerEvent`；`generateBatchEvents` 支持逐条 ts |
| `src/domain/events/generators/first-meeting.ts` | **新建** — 初见事件生成器（FSM no-op，source=`creation`） |
| `src/domain/events/templates.ts` | 注册 `first_meeting` 生成器；RANDOM_TYPES 保持 6 项不动 |
| `src/domain/packs/manifest-schema.ts` | texts 加可选键 `first_meeting` / `guidance` |
| `src/domain/packs/loader.ts` | 字段级回退物化（非 default 包缺键时从 default 拷贝） |
| `src/domain/gift/daily-grant.ts` | P0-1：「创建当日跳过馈赠」（`created_today`），用 `pet.createdAt` 判据 |
| `src/domain/persistence/repos/pets.repo.ts` | 新增 `insertInTx` 变体（创建事务用） |
| `src/domain/persistence/repos/audit.repo.ts` | 新增 `insertAuditLogInTx` 变体 |
| `src/app/api/pet/create/route.ts` | 创建事务化 + 倒推初始事件（1–2条，watching_water/counting_leaves/self_talk） + first_meeting |
| `src/ui/timeline.tsx` | TYPE_LABELS 加 `first_meeting: "初见"` |

### 素材包

| 文件 | 改动 |
|------|------|
| `src/assets/packs/default/manifest.json` | pack_schema_version → 1.1.0；加 first_meeting/guidance 键 + first_meeting_note 资产 |
| `src/assets/packs/morning/manifest.json` | 同 bump；加文案键（图片回退 default） |
| `src/assets/packs/night/manifest.json` | 同 bump；加文案键（图片回退 default） |
| `src/assets/packs/default/text/first-meeting.json` | **新建** — 初见字条文案（3 变体） |
| `src/assets/packs/default/text/guidance.json` | **新建** — desk_hint + first_session_farewell |
| `src/assets/packs/morning/text/first-meeting.json` | **新建** — 晨光系初见文案 |
| `src/assets/packs/morning/text/guidance.json` | **新建** |
| `src/assets/packs/night/text/first-meeting.json` | **新建** — 夜色系初见文案 |
| `src/assets/packs/night/text/guidance.json` | **新建** |
| `src/assets/packs/default/images/first-meeting-note.png` | **新建** — 占位图（83B，后续出图替换） |

### 单测

| 文件 | 改动 |
|------|------|
| `tests/unit/domain/events/first-meeting-guards.test.ts` | **新建** — 4 道守卫（RANDOM_TYPES 不含、补算池不含、forceType 可生成、typePool 限定） |
| `tests/unit/domain/events/generators.test.ts` | 生成器注册表计数 11→12；packSchemaVersion 断言 1.0.0→1.1.0 |
| `tests/unit/domain/catchup/aggregator.test.ts` | packSchemaVersion 断言更新 |
| `tests/unit/domain/gift/daily-grant.test.ts` | pet fixture createdAt 提前 >24h（避开 created_today 跳过） |
| `tests/unit/packs/contract-vs-schema.test.ts` | 11 键→弹性检查 |
| `tests/unit/packs/loader.test.ts` | pack_schema_version 断言 1.0.0→1.1.0 |

### 文档

| 文件 | 改动 |
|------|------|
| `CONTEXT.md` | 补「默认素材包 pet = 小刺猬」+「倒推初始事件 ts 可早于 pet.created_at」 |
| `docs/acceptance-runbook.md` | 验收 10 口径更新（首馈赠在 T+1） |
| `docs/packs-contract.md` | 需同步（1.1.0 版声明 + §5 first_meeting 行 + §6 字段级回退优先级 + §8.4 清单） |

## 验证结果

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **543 passed, 8 skipped**（跳过的是集成测试，需真实 MySQL，与基线一致）

## 已知未做

- `docs/packs-contract.md` 全量同步（§5/§6/§8.4）—— 让 QA 确认后在增量 1 commit 前或增量 2 开始时补上
- `docs/architecture-adjustment.md` 中实现建议的 §7 回填至 `docs/current-stage.md`—— 让用户确认全部增量后再统一回填