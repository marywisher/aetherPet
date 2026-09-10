/**
 * 文件名称：render.ts
 * 功能描述：事件 → 渲染文本（把素材包 JSON 里的 slots/variants 填入占位符）
 * 所属模块：domain/events
 * 契约冻结：docs/packs-contract.md §渲染规则
 * 说明：
 *   - 领域层纯 TS，不依赖 next/react
 *   - 前端 SSR 或客户端渲染均可调用
 *   - 记忆引用会返回 highlightTokens 供前端包 <span data-mem>
 */

import type { Event, MemoryRef, Rng } from "./types";
import { pickOne } from "./rng";

/** 素材包 JSON 中 body.variants 的类型 */
export interface TextSlotTemplate {
  title?: { mode: "fixed"; default: string };
  body: {
    mode: "template";
    variants: {
      daily: string[];
      poetic: string[];
    };
    poetic_ratio: number;
  };
  sign_off?:
    | { mode: "fixed"; default: string }
    | { mode: "template"; variants: string[] };
}

export interface HighlightToken {
  kind: MemoryRef["kind"];
  value: string;
}

export interface RenderedText {
  title: string;
  body: string;
  signOff: string;
  /** 最终渲染文本中是否自然包含 pet_name（用于统计 ≥30% 要求） */
  containsPetName: boolean;
  /** 需要高亮的记忆引用 tokens */
  highlightTokens: HighlightToken[];
  /** 抽到的档位（用于调试） */
  variantTier: "daily" | "poetic";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatSpanDays(spanDays: number): string {
  if (spanDays < 1) return "0 天";
  if (spanDays < 7) return `${spanDays} 天`;
  if (spanDays < 30) {
    const weeks = Math.floor(spanDays / 7);
    return `${weeks} 周`;
  }
  const months = Math.floor(spanDays / 30);
  return `${months} 个多月`;
}

/**
 * 根据 event.memoryRefs 与 params 构造占位符的替换映射。
 *
 * 契约（docs/packs-contract.md §占位符命名）：
 *   - {pet_name}    → pet.name（从 params 兜底或调用方传入）
 *   - {item}        → item_display_name 或 item_name ref 的 value
 *   - {count}       → params.count
 *   - {recall_line} → 从 memoryRefs 提炼的自然语言锚点
 *   - {place}       → place ref 或 params.place
 *   - {destination} → params.destination
 *   - {duration_hours} / {duration_minutes} → params 对应字段
 *   - {span_days}   → params.span_days（自然化：3 天 / 2 周 / 1 个多月）
 *   - {outings}     → params.outings
 *   - {items_collected} → params.items_collected（"X 片枯叶、Y 个浆果"）
 *   - {announcement_title} / {announcement_body} → params 对应字段
 */
export function buildPlaceholderMap(
  event: Event,
  petName: string,
  extraPlaceholders: Record<string, string> = {}
): Record<string, string> {
  const map: Record<string, string> = {};
  map["pet_name"] = petName;

  // {item}：优先 params.item_display_name，其次 memoryRefs 中的 item_name
  if (typeof event.params.item_display_name === "string") {
    map["item"] = event.params.item_display_name;
  } else {
    const itemRef = event.memoryRefs.find((r) => r.kind === "item_name");
    if (itemRef) map["item"] = itemRef.value;
  }

  if (typeof event.params.count === "number") map["count"] = String(event.params.count);
  if (typeof event.params.place === "string") map["place"] = event.params.place;
  if (typeof event.params.destination === "string") map["destination"] = event.params.destination;
  if (typeof event.params.duration_hours === "number") map["duration_hours"] = String(event.params.duration_hours);
  if (typeof event.params.duration_minutes === "number") map["duration_minutes"] = String(event.params.duration_minutes);
  if (typeof event.params.span_days === "number") map["span_days"] = formatSpanDays(event.params.span_days);
  if (typeof event.params.outings === "number") map["outings"] = String(event.params.outings);
  if (typeof event.params.announcement_title === "string") map["announcement_title"] = event.params.announcement_title;
  if (typeof event.params.announcement_body === "string") map["announcement_body"] = event.params.announcement_body;

  // {items_collected}：把 items_collected 数组拼成"X 个浆果、Y 片枯叶"
  if (Array.isArray(event.params.items_collected)) {
    const list = (event.params.items_collected as { type: string; count: number }[]);
    map["items_collected"] =
      list.length === 0
        ? "一些小东西"
        : list.map((it) => `${it.count} 个 ${it.type}`).join("、");
  }

  // {recall_line}：优先 time_anchor，其次 item/place
  const timeAnchor = event.memoryRefs.find((r) => r.kind === "time_anchor");
  const itemName = event.memoryRefs.find((r) => r.kind === "item_name");
  const place = event.memoryRefs.find((r) => r.kind === "place");
  if (timeAnchor) {
    map["recall_line"] = `${timeAnchor.value}发生过的事`;
  } else if (itemName) {
    map["recall_line"] = `收到过的 ${itemName.value}`;
  } else if (place) {
    map["recall_line"] = place.value;
  } else {
    map["recall_line"] = "没什么特别的";
  }

  Object.assign(map, extraPlaceholders);
  return map;
}

function substitutePlaceholders(template: string, map: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    return map[key] ?? match;
  });
}

