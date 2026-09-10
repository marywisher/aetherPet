/**
 * 文件名称：anchoring.ts
 * 功能描述：时间锚点生成（"几天前"/"上周"/"昨天"等自然语言锚点）
 * 所属模块：domain/memory
 * 验收对齐：docs/requirements.md §3.3「事件引用『几天前』『上周』类时间锚点表达」
 */

import type { Rng } from "../events/types";
import { pickOne } from "../events/rng";

/** 时间锚点表达（供 text 里的 {recall_line} 使用） */
export interface TimeAnchor {
  /** 展示用的自然语言片段 */
  text: string;
  /** 距当前多少天（负数表示未来，但业务上不用） */
  daysAgo: number;
}

/**
 * 生成一个自然时间锚点（"昨天"/"前几天"/"上周"…）。
 *
 * Round 2 P2-007 修复：daysAgo 固定采样 1..6，不会触发 `daysAgo <= 9 / <= 14 / else` 分支。
 * 旧版代码保留了这些死分支（因为未来可能接入“很久之前”需求），
 * 但实际上 `pickAnchor` 已使用独立候选池供外部使用。因此本函数删除 `daysAgo > 6` 的不可达分支。
 *
 * @param rng   RNG
 */
export function generateTimeAnchor(rng: Rng): TimeAnchor {
  // 1..6 天前：只覆盖“昨天/前天/X 天前/前几天”四种表达
  // 若需“上周/上上周/很久之前”，请使用 pickAnchor（候选池独立）
  const daysAgo = 1 + Math.floor(rng() * 6); // 1..6

  let text: string;
  if (daysAgo === 1) {
    text = "昨天";
  } else if (daysAgo === 2) {
    text = "前天";
  } else if (daysAgo <= 3) {
    text = `${daysAgo} 天前`;
  } else {
    // 4..6 → “前几天”（与 4 天前的单一样本不重叠）
    text = "前几天";
  }
  return { text, daysAgo };
}

/**
 * 从候选列表随机选一条（用于 memory_refs 中多锚点时的多样性）。
 */
export function pickAnchor(rng: Rng): TimeAnchor {
  const pool: TimeAnchor[] = [
    { text: "昨天", daysAgo: 1 },
    { text: "前天", daysAgo: 2 },
    { text: "3 天前", daysAgo: 3 },
    { text: "前几天", daysAgo: 4 },
    { text: "上周", daysAgo: 7 },
    { text: "上上周", daysAgo: 10 },
    { text: "很久之前", daysAgo: 21 },
  ];
  return pickOne(rng, pool)!;
}
