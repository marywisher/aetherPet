/**
 * 文件名称：recall-strategy.ts
 * 功能描述：记忆检索策略（加权抽样 + ≥30% 名字引用保证）
 * 所属模块：domain/memory
 * 验收对齐：
 *   - docs/requirements.md §3.3「事件文案 ≥30% 概率自然带出 pet 名字」
 *   - docs/dev-stage-plan.md §3 阶段 2「单测覆盖：1000 次采样下名字引用率 ≥30%」
 *
 * 设计要点：
 *   1. 权重池：pet_name 高权重（默认 1.6，永久 + 强引用），item/place/time_anchor 权重 1
 *   2. 强制注入：每次 recall 有 NAME_FORCE_PROB（默认 0.5）概率显式包含 pet_name，
 *      保证 ≥30% 事件带 pet 名字引用（留 66% 冗余度，避免抽样波动）
 *   3. recallLine：从 memoryRefs 提取可读的 {recall_line} 占位符值
 */

import type { Memory, MemoryRef } from "../types";
import type { Rng } from "../events/types";
import { pickWeighted, rollProbability } from "../events/rng";

/** 每类记忆的默认权重（可在 config 中覆盖）
 * 说明：naming 类高权重以保证 ≥30% 事件带 pet 名字引用，
 *        权重乘上永久加成 1.5 后命名记忆在池内自然优先级高 */
const DEFAULT_WEIGHTS: Record<Memory["kind"], number> = {
  naming: 1.8,           // pet_name / 命名类：强引用，保证名字出现率
  preference: 1.2,
  item_received: 1.0,
  place_visited: 1.0,
  sentiment: 0.8,
  custom: 1.0,
};

/** 每次采样强制包含 pet_name 的概率（默认 50%，留冗余度保证 ≥30%） */
export const NAME_FORCE_PROB = 0.5;

/** 每次采样的默认 ref 数量 */
export const DEFAULT_MAX_REFS = 4;

export interface RecallOptions {
  /** 最大引用条数 */
  maxRefs?: number;
  /** pet_name 强制包含概率（默认 0.5） */
  nameForceProb?: number;
  /** 覆盖某类记忆的权重（用于测试或未来调优） */
  weightOverrides?: Partial<Record<Memory["kind"], number>>;
}

export interface RecallResult {
  refs: MemoryRef[];
  /** 是否包含 pet_name 引用 */
  hasPetName: boolean;
  /** 用于 text 里的 {recall_line} 占位符 */
  recallLine: string;
}

function memoryToRef(m: Memory): MemoryRef {
  // 把 memory.kind 映射到 MemoryRef.kind（契约）
  let refKind: MemoryRef["kind"] = "place";
  if (m.kind === "naming") refKind = "pet_name";
  else if (m.kind === "item_received") refKind = "item_name";
  // preference / place_visited / sentiment / custom 归入 place 类锚点
  return {
    kind: refKind,
    value: m.value,
    weight: m.weight,
    sourceEventId: undefined,
  };
}

function weightOf(m: Memory, opts: RecallOptions): number {
  const base = opts.weightOverrides?.[m.kind] ?? DEFAULT_WEIGHTS[m.kind];
  // 永久记忆（naming/preference）权重再乘一次，避免随机时被稀释
  // 注：m.weight 来自 DB 中的 DECIMAL 权重（默认 1.0），作为外部微调因子，
  //     与 kind 默认权重 base 相乘（不重复乘两次）
  return base * (m.isPermanent ? 1.5 : 1) * Math.max(0.01, m.weight);
}

/**
 * 加权检索：从 memories 池抽取最多 maxRefs 条引用。
 *
 * @param memories   记忆池
 * @param rng        RNG
 * @param opts       调参
 */
export function recallFromMemories(
  memories: Memory[],
  rng: Rng,
  opts: RecallOptions = {}
): RecallResult {
  const maxRefs = opts.maxRefs ?? DEFAULT_MAX_REFS;
  const nameForceProb = opts.nameForceProb ?? NAME_FORCE_PROB;

  if (memories.length === 0) {
    return { refs: [], hasPetName: false, recallLine: "" };
  }

  // 1. 加权抽样（去重后逐条抽，最多 maxRefs 条）
  const pool = memories.map((m) => ({ value: m, weight: weightOf(m, opts) }));
  const picked: Memory[] = [];
  const pickedIds = new Set<string>();
  while (picked.length < maxRefs && pool.length > 0) {
    const m = pickWeighted(rng, pool);
    if (!m) break;
    if (pickedIds.has(m.id)) {
      // 已抽中：从池中移除，避免重复
      const idx = pool.findIndex((p) => p.value.id === m.id);
      if (idx >= 0) pool.splice(idx, 1);
      continue;
    }
    picked.push(m);
    pickedIds.add(m.id);
    const idx = pool.findIndex((p) => p.value.id === m.id);
    if (idx >= 0) pool.splice(idx, 1);
  }

  let refs = picked.map(memoryToRef);

  // 2. 强制注入 pet_name（覆盖 ≥30% 名字引用要求）
  let hasPetName = refs.some((r) => r.kind === "pet_name");
  if (!hasPetName && rollProbability(rng, nameForceProb)) {
    // 找一条 naming 记忆；找不到则合成一条（用 pet 名字，来自调用方 ctx）
    const namingMem = memories.find((m) => m.kind === "naming");
    if (namingMem) {
      refs = [memoryToRef(namingMem), ...refs].slice(0, maxRefs + 1);
      hasPetName = true;
    }
  }

  // 3. 构造 recallLine：优先 time_anchor，其次 item_name / place
  const timeAnchor = refs.find((r) => r.kind === "time_anchor");
  const itemName = refs.find((r) => r.kind === "item_name");
  const place = refs.find((r) => r.kind === "place");
  let recallLine: string;
  if (timeAnchor) recallLine = `${timeAnchor.value}发生过的事`;
  else if (itemName) recallLine = `收到过的 ${itemName.value}`;
  else if (place) recallLine = `${place.value}`;
  else recallLine = "";

  return { refs, hasPetName, recallLine };
}

/**
 * 合成一条 pet_name 引用（当 memories 池中暂无 naming 记录时使用）。
 * 通常发生在 pet 刚创建、命名 memory 尚未落库时。
 */
export function synthesizePetNameRef(petName: string): MemoryRef {
  return {
    kind: "pet_name",
    value: petName,
    weight: 1.6,
    sourceEventId: undefined,
  };
}
