# Step 1 · 逻辑地图（完整审计）

**审计性质**：项目首次完整三步审计（领域逻辑层系统核查）
**审计时间**：2026-09-17
**依据**：`docs/requirements.md` §3（功能需求）、`docs/architecture.md`、128 个源文件代码通读
**方法**：code-audit 三步法 Step 1 —— 以「业务意图基准」绘制全景流程图，标注偏差高发区

---

## 0. 审计目标声明

本项目此前仅有：
- 阶段 5/6 QA 报告（验收导向）
- 09-12~09-13 接线专项审计（明确「不再重审领域逻辑」）

**本审计首次系统覆盖领域逻辑层**：事件引擎 / FSM / 补算 / 馈赠 / 送赠 / 回信 / 退避 / 记忆 / 素材包 / 导出导入 / 公告。

---

## 1. 全景流程图（6 条核心链路）

### 链路 A · 认证 + Pet 创建

```mermaid
flowchart TD
    U[用户] -->|邮箱验证码| A1[POST /api/auth/request-code]
    A1 -->|节流 5min/3次 同邮箱 + 30次/IP| A2[发送邮件 SMTP]
    A2 --> A3[POST /api/auth/verify]
    A3 -->|验证码校验 + 节流 anti-enum| A4[签发 token]
    A4 --> A5[GET /api/auth/me]
    A5 -->|requireAuth Bearer/Cookie| A6[登录态]
    A6 --> B1[POST /api/pet/create]
    B1 --> B2[生成初始事件 1-2条<br/>typePool: 在家类型 + ts倒推6-48h]
    B2 --> B3[生成初见事件 first_meeting<br/>ts = 创建时刻]
    B3 --> B4[事务落库 pets + events + naming记忆]
```

### 链路 B · 主同步入口（核心）

```mermaid
flowchart TD
    S1[GET /api/sync] --> S2{requireAuth 401?}
    S2 -->|否| S3[findByUserId 加载 pet]
    S3 --> S4{pet 存在?}
    S4 -->|否| S5[返回空响应 `ok:true`]
    S4 -->|是| S6[computeBackoff<br/>absence = now - userLastActiveTs]
    S6 --> S7[planCatchUp<br/>离线天数 → 计划 slots]
    S7 --> S8{plan.total > 0?}
    S8 -->|是| S9[executeCatchUp 单事务<br/>INSERT events + UPDATE pets]
    S8 -->|否| S10[catchupSkipped 记录]
    S9 --> S11[P1-001 始终写回 next_proactive_ts]
    S11 --> S12[重读 pet → 合并新状态]
    S12 --> S13[渲染时间线 20 条<br/>render + seasonTone]
    S13 --> S14[回信检查 checkAndGenerateReply]
    S14 --> S15[重读 pet 防陈旧]
    S15 --> S16[每日馈赠 grantDailyItem]
    S16 --> S17[再次重读 pet 返回]
    S9 -.失败.-> S18[catchup_error 不阻断<br/>下次同步重试]
```

### 链路 C · 补算（plan → exec → aggregate）

```mermaid
flowchart TD
    P1[planCatchUp 纯函数] --> P2{offlineMs > 0?}
    P2 -->|否| P3[空计划 total=0]
    P2 -->|是| P4[recentWindow = min(7天, offlineMs)]
    P4 --> P5[recentDays = floor(offlineMs/天) ≤ 7]
    P5 --> P6[normalCount = min(recentDays×1, 20-聚合1)]
    P6 --> P7[distributeTs 均匀分布<br/>首末留50% spacing]
    P7 --> P8{oldSpan > 0?<br/>离线>7天}
    P8 -->|是| P9[aggregate slot fromTs→oldEnd]
    P8 -->|否| P10[无聚合]
    E1[executeCatchUp] --> E2[事务 BEGIN]
    E2 --> E3[预取 memories 一次]
    E3 --> E4{naming 记忆缺失?}
    E4 -->|是| E5[补插 naming 记忆]
    E4 -->|否| E6[逐条 forceType 生成 + INSERT<br/>FSM 逐步推进]
    E6 --> E7{plan.aggregate?}
    E7 -->|是| E8[generateAggregateSummaryEvent<br/>ts = recentStart 窗口起点]
    E7 -->|否| E9[UPDATE pets<br/>state/state_since/last_activity/user_last_active/offline_start]
    E5 --> E6
    E8 --> E9
    E9 --> E10[事务 COMMIT / 失败 ROLLBACK]
```

