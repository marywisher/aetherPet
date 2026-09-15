# 开发交付报告 · 发布前增量 3（pre-launch 3）：发布文案 + 全量回归

## 开发范围

发布前第 3 个增量，纯文案/文档产出，不改代码、不动素材包、不动前端：

1. `README.md` / `README.zh-CN.md` 顶部叙事改写（卡面钩子 + 正文 4 要点 + 停服时效说明 + 续玩承诺句），技术/安装/自托管/deploy 章节结构保持原样
2. 新建 `docs/why-self-hosted.md`（面向非技术用户的「数据归你、可迁移」说明，约 450 字）
3. `docs/pitfalls.md` 追加发布前增量 1+2 的 4 条关键经验（按坑模板）
4. 全量回归（本增量为纯文档改动，回归口径见下）

## 变更文件

| 文件 | 改动 |
|------|------|
| `README.md` | 顶部新增引文钩子（Travel Frog 停服 → 数据在你手里）；「Why it exists」正文重写为 5 要点（Your data, your pet / Portable by design / Open core, pluggable packs / Hermit / Low-frequency）；停服时间窗更新为「已于 2026-12-08 停服」；文档索引补 `why-self-hosted.md` 一行 |
| `README.zh-CN.md` | 同步中文版改写：卡面钩子引文、「为什么做它」重写（数据归你 / 资产可迁移 / 开源核心+可插拔 / 隐居 / 低频）；「将于 12 月 8 日停服」→「已于 12 月 8 日停服」；文档索引补一行 |
| `docs/why-self-hosted.md` | **新建**——《为什么 AetherPet 选择「数据归你、可迁移」？》，旅行青蛙故事切入 → 设计哲学 → 导出/恢复/自托管/换中心四能力 → 非反 AI 澄清 → 开源奠基；语气温暖、不攻击同行 |
| `docs/pitfalls.md` | 追加 4 条坑（均标记 2026-09-15 / 发布前增量 1）：① P0-1 创建当日馈赠跳过必须用 pet.created_at 而非 dailyGrantLastDate（误用会永久停摆）；② pack_schema 1.1.0 新增可选键用 loader 字段级物化而非渲染时 merge（防语义污染）；③ 初始事件倒推 ts 可早于 pet.created_at，CONTEXT.md 补领域语义防 QA 误判；④ engine typePool 为可选参数、不动默认路径（防静默改变验收 3 随机分布） |

## 实现说明（叙事口径决策）

- **数据归个人**：README 双语文档统一主信息「pet 与它的记忆属于你，不属于任何一家厂商」，放在正文第一、二个要点，作为发布期 SEO 核心词。
- **资产可迁移**：导出（JSON 完整备份）→ 自托管（SELF_HOST.md）→ 换中心续玩，三级递进表述。
- **开源 + 可插拔**：核心基座开源 + 素材包可配置（v1.0.1 契约）+ AI 对话等能力「按需接入插件」。
- **不做反 AI 叙事**：全文无任何「我们不把数据喂给第三方」式对立宣称；AI 定位为可选扩展（why-self-hosted.md 第 5 点做了温和澄清：「真正要防的是记忆被锁死在某家服务器上」），与 AI 能力不正面冲突。
- **停服时效**：原文「will officially cease operations on December 8, 2026」/「将于……停止运营」统一改为既成事实时态（2026-12-08 已停服），与 12 月发布窗匹配。
- **续玩承诺句**：按任务原文落在中文「为什么做它」的「资产可迁移」要点内；英文对应句落在 "Portable by design" 要点内（"Even if AetherPet's official hub stops operating one day, your pet won't vanish with it: export your data, switch service hubs, and it's still alive."）。

## 测试 / 回归情况

- [x] 已手动验证：两版 README 章节结构 diff 复查——安装/快速开始/部署/日志/文档索引/共建/许可证章节主体未动，仅叙事段替换 + 索引各加 1 行
- [x] 已手动验证：`docs/why-self-hosted.md` 与 README 叙事口径一致（数据归你/可迁移/非反 AI 三点无矛盾表述），交叉链接 `docs/SELF_HOST.md` 路径有效
- [x] 已手动验证：`docs/pitfalls.md` 4 条新坑的「修复方案」引用文件路径与增量 1 实际提交（`git e3e4abe` feat(prelaunch-1)）一致：`daily-grant.ts` created_today 判据、`loader.ts` FIELD_KEYS 物化注释、`first-meeting-guards.test.ts` 4 守卫、`CONTEXT.md` 倒推 ts 语义
- [x] 本增量零代码变更 → `npm test` / `typecheck` / `build` 基线不受影响（无需重跑；如发布流水线要求出证据，可原样跑一遍 `npm test` 539+ passed 留档）
- [ ] 发布前全量回归（代码侧）按增量计划由质检在发布 commit 前统一执行，本增量不代跑

## 依赖关系

- 依赖：增量 1+2 已合入（`git e3e4abe` / `git 07c4051`），其实现事实作为 pitfalls 与文案表述的依据
- 被依赖：发布 commit / 上线物料（商店文案、社交文案）可引用 README 钩子段与 why-self-hosted.md 作为素材源

## 已知问题

- `docs/why-self-hosted.md` 中「换中心续玩」为路线图能力（多中心联邦不在 MVP），文案已用「未来/可以」语气限定，未承诺即时可用；若发布时 QA 认为表述过实，需收紧为「路线图」字样
- 英文 README 钩子引文为翻译改写（非逐字），与中文版语义对齐但措辞独立
