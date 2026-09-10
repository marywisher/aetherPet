/**
 * 文件名称：rng.ts
 * 功能描述：随机数工具（均匀分布 + 加权抽样 + 确定性 seeded RNG）
 * 所属模块：domain/events
 */

import type { Rng } from "./types";

/** 均匀分布 [min, max) 浮点 */
export function randFloat(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** 均匀分布整数 [min, max] */
export function randInt(rng: Rng, min: number, max: number): number {
  const span = max - min + 1;
  return min + Math.floor(rng() * span);
}

/** 从数组中均匀随机取一个元素（空数组返回 undefined） */
export function pickOne<T>(rng: Rng, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

/** 加权抽样：items[i] 权重越大，被选中概率越高 */
export function pickWeighted<T>(
  rng: Rng,
  items: readonly { value: T; weight: number }[]
): T | undefined {
  if (items.length === 0) return undefined;
  const total = items.reduce((acc, it) => acc + Math.max(0, it.weight), 0);
  if (total <= 0) return pickOne(rng, items.map((i) => i.value));

  let r = rng() * total;
  for (const it of items) {
    const w = Math.max(0, it.weight);
    r -= w;
    if (r <= 0) return it.value;
  }
  // 浮点误差兜底
  return items[items.length - 1].value;
}

/**
 * 生成确定性 seeded RNG（mulberry32）。
 * 用于单测：给定 seed，1000 次采样可完全复现。
 */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 是否满足概率 p（0..1） */
export function rollProbability(rng: Rng, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return rng() < p;
}
