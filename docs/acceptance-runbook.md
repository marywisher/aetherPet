# AetherPet · 11 项验收实操手册（真库 E2E）

> 适用版本：阶段 6（v0.1.0）｜ 环境：本地 Docker MySQL 8.4 + `npm run dev`
> 依据：`docs/requirements.md` §6、`docs/dev-stage-plan.md` §7、`reports/final-acceptance.md`
> 说明：单测/集成测试是自动化证据；本手册补上「真实 MySQL + 真浏览器」的手动 E2E，逐项给出**操作步骤 + 预期结果**。

---

## 0. 前置自检（一次性，约 1 分钟）

> ⚠️ **PowerShell 用户先读**：本文档命令默认 bash 语法。若你在 Windows PowerShell 里操作，
> 下面 3 个差异必须注意，否则会报错或拿不到结果：
>
> 1. **环境变量赋值**：bash 用 `INTEGRATION_DB=1 npm run test:integration`，
>    PowerShell 要写成：`$env:INTEGRATION_DB="1"; npm run test:integration`
> 2. **curl**：PowerShell 5.1 里 `curl` 是 `Invoke-WebRequest` 的别名（输出长且不友好），
>    统一用 `curl.exe`（真实 curl；Win10/11 自带）；并避免用 `|` 管道再配 `python -m json.tool` 时
>    出现编码乱码 → 可直接 `curl.exe -s ...` 看原始 JSON。
> 3. **查看日志**：bash 的 `tail -30 ... | grep xxx` 在 PowerShell 用：
>    `Get-Content logs/dev-server.log -Tail 30 | Select-String "code"`
>    （`Select-String` 相当于 `grep`；`Get-Content -Tail N` 相当于 `tail -N`）

```powershell
# 1) 数据库容器健康（PowerShell 可直接用）
docker ps --filter name=aetherpet        # 应显示 Up (healthy)，端口 127.0.0.1:3306

# 2) 应用存活且 migration 成功
curl.exe -s http://localhost:3000/api/healthz
#   预期：{"ok":true,...} 中 db.ok=true，startup.failed=false

# （可选）开发日志去噪：Next.js 16 dev 会刷一批 Edge Runtime 分析警告（非报错，不影响功能）。
#   不想看就用 dev:quiet 过滤后再写日志；或临时清空已膨胀的日志：
#   npm run dev:quiet 2>&1 >> logs/dev-server.log
#   Clear-Content logs/dev-server.log

# 3) 自动化证据全跑一遍（单测 + 真库集成 + 性能冒烟）
npm test                                   # 单测：519 passed / 8 skipped
$env:INTEGRATION_DB="1"; npm run test:integration   # 集成：8 passed（真实 MySQL 8.4）
npm run smoke -- --server http://localhost:3000     # 性能冒烟：3/3 通过
```

> 应用开发服务器：`npm run dev`（已在 http://localhost:3000 运行）
> 登录验证码：本地 `SMTP_DRY_RUN=true` **不真发邮件**，验证码打印在 `logs/dev-server.log`，每次注册后去查：
> ```powershell
> Get-Content logs/dev-server.log -Tail 50 | Select-String -Pattern "code|验证码|verification"
> ```
> 第 8 项（素材包切换）需开发者模式：`.env` 已设 `ENABLE_DEV_ENDPOINTS=true`（改后需重启 `npm run dev`）。

---

## 1. 注册登录（含安全边界）

**操作**
1. 打开 `http://localhost:3000/login` → 点「注册」→ 输入邮箱（用没用过的，如 `eptest1@example.com`），点发送验证码
2. 从 `logs/dev-server.log` 找到 6 位验证码 → 输入 → 注册成功进入「创建宠物」页
3. 输入宠物名（如「棉花」）→ 创建成功 → 回到首页看到宠物
4. 退出登录 → 用同一邮箱 + 新验证码重新登录
   > 退出入口：`/settings` 页底部「账号」区块的「退出登录」按钮（点一下即自动清 cookie 并跳回 `/login`；API 失败时前端也会兜底清 cookie）
5. 同邮箱 5 分钟内快速连点 3 次「发送验证码」→ 第 4 次应被节流

**预期**
- 验证码 10 分钟过期；同邮箱 5 分钟限 3 次（第 4 次提示频率限制）
- 登录后 30 天 token 有效（Cookie），退出登录后 Cookie 清除
- 首页显示宠物 + 初始欢迎事件

---

## 2. 档案页

**操作**：点首页宠物进入档案 `/(pet)/profile`

**预期**：能看到
- 宠物当前状态（在家/出门/旅行，含 since 展示）
- 记忆片段列表
- 事件历史（最近若干条）
- 储物罐（物品栏，初始为空/或已有每日馈赠物品）

---

## 3. 随机事件引擎（含记忆引用）

**操作**
1. 首页观察宠物事件流（可配合补算制造事件，见验收 4）
2. 打开时间线 `/(pet)/timeline`，抽样浏览 ≥10 条事件文案
3. 找含记忆引用的文案（如「还记得……」「上次……」）

**预期**
- 事件低频随机产生，类型多样（拾到物品/发呆/打盹/远行等）
- 文案抽样 ≥30% 自然带出宠物名字；记忆引用文案正确指向已发生的事

---

## 4. 补算（含极端场景）

**操作**（三种「离线时长」场景）
1. **离线 1 天**：把系统时间不变、宠物状态置为 1 天未活跃（开发者页可调，或直接改 `pets.user_last_active_ts` 为 24h 前）→ 访问首页触发补算
2. **离线 3 天**：同上改 3 天 → 刷新首页
3. **离线 30 天**：改 30 天前 → 刷新首页，观察首屏是否出现**聚合摘要 + 入口卡片**

