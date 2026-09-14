/**
 * 文件名称：timeline-split.ts
 * 功能描述：时间线"新旧"分组纯函数——以离线窗口起点为界，把事件分为
 *           fresh（你不在的时候发生的）与 past（更早之前的事）。
 * 所属模块：lib
 * 验收对齐：
 *   - docs/requirements.md §3.5 事件流（无社交压力：不制造"未读/待办"感）
 *   - 阶段 6 收官：用户反馈"新增事件与老事件混排看不出来"，
 *     用一条分隔线 + 叙事文案替代"未读角标"（角标与产品原则冲突）。
 *
 * 语义：
 *   - boundaryTs = sync 响应 catchup.offlineStartTs（pet 上次活跃时间）；
 *   - fresh = ts >= boundaryTs（离线窗口内，含补算/馈赠/动作事件）；
 *   - past = ts < boundaryTs（你上次离开前就有的老事件）；
 *   - boundaryTs 缺失（sync 失败/无数据）→ 全部归 past，不打扰。
 *   - 纯函数、无 IO，单测可复现。
 */

export interface TsCarrier {
  event: { ts: number };
}

export interface SplitResult<T extends TsCarrier> {
  /** ts >= boundaryTs 的事件（保持入参顺序，通常 ts 倒序） */
  fresh: T[];
  /** ts < boundaryTs 的事件 */
  past: T[];
}

/**
 * 按离线窗口起点把事件分为新旧两段。
 *
 * @param items      事件列表（通常已按 ts 倒序，来自 timeline API）
 * @param boundaryTs 离线窗口起点；null/undefined/NaN 视为"无边界"→ 全部归 past
 */
export function splitEventsByTs<T extends TsCarrier>(
  items: T[],
  boundaryTs: number | null | undefined
): SplitResult<T> {
  if (!Array.isArray(items) || items.length === 0) {
    return { fresh: [], past: [] };
  }
  const hasBoundary = typeof boundaryTs === "number" && Number.isFinite(boundaryTs);
  if (!hasBoundary) {
    return { fresh: [], past: items };
  }
  const fresh: T[] = [];
  const past: T[] = [];
  for (const it of items) {
    (it.event.ts >= boundaryTs! ? fresh : past).push(it);
  }
  return { fresh, past };
}