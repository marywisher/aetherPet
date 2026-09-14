/**
 * 文件名称：sync-client.ts
 * 功能描述：客户端补算同步入口（GET /api/sync 的并发去重封装）
 * 所属模块：lib
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（服务端在用户下次发起同步请求时执行）
 *   - docs/dev-stage-plan.md §3 阶段 3 同步 API
 *   - docs/requirements.md §3.7 每日馈赠（首页欢迎卡片消费 dailyGrant）
 *
 * 背景（阶段 6 收官修复）：
 *   阶段 1-6 期间前端没有任何页面调用 GET /api/sync，补算 / 回信检查 / 每日馈赠
 *   在产品链路中从未被触发（验收时仅靠手动 curl，属"验收绿、产品断线"）。
 *   本模块把"进入主页面时发起一次同步请求"的接线补上。
 *
 * 幂等性：
 *   服务端 sync 在 offlineMs <= 0 时不生成任何事件，并会把 last_activity_ts /
 *   user_last_active_ts 推进到 now；因此重复调用无副作用，"打开页面 = 活跃"与
 *   退避（缺席 ≥24h）和每日馈赠（当天首次）的语义一致。
 *
 * 返回值语义：
 *   - 成功（2xx）→ 返回 { dailyGrant }；失败 / 401 / 网络错误 → 返回 null（静默）
 *   - 调用方永不抛异常；首页用它展示"今日馈赠"欢迎卡片（granted / 池空兜底）
 */

/** sync 响应的 catchup 字段（与 src/app/api/sync/route.ts 的 catchup 对齐） */
export interface SyncCatchup {
  ran: boolean;
  durationMs: number;
  eventCount: number;
  aggregated: boolean;
  offlineDays: number;
  /** 本次离线窗口起点（pet 上次活跃时间）；前端用作“新事件”分界 */
  offlineStartTs: number;
  skipped?: string;
}

/** sync 响应的 dailyGrant 字段（与 src/app/api/sync/route.ts 的 dailyGrantResult 对齐） */
export interface SyncDailyGrant {
  ran: boolean;
  granted: boolean;
  skipped?: string;
  fallbackMessage?: string;
  itemId?: string;
  itemDisplayName?: string;
}

export interface SyncResult {
  /** 本次同步的补算信息；请求失败时为 null */
  catchup: SyncCatchup | null;
  /** 今日馈赠结果；请求失败时为 null */
  dailyGrant: SyncDailyGrant | null;
}

let inFlight: Promise<SyncResult | null> | null = null;

/**
 * 发起一次补算同步；并发 / 重复调用共享同一请求（模块级去重）。
 * 失败静默（返回 null），不阻断页面渲染。
 */
export function runSyncOnce(): Promise<SyncResult | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        catchup?: SyncCatchup;
        dailyGrant?: SyncDailyGrant;
      };
      return { catchup: body.catchup ?? null, dailyGrant: body.dailyGrant ?? null };
    } catch {
      // 静默：同步失败不影响时间线展示（timeline 的 401 自会引导登录）
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}