/**
 * 文件名称：index.ts
 * 功能描述：记忆索引（对外门面，聚合 recall-strategy + anchoring）
 * 所属模块：domain/memory
 * 说明：
 *   - 供 events/generators 调用的统一入口
 *   - 保持纯函数，无持久层依赖（memories 由调用方注入）
 */

import type { Memory, MemoryRef } from "../types";
import type { Rng } from "../events/types";
import {
  recallFromMemories,
  synthesizePetNameRef,
  type RecallOptions,
  type RecallResult,
} from "./recall-strategy";
import { pickAnchor } from "./anchoring";

export * from "./anchoring";
export * from "./recall-strategy";

export interface RecallWithPetInput {
  memories: Memory[];
  petName: string;
  rng: Rng;
  /** 传给 recallFromMemories 的参数（不包含 includeTimeAnchor，那是本层自己处理的） */
  opts?: RecallOptions;
  /** 是否生成一条 time_anchor 引用（默认 true） */
  includeTimeAnchor?: boolean;
}

export type RecallWithPetResult = RecallResult;

/**
 * 记忆检索（面向事件引擎的门面）：
 *   1. 从 memories 池加权抽样
 *   2. 若 includeTimeAnchor=true 且结果中无 time_anchor，合成一条时间锚点
 *   3. 若 memories 池无 pet_name 记录且强制注入触发，用 pet.name 合成
 */
export function recallForPet(
  input: RecallWithPetInput
): RecallWithPetResult {
  const { memories, petName, rng, opts, includeTimeAnchor = true } = input;

  const result = recallFromMemories(memories, rng, opts);

  // 时间锚点补位
  if (
    includeTimeAnchor &&
    result.refs.length > 0 &&
    !result.refs.some((r) => r.kind === "time_anchor") &&
    rng() < 0.4 // 40% 概率挂一条时间锚点（避免每事件都挂，破坏自然感）
  ) {
    const anchor = pickAnchor(rng);
    const maxRefs = opts?.maxRefs ?? 4;
    const anchorRef: MemoryRef = {
      kind: "time_anchor",
      value: anchor.text,
      weight: 1,
      sourceEventId: undefined,
    };
    result.refs = [anchorRef, ...result.refs].slice(0, maxRefs);
    // 若原本没有 recallLine，用新锚点补
    if (!result.recallLine) {
      result.recallLine = `${anchor.text}发生过的事`;
    }
  }

  // pet_name 兜底合成（当 memories 池无 naming 记录时）
  //   - recallFromMemories 内部若 memories 池无 naming 记录，强制注入会静默跳过
  //   - 这里再检一次：若 hasPetName=false 且强制概率命中，合成一条 pet_name ref
  //   - 这是新 pet 刚创建、命名 memory 尚未落库时的兜底路径
  if (!result.hasPetName && rng() < (opts?.nameForceProb ?? 0.5)) {
    const ref = synthesizePetNameRef(petName);
    const maxRefs = opts?.maxRefs ?? 4;
    result.refs = [ref, ...result.refs].slice(0, maxRefs);
    result.hasPetName = true;
  }

  return result;
}
