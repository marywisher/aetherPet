# Contributing to AetherPet

欢迎共建！AetherPet 是社区项目——无论是代码、文案、素材包还是文档，都欢迎你的参与。

Welcome! AetherPet is built by its community — code, copy, asset packs, and docs all welcome.

---

## 1. How to claim a task (如何认领任务)

1. Browse the **issue list** — look for `good first issue` (新手友好) or `help wanted` (需要经验) labels.
2. Comment on the issue: "I'd like to work on this" (可在 issue 里回复认领).
3. Coordinate in the issue before opening a PR — 先讨论再动手，避免重复工作。
4. Branch convention: `feat/<task>` or `fix/<task>`.
5. Commit style: `feat(stage-N): 描述` / `fix(scope): 描述` (参考现有 git log).

## 2. Development setup (开发环境)

```bash
npm install
npm run db:up          # MySQL 8 via Docker (同生产环境)
cp .env.example .env.local  # 填 DB_* / SMTP_* / HUB_* 配置
npm run dev            # http://localhost:30219
```

Core conventions (硬规则，PR 必须满足)：

- **领域层零框架**：`src/domain/**` 禁止 `import from "next"` / `"react"`（纯 TS，可独立测试）
- **数据库 MySQL 8**（不是 SQLite）；时间戳 BIGINT UTC ms；主键 ULID；每表含 `hub_id` + `schema_version`
- **事件结构不含文案**：事件只有结构/参数，文案来自素材包（`src/assets/packs/*/text/*.json`）
- **契约冻结**：事件-素材契约 v1.0.1 已冻结（`docs/packs-contract.md`），改动需 bump 版本号

Quality gates（提交前自检）：

```bash
npm run typecheck   # tsc --noEmit，0 错误
npm test            # vitest，全部通过
npm run build       # next build 成功
```

## 3. Good first issues (新手友好 · 不需要深度熟悉内核)

| # | 任务 | 范围 | 验收 | 难度 |
|---|------|------|------|------|
| GFI-1 | **扩充素材包文案** | 为 `src/assets/packs/default/text/*.json` 的 11 类事件增加变体文案（日常废话/诗意两档 9:1），不写代码 | 文案符合手绘治愈气质；10% 诗意档；不破坏现有 JSON 结构 | ★☆☆ |
| GFI-2 | **英文素材包（en）** | 新建 `text.en/*.json` 英文版文案包（结构对齐 manifest 契约） | 结构经 manifest-schema 校验通过；语法通顺自然 | ★☆☆ |
| GFI-3 | **更新 docs/asset-prompts.md** | 补充即梦素材产出后的验收清单（尺寸/格式/命名核对表） | 文档结构清晰、可直接照做 | ★☆☆ |
| GFI-4 | **P3 遗留清理：邮箱正则** | 升级 `src/config/env.ts` 的 email 正则（P3-001e 遗留项） | 覆盖常见邮箱后缀单测通过 | ★★☆ |
| GFI-5 | **事件卡片样式打磨** | 优化 `src/ui/event-card.tsx`（记忆引用高亮、信纸风格、响应式） | 视觉符合默认手绘素材包气质；无逻辑变更 | ★★☆ |
| GFI-6 | **补充单测** | 为事件生成器/FSM 边界补测试（空记忆、极端时间、重复物品） | 覆盖率不降、新增用例有意义 | ★★☆ |

## 4. Help wanted (需要一定经验 · 对应未完成阶段)

| # | 任务 | 对应阶段 | 范围与验收 |
|---|------|---------|-----------|
| HW-1 | **补算器 catch-up** | 阶段 3 | 实现 `planCatchUp`：≤20 事件 + 聚合摘要 + 渐进披露；1/3/30 天三用例通过 |
| HW-2 | **退避调度 backoff** | 阶段 3 | 按 CONTEXT.md 退避表（1→3→7→30 天）实现调度并单测 |
| HW-3 | **事件流时间线 UI** | 阶段 3 | 单一时间轴 + 类型标签 + 记忆高亮 + 分页 |
| HW-4 | **每日馈赠闭环** | 阶段 4 | 物品池 ≥8 种、每日限一次、24h 回信含 ≥1 记忆引用 |
| HW-5 | **公告中心** | 阶段 5 | 已读/未读/静音/倒序 + 空窗聚合 |
| HW-6 | **档案页** | 阶段 5 | pet 状态/记忆/历史/储物罐 |
| HW-7 | **导出/导入** | 阶段 6 | JSON schema 版本化 + 校验和 + 三类报错 + 逐字段比对 |
| HW-8 | **部署与自托管文档** | 阶段 6 | 宝塔 Apache + PM2 + MySQL 部署文档 + Docker Compose |
| HW-9 | **E2E 测试（Playwright）** | 阶段 6 | 注册→命名 pet→生成事件→时间线的完整链路 + 临时 MySQL 容器 CI |

## 5. Asset pack contributors (素材包贡献者 · 不写代码)

Your pack = a folder with `manifest.json` + `text/*.json` + `images/*.png` + `theme.css`.
Read [`docs/packs-contract.md`](docs/packs-contract.md) (frozen, v1.0.1) for the slot contract,
and [`docs/asset-prompts.md`](docs/asset-prompts.md) for how to produce the hand-drawn assets (JIMENG prompts included).

## 6. Code of conduct (行为准则)

- 友善、尊重；评审意见对事不对人。
- 中文/英文交流皆可（Comments in PR can be in either language）。
- 遵循 [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) 精神。