### 链路 D · 事件引擎 + FSM

```mermaid
flowchart TD
    G1[generateNextEvent] --> G2{forceType?}
    G2 -->|否| G3{typePool?}
    G3 -->|否| G4[pickRandomTypesByState<br/>按当前 pet.state 过滤类型]
    G4 --> G5[pickOne 随机选类型]
    G5 --> G6[查 GENERATORS 注册表]
    G6 --> G7[生成器产出 event + fsmAction]
    G7 --> G8[FSM transition<br/>apply fsmAction → nextState]
    G8 --> G9[event.fsmState = nextState 覆盖]
    G2 -->|是| G6
    G3 -->|是| G6

    subgraph FSM[状态机]
        F1[at_home] --outing_start--> F2[out_walking]
        F2 --outing_end--> F3[at_home]
        F1 --trip_start--> F4[on_trip]
        F4 --trip_end--> F5[at_home]
    end
```

### 链路 E · 每日馈赠闭环

```mermaid
flowchart TD
    D1[grantDailyItem] --> D2{created 当日?<br/>P0-1 创建日不发}
    D2 -->|是| D3[skip created_today]
    D2 -->|否| D4{今日已领?<br/>daily_grant_last_date}
    D4 -->|是| D5[skip already_granted]
    D4 -->|否| D6{pool 空?}
    D6 -->|是| D7[fallback 文案]
    D6 -->|否| D8[findRecentGrantItemIds 3 条]
    D8 --> D9[pickWithExclusion<br/>排除最近3次加权抽]
    D9 --> D10[pre 生成 event + inventory_id]
    D10 --> D11[事务: INSERT inventory → INSERT event<br/>→ 条件 UPDATE daily_grant_last_date]
    D11 -->|affectedRows=0| D12[IdempotencyError → rollback → already]
    D11 -->|nonzero| D13[granted=true]
```

### 链路 F · 送赠 + 回信

```mermaid
flowchart TD
    O1[POST /api/gift/offer] --> O2{pet 存在?}
    O2 --> O3{今日已送? offer_last_date}
    O3 -->|是| O4[skip already_offered]
    O3 -->|否| O5[校验 inventory: 存在/所属/未送出]
    O5 -->|失败| O6[skip 对应错误码]
    O5 -->|通过| O7[查 items 表 displayName]
    O7 --> O8[生成 offer_received 事件]
    O8 --> O9[事务: 条件 UPDATE pets<br/>offer_last_date + reply_pending=1 + reply_due_at=now+24h]
    O9 -->|affected=0| O10[并发 → rollback already]
    O9 -->|nonzero| O11[条件 UPDATE inventory<br/>offered_at + consumed_at]
    O11 -->|affected=0| O12[并发 → rollback]
    O11 -->|nonzero| O13[INSERT event + INSERT item_received 记忆]
    R1[checkAndGenerateReply<br/>sync 内触发] --> R2[isReplyDue<br/>pending=1 + dueAt<=now + 退避不压制]
    R2 -->|否| R3[skipReason]
    R2 -->|是| R4[findByPetAndType 最近 offer_received]
    R4 --> R5{item_display_name 缺失?}
    R5 -->|是| R6[memories item_received 兜底]
    R5 -->|否| R7[generateReplyLetter<br/>nameForceProb=1 强制 pet_name]
    R7 --> R8[事务: INSERT event + markReplyCleared<br/>reply_pending=0]
```

### 链路 G · 导出/导入 + 公告（简述）

```mermaid
flowchart LR
    X1[GET /api/export] --> X2[exporter 收集 pet/记忆/事件/物品/元数据]
    X2 --> X3[schema 1.0.0 + SHA256 校验和<br/>排除敏感字段]
    I1[POST /api/import] --> I2[schema 校验]
    I2 --> I3[校验和校验]
    I3 --> I4[字段缺失校验]
    I4 --> I5[单事务: 清空 → 重建 → COMMIT]
    N1[公告回补] --> N2[aggregate 策略 不逐一轰炸]
```

---

## 2. ⚠️ 偏差高发区标注（Step 2 待推演）

