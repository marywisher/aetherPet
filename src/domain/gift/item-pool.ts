/**
 * 文件名称：item-pool.ts
 * 功能描述：物品池（≥8 种 seed 数据 + 加权抽取 + 排除最近 3 次重复 + 空池兜底）
 * 所属模块：domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 每日馈赠（物品池 ≥8 种，加权随机，排除最近 3 次重复，空池兜底文案）
 *   - docs/dev-stage-plan.md §3 阶段 4 物品池模块
 *
 * 设计要点：
 *   1. 纯 TS 领域层，不依赖 next/react/mysql（可直接单测）
 *   2. SEED_ITEMS 是"代码级 seed"，与 002_seed_items.sql 保持一致（migration 只是把同样的数据写入 items 表）
 *   3. pickWithExclusion 排除最近 3 次；若排除后池空则回退到完整池；池本身为空时返回 fallback
 *   4. 排除列表长度受 REPEAT_WINDOW=3 限制（需求明确）
 *
 * 契约：
 *   - ItemSeed 结构对齐 items 表非空字段（id/display_name/description/icon_path/rarity_weight/category）
 *   - 排除逻辑：excludeIds 里出现过的 itemId 在本次抽取中被跳过
 *   - 空池兜底：pool 长度 < 1 时返回 { kind: "fallback" }，携带文案
 */

import type { Rng } from "../events/types";
import { pickWeighted } from "../events/rng";

/** 物品分类（对齐 items.category，MVP 4 类） */
export type ItemCategory = "fruit" | "plant" | "stone" | "misc";

/** 代码级 seed 数据（与 002_seed_items.sql 保持同步） */
export interface ItemSeed {
  /** slug 形式的 id（如 'berry'） */
  id: string;
  /** 展示名（如 '浆果'） */
  displayName: string;
  /** 描述（可空） */
  description: string | null;
  /** 素材包内图标路径 */
  iconPath: string;
  /** 加权抽取的权重（越大越容易抽到；默认 1.0） */
  rarityWeight: number;
  /** 分类 */
  category: ItemCategory;
}

/** 抽取窗口：排除最近 N 次重复（默认 3，需求明确） */
export const REPEAT_WINDOW = 3;

/**
 * 代码级物品池 seed（≥8 种；对齐需求 §3.7 与 CONTEXT.md 「物品」）。
 *
 * 顺序即默认顺序（不参与加权抽取排序）；rarityWeight 决定概率。
 * 说明：rarityWeight 分布：
 *   - 常见：浆果/枯叶/石子/蒲公英/木片（1.2）
 *   - 中等：松果/露珠草叶（0.9）
 *   - 稀有：贝壳/羽毛（0.5）
 *
 * 空池兜底文案（pool.length === 0 时使用）：
 */
export const SEED_ITEMS: readonly ItemSeed[] = [
  {
    id: "berry",
    displayName: "浆果",
    description: "红彤彤的一颗，看起来甜。",
    iconPath: "icons/items/berry.png",
    rarityWeight: 1.2,
    category: "fruit",
  },
  {
    id: "dry-leaf",
    displayName: "枯叶",
    description: "秋天的一片。",
    iconPath: "icons/items/dry-leaf.png",
    rarityWeight: 1.2,
    category: "plant",
  },
  {
    id: "stone",
    displayName: "石子",
    description: "河边捡的，很圆。",
    iconPath: "icons/items/stone.png",
    rarityWeight: 1.2,
    category: "stone",
  },
  {
    id: "dandelion",
    displayName: "蒲公英",
    description: "一吹就散。",
    iconPath: "icons/items/dandelion.png",
    rarityWeight: 1.2,
    category: "plant",
  },
  {
    id: "pinecone",
    displayName: "松果",
    description: "松树上掉下来的。",
    iconPath: "icons/items/pinecone.png",
    rarityWeight: 0.9,
    category: "plant",
  },
  {
    id: "dew-grass",
    displayName: "露珠草叶",
    description: "叶尖上还挂着露。",
    iconPath: "icons/items/dew-grass.png",
    rarityWeight: 0.9,
    category: "plant",
  },
  {
    id: "wood-shard",
    displayName: "木片",
    description: "窗台上不知何时出现的。",
    iconPath: "icons/items/wood-shard.png",
    rarityWeight: 1.2,
    category: "misc",
  },
  {
    id: "shell",
    displayName: "贝壳",
    description: "很轻，能听见海。",
    iconPath: "icons/items/shell.png",
    rarityWeight: 0.5,
    category: "misc",
  },
  {
    id: "feather",
    displayName: "羽毛",
    description: "不知道是什么鸟的。",
    iconPath: "icons/items/feather.png",
    rarityWeight: 0.5,
    category: "misc",
  },
];