function rollTier(rng: Rng, poeticRatio: number): "daily" | "poetic" {
  const ratio = Math.max(0, Math.min(1, poeticRatio));
  return rng() < ratio ? "poetic" : "daily";
}

function pickVariant(rng: Rng, arr: string[]): string {
  if (arr.length === 0) return "";
  return arr[Math.floor(rng() * arr.length)];
}

function pickSignOff(
  slot: TextSlotTemplate["sign_off"],
  map: Record<string, string>,
  rng: Rng
): string {
  if (!slot) return "";
  if (slot.mode === "fixed") return substitutePlaceholders(slot.default, map);
  if (slot.mode === "template") {
    return substitutePlaceholders(pickVariant(rng, slot.variants), map);
  }
  return "";
}

/**
 * 渲染事件为可读文本。
 *
 * @param event   引擎产出的事件结构
 * @param packText 素材包中对应事件类型的 JSON 对象
 * @param petName pet 的名字（用于 {pet_name} 占位符）
 * @param rng     可注入 RNG
 */
export function renderEvent(
  event: Event,
  packText: TextSlotTemplate | null,
  petName: string,
  rng: Rng = Math.random
): RenderedText {
  if (!packText) {
    // 降级：无素材包 → 返回最小可读文本
    return {
      title: petName || "pet",
      body: `(${event.type})`,
      signOff: "",
      containsPetName: true,
      highlightTokens: event.memoryRefs.map((r) => ({ kind: r.kind, value: r.value })),
      variantTier: "daily",
    };
  }

  const map = buildPlaceholderMap(event, petName);
  const tier = rollTier(rng, packText.body.poetic_ratio);
  const variants = tier === "poetic" ? packText.body.variants.poetic : packText.body.variants.daily;
  const bodyTemplate = pickVariant(rng, variants);
  const body = substitutePlaceholders(bodyTemplate, map);
  const titleTemplate = packText.title?.mode === "fixed" ? packText.title.default : "";
  const title = substitutePlaceholders(titleTemplate, map);
  const signOff = pickSignOff(packText.sign_off, map, rng);

  const containsPetName = title.includes(petName) || body.includes(petName) || signOff.includes(petName);

  // 高亮 tokens：所有出现在渲染文本里的 memoryRef.value
  const highlightTokens: HighlightToken[] = [];
  const renderedAll = `${title}\n${body}\n${signOff}`;
  for (const ref of event.memoryRefs) {
    if (ref.value && renderedAll.includes(ref.value)) {
      highlightTokens.push({ kind: ref.kind, value: ref.value });
    }
  }

  return { title, body, signOff, containsPetName, highlightTokens, variantTier: tier };
}