**预期**
- 三种场景补算秒级完成（30 天场景单次补算事件 ≤20 条）
- 30 天场景：首屏先见聚合摘要（如「你离开的这 30 天……」）+ 渐进披露入口，点开才见明细
- 事件时间线 ts 分布合理（不扎堆同一毫秒）

---

## 5. 事件流

**操作**：打开时间线 `/(pet)/timeline`

**预期**
- 单一时间轴，事件带类型标签
- 纯宠物单向输出、**无回复按钮**
- 记忆引用文案高亮（与普通文案样式区分）

---

## 6. 公告

**操作**
1. 服务端发公告：终端/代码里带 `HUB_ADMIN_TOKEN` 调 `POST /api/announcements/admin`（仓库 `scripts/` 有示例或 curl）
2. 用户端刷新公告中心 `/announcements` → 看到新公告
3. 标记已读 → 未读角标消失；对一条公告「静音」→ 时间段内不再提示；多条公告按时间倒序

**预期**
- 公告发布后用户侧可见；已读/未读状态、静音、倒序列表均正常
- 时间线/首页若播报系统公告，已聚合项不重复出现

---

## 7. 数据导出/导入

**操作**
1. 设置 `/settings` → 「导出备份」→ 确认弹窗 → 下载 JSON
2. 打开 JSON 文件检查：含 `schema_version`、`exported_at`、`exported_from`、`sha256`；**不含** token/验证码/邮箱明文/审计
3. 改动一两处数据（如喂食一次）→ `/import` → 选择刚才的备份 → 导入
4. 导入成功后回到各处核对数据与导出时一致（逐一对比）

**预期**
- 导出 JSON 元信息齐全、无敏感字段
- 导入后**逐字段完全还原**（可用 `diff` 对比导入前后截图/数据）
- 错误分支：用被篡改（改一行）的文件导入 → 报「校验和失败」；用 `schema_version` 改错的 → 报「版本不匹配」；两句报错文案**不同**
- 导入是单事务：中途失败整体回滚，不留半状态

---

## 8. 素材包可配置性

**操作**
1. 开发者页 `/developer`（需 `.env` 设 `ENABLE_DEV_ENDPOINTS=true` 后重启 dev）
2. 当前包 `default` → 切换到备用包 `morning` → 回首页观察视觉/文案变化
3. 再切回 `default`

**预期**
- 切换立即生效：UI 视觉/文案（欢迎语、事件文案风格）可见差异
- 若手动破坏 `morning` 包（改坏 manifest 模拟）→ 自动回退 `default` 且不崩溃

---

## 9. 部署 + 性能

**操作**
1. `npm run build` → 检查 `.next/standalone` 产物存在
2. `npm run smoke -- --server http://localhost:3000` → 3 项全过（见 §0）
3. 浏览器实测首屏加载时间（DevTools Network，常规网络 <3s）

**预期**
- standalone 产物完整（含 migrations/素材包，35MB 级）
- 页面加载 <3s；30 天补算 <500ms；DB 连接池预热 + 单事务 P99 <200ms

---

## 10. 每日馈赠闭环（含退避）

**操作**
1. 首次登录后（当天）首页出现「今日馈赠」→ 领取 → 获得随机物品（物品池 ≥8 种）
2. 把物品送给宠物（/gifts）→ 宠物 24h 内回信（/letter，含 ≥1 条记忆引用）
3. 同一设备/账号当天**再次**尝试领取 → 应被日限拒绝（每天一次）
4. 退避验证：把 `pets.user_last_active_ts` 改为 3 天前 → 刷新，观察 pet 主动触达（如「好久不见」事件），事件间隔参数应显示为退避 7 天

**预期**
- 物品池 ≥8 种且权重随机；每日仅一次（服务端幂等，DB 条件保证，改系统时间也骗不过）
- 回信含记忆引用；缺席 3 天后主动触达间隔退避为 7 天（可观测 next_proactive_ts / 事件文案）

---

## 11. 账号安全与恢复

**操作**
1. 注册后用不存在的验证码尝试登录 → 应提示无效/过期
2. 节流测试同验收 1（同邮箱 5min 限 3 次）
3. 打开 `/account/help`（申诉入口）→ 页面展示备份 hash 与邮箱证明引导
4. 到 `/settings` 导出一次备份 → 回档案接口/DB 可看到 `users.last_backup_hash` 已更新

**预期**
- 验证码过期/错误均有明确报错且不泄露账号存在性
- 申诉入口存在；导出备份会更新 `last_backup_hash`，可作为身份证明

---

## 记录表

| # | 验收项 | 结果（✅/❌） | 备注 |
|---|--------|---------------|------|
| 1 | 注册登录（含安全边界） | | |
| 2 | 档案页 | | |
| 3 | 随机事件引擎（含记忆引用） | | |
| 4 | 补算（含极端场景） | | |
| 5 | 事件流 | | |
| 6 | 公告 | | |
| 7 | 数据导出/导入 | | |
| 8 | 素材包可配置性 | | |
| 9 | 部署 + 性能 | | |
| 10 | 每日馈赠闭环（含退避） | | |
| 11 | 账号安全与恢复 | | |

**确认人：__________ 日期：__________**（完成即代表真库 E2E 补验通过，可更新 `/reports/final-acceptance.md` 的遗留说明第 1 条）