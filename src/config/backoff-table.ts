/**
 * 文件名称：backoff-table.ts
 * 功能描述：退避间隔常量（CONTEXT.md 权威表）
 * 所属模块：config
 * 验收对齐：
 *   - docs/requirements.md §3.3 退避间隔
 *   - docs/dev-stage-plan.md §3 阶段 3 退避调度
 *   - CONTEXT.md 「退避间隔」权威表
 *
 * 说明：
 *   - 本文件是"退避表"的唯一权威来源；数值不得硬编码在业务代码里
 *   - 领域层（domain/backoff）从本文件读常量；不直接读 CONTEXT.md
 *   - CONTEXT.md 表格（缺席时长 → 下次主动触达间隔）：
 *       | 用户缺席时长 | pet 下次主动触达的间隔 |
 *       |--------------|------------------------|
 *       | 每天来       | 正常频率（次日/当晚回信）|
 *       | ≥ 1 天       | 退避到 3 天            |
 *       | ≥ 3 天       | 退避到 7 天            |
 *       | ≥ 7 天       | 退避到 30 天           |
 *       | 更久         | 维持 30 天上限         |
 *
 * 边界语义（本表实现）：
 *   - 缺席 0h（每天来）           → interval = null，表示"保持正常频率"
 *   - 缺席 1h ≤ X < 24h（近一天内）→ interval = 3 天
 *   - 缺席 24h ≤ X < 72h          → interval = 3 天
 *   - 缺席 72h ≤ X < 168h（7 天）  → interval = 7 天
 *   - 缺席 ≥ 168h（7 天）          → interval = 30 天（上限，永远不消失）
 *
 * 设计选择：
 *   - 用「minAbsenceDays（缺席天数下限，浮点）」作为阈值字段，用 1.0/3.0/7.0 表达
 *     CONTEXT.md 里的 "≥ 1 天 / ≥ 3 天 / ≥ 7 天"，保持与原文一致
 *   - 用 hoursAgo < 1 表达"每天来"（缺席近一天内），避免与"缺席 1 天 → 3 天间隔"
 *     两个 band 冲突；这样"缺席 1 天"（24 小时）仍落在 3 天间隔 band
 *
 * 约束：本文件是纯常量模块，禁止 import 任何运行时依赖。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** 退避 band 类型 */
export interface BackoffBand {
  /** 该 band 的最小缺席时长（单位：小时，浮点允许） */
  minAbsenceHours: number;
  /** 该 band 对应的下次主动触达间隔（单位：ms；null 表示"保持正常频率，不设具体间隔"） */
  intervalMs: number | null;
  /** 人类可读标签（用于日志/UI） */
  label: string;
}

/**
 * 退避表（按 minAbsenceHours 升序；scheduler 从后往前线性扫描，匹配第一个 ≤ absenceHours 的 band）
 *
 * 数值来自 CONTEXT.md 表格，改动需同步 CONTEXT.md 与 docs/requirements.md §3.3。
 */
export const BACKOFF_BANDS: readonly BackoffBand[] = [
  // 每天来（缺席 < 24 小时）：保持正常频率，不设具体间隔
  { minAbsenceHours: 0,   intervalMs: null,         label: "每天来" },
  // ≥ 1 天：退避到 3 天
  { minAbsenceHours: 24,  intervalMs: 3 * DAY_MS,   label: "≥ 1 天" },
  // ≥ 3 天：退避到 7 天
  { minAbsenceHours: 72,  intervalMs: 7 * DAY_MS,   label: "≥ 3 天" },
  // ≥ 7 天：退避到 30 天（上限）
  { minAbsenceHours: 168, intervalMs: 30 * DAY_MS,  label: "≥ 7 天" },
];

/** 最大退避间隔（30 天，"永不消失，但极低频"） */
export const MAX_BACKOFF_INTERVAL_MS = 30 * DAY_MS;

/** "每天来"band 的缺席阈值：近 24 小时内视为"每天来"（用于日志与 UI 判定） */
export const ACTIVE_DAILY_THRESHOLD_HOURS = 24;

/**
 * 查找缺席时长对应的退避 band（纯函数，便于单测）。
 *
 * @param absenceHours 缺席时长（小时，非负）
 * @returns 匹配的 band；负值视作 0（每天来）
 */
export function findBackoffBand(absenceHours: number): BackoffBand {
  const h = Number.isFinite(absenceHours) && absenceHours > 0 ? absenceHours : 0;
  // 从大到小扫描，匹配 minAbsenceHours ≤ h 的第一条
  for (let i = BACKOFF_BANDS.length - 1; i >= 0; i--) {
    if (BACKOFF_BANDS[i].minAbsenceHours <= h) return BACKOFF_BANDS[i];
  }
  // 理论不可达（backoffBands[0].minAbsenceHours = 0），保守兜底
  return BACKOFF_BANDS[0];
}
