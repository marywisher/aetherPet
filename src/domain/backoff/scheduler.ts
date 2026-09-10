/**
 * 文件名称：scheduler.ts
 * 功能描述：退避调度器（缺席 → 下次主动触达间隔）
 * 所属模块：domain/backoff
 * 验收对齐：
 *   - docs/requirements.md §3.3 退避间隔
 *   - docs/dev-stage-plan.md §3 阶段 3 退避调度
 *   - CONTEXT.md 「退避间隔」表
 *
 * 语义（重要）：
 *   - `absenceMs` = now - userLastActiveTs，即"用户上一次活跃距离现在的时长"
 *   - 本模块输出 `nextProactiveTs = now + intervalMs`（当 intervalMs 非 null 时）
 *   - 当"每天来"（缺席近 24h 内）时，intervalMs = null，本模块输出 nextProactiveTs = null，
 *     表示"保持正常频率"，pet 会在下次馈赠/回信到期时按正常节奏触达，不设具体间隔
 *
 * 领域层纯 TS：不 import next/react，也不依赖 mysql/日期库。
 */

import {
  BACKOFF_BANDS,
  findBackoffBand,
  type BackoffBand,
} from "@/config/backoff-table";

export interface BackoffInput {
  /** 用户上一次活跃的时间戳（UTC ms） */
  userLastActiveTs: number;
  /** "现在"的时间戳（UTC ms）；可注入便于单测确定性 */
  now: number;
}

export interface BackoffResult {
  /** 缺席时长（ms；负值视作 0） */
  absenceMs: number;
  /** 缺席时长（小时，浮点；便于日志/UI 展示） */
  absenceHours: number;
  /** 匹配到的退避 band */
  band: BackoffBand;
  /** 下次主动触达的间隔（ms；null = 保持正常频率） */
  intervalMs: number | null;
  /** 下次主动触达的绝对时间戳（ms；null = 不设具体间隔，由日常馈赠/回信机制接管） */
  nextProactiveTs: number | null;
  /** 是否处于"每天来"（正常频率）状态 */
  isActive: boolean;
}

/**
 * 计算退避结果。
 *
 * 契约：
 *   - 纯函数：给定相同输入返回相同输出
 *   - 缺席 ≤ 0（例如用户刚活跃 / userLastActiveTs 未来于 now）→ 视作"每天来"，intervalMs = null
 *   - absenceHours 落在哪个 band 严格按 backoff-table.ts 的 minAbsenceHours 判定
 *
 * @param input 缺席时长 + 当前时间
 * @returns 退避结果
 */
export function computeBackoff(input: BackoffInput): BackoffResult {
  const { userLastActiveTs, now } = input;
  const absenceMs = Math.max(0, now - userLastActiveTs);
  const absenceHours = absenceMs / (60 * 60 * 1000);
  const band = findBackoffBand(absenceHours);

  return {
    absenceMs,
    absenceHours,
    band,
    intervalMs: band.intervalMs,
    nextProactiveTs: band.intervalMs !== null ? now + band.intervalMs : null,
    isActive: absenceHours < 24,
  };
}

/**
 * 便捷：给定缺席时长（小时），直接返回对应的退避间隔（ms | null）。
 * 便于 UI 提示"缺席 3 天后 pet 会退避到 7 天"。
 */
export function intervalForAbsenceHours(absenceHours: number): number | null {
  return findBackoffBand(absenceHours).intervalMs;
}

export { BACKOFF_BANDS };