| ID | 位置 | 风险描述 | 级别猜测 |
|----|------|---------|---------|
| **H-A** | `pet-fsm.ts:40` | `transition()` 对 no-op / 非法动作**也返回 `stateSince: now`**——状态未变但起始时间被推进。补算中连续 no-op 事件会把 state_since 反复推到最新事件时间，UI「状态于 X 起」可能失真 | 🟠 语义疑点 |
| **H-B** | `planner.ts CANDIDATE_TYPES` + `engine.ts forceType` | planner 直接随机抽类型（含 outing、brought_item）后以 `forceType` 绕过引擎的**状态过滤**。pet 在 `out_walking` 时抽到 outing → 生成「又出门」事件但 FSM no-op；`at_home` 抽到 brought_item → 出现「没出门却带回物品」孤立事件 | 🟠 语义矛盾 |
| **H-C** | `brought-item.ts` fsmAction=outing_end | 生成器无条件声明 `outing_end`，非法时被 FSM 降级 no-op，但**事件仍入库**。补算随机路径下「带物品回家」事件可能成为异常状态（与需求「带回物品=散步归来」矛盾） | 🟡 轻微 |
| **H-D** | `sync route.ts` 顺序 | 时间线查询在回信/馈赠**之前**，本次响应 events 不含刚生成的 reply/grant 事件（欢迎卡数据独立返回，前端需下次刷新才见事件） | 🟡 体验/设计 |
| **H-E** | `daily-grant.ts created_today` | 判据用 `toLocalDateStr(createdAt)===todayStr`；若用户在 23:59:59 创建、次日 00:00:01 登录 → 同日 UTC+8 字符串不同，发放正确；但 UTC+8 与服务器本地时区若不一致（部署在非 +8 主机），`toLocalDateStr` 偏移需确认 | 🟡 边界 |
| **H-F** | `reply.ts findLatestOfferEvent` | 用「最近一条 offer_received」反推 reply 关联物品。若用户曾多次送赠但 reply 未清，或 offer 事件 ts 与 pending 记录错位，回信可能引用**错误物品** | 🟠 待验证 |
| **H-G** | `executor.ts` 聚合事件 ts | aggregate.ts = oldEnd（= recentStart 窗口起点），而 normal 首条 ts 略大于 recentStart（spacing 边距）。若调用方依赖 `generated` 数组顺序而非按 ts 排序，聚合会跑到「更早」位置；需确认 DB 查询排序 | 🟡 轻微 |
| **H-I** | `season.ts stableHash % lines.length` | 确定性依赖 lines 数组**长度与内容不变**；若素材包更新后 lines 变化，同一事件渲染结果漂移（与「永远同一条」承诺冲突） | 🟡 轻微 |
| **H-J** | `sync` 失败吞异常 | catchup/reply/grant 三处失败都仅 console.error 不阻断；若 DB 故障，用户会收到「看似成功但数据缺失」的时间线 | 🟡 可接受性 |

---

## 3. 与需求基准的宏观比对结论（初判）

| 需求 § | 实现 | 初判 |
|--------|------|------|
| §3.2 状态机 | 三态 FSM + 非法动作 no-op | ✅ 结构符合 |
| §3.3 事件引擎 ≥30% 名字 / 退避 | recall-strategy 强制注入 50%、退避 band 表 | ✅ 有冗余设计 |
| §3.4 补算 ≤20 / >7 天聚合 / 状态推进 / 渐进披露 | planner 上限 20、7 天窗口、聚合摘要、offlineStartTs | ✅ 结构符合（H-A/H-B/G 待推演） |
| §3.7 馈赠加权+排除3次 / 24h 回信 | item-pool 加权排除、reply_due 24h | ✅（H-D/F 待推演） |
| §3.9 导出导入 | schema+校验和+单事务 | ✅ 接线审计已核 |
| §3.10 素材包损坏回退 | loader fallback | ✅ 待抽查 |
| §3.11 事件-素材契约 | packs-contract 冻结 | ✅ 待抽查 |

> **请确认**：以上 7 条链路走向与您的业务意图是否一致？特别是 H-B/H-C（补算中随机事件类型与 FSM 状态可能产生的「语义矛盾事件」）——这是否是您预期的产品行为？确认后我将进入 Step 2 极端推演。