/** 空池兜底文案（需求：「空池兜底文案」） */
export const EMPTY_POOL_FALLBACK_MESSAGE =
  "今天小圆收到了一份没写名字的小礼物。";

/** 抽取结果（含兜底） */
export type PickResult =
  | { kind: "picked"; item: ItemSeed; fellBackToUnrestricted: boolean }
  | { kind: "fallback"; message: string; reason: "empty_pool" };

/**
 * 加权抽取（不排除）：pool 空时返回 undefined。
 * 直接复用 domain/events/rng.ts 的 pickWeighted。
 */
export function pickWeightedFromPool(
  pool: readonly ItemSeed[],
  rng: Rng
): ItemSeed | undefined {
  if (pool.length === 0) return undefined;
  return pickWeighted(
    rng,
    pool.map((it) => ({ value: it, weight: it.rarityWeight }))
  );
}

/**
 * 加权抽取 + 排除最近 N 次重复。
 *
 * 规则：
 *   1. 从 pool 中排除 excludeIds 里的 itemId
 *   2. 排除后池非空 → 从剩余池中加权抽取
 *   3. 排除后池为空（罕见，需 seed 数量 ≤ excludeIds 长度）→ 放宽回完整池加权抽取
 *   4. pool 本身为空 → 返回 fallback
 *
 * @param pool         候选池（一般传 SEED_ITEMS）
 * @param excludeIds   最近 N 次的 item_id（长度不超过 REPEAT_WINDOW；内部会截断）
 * @param rng          可注入 RNG（便于单测确定性回放）
 */
export function pickWithExclusion(
  pool: readonly ItemSeed[],
  excludeIds: readonly string[],
  rng: Rng
): PickResult {
  // 4. pool 本身为空
  if (pool.length === 0) {
    return {
      kind: "fallback",
      message: EMPTY_POOL_FALLBACK_MESSAGE,
      reason: "empty_pool",
    };
  }

  // 截断 excludeIds 到 REPEAT_WINDOW
  const excluded = new Set(excludeIds.slice(-REPEAT_WINDOW));

  // 1-2. 排除后池非空 → 直接抽
  const filtered = pool.filter((it) => !excluded.has(it.id));
  if (filtered.length > 0) {
    const picked = pickWeightedFromPool(filtered, rng);
    if (picked) {
      return { kind: "picked", item: picked, fellBackToUnrestricted: false };
    }
    // 理论上不会到这里（filtered 非空时 pickWeighted 一定返回）
  }

  // 3. 排除后池空 → 放宽到完整池
  const picked = pickWeightedFromPool(pool, rng);
  if (picked) {
    return { kind: "picked", item: picked, fellBackToUnrestricted: true };
  }

  // 极端兜底：完整池也抽不出（理论上不会）
  return {
    kind: "fallback",
    message: EMPTY_POOL_FALLBACK_MESSAGE,
    reason: "empty_pool",
  };
}

/**
 * 把 ItemSeed 序列化成 items 表的 INSERT 参数（供 migration / ensureSeedItems 用）。
 * 纯函数，便于单测。
 */
export function toItemsRow(item: ItemSeed): {
  id: string;
  display_name: string;
  description: string | null;
  icon_path: string;
  rarity_weight: number;
  category: string | null;
} {
  return {
    id: item.id,
    display_name: item.displayName,
    description: item.description,
    icon_path: item.iconPath,
    rarity_weight: item.rarityWeight,
    category: item.category,
  };
}
