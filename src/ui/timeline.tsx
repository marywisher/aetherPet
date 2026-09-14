"use client";

/**
 * 文件名称：timeline.tsx
 * 功能描述：时间线视图（渐进披露 + 类型标签 + 记忆引用高亮 + 状态徽章 + 分页）
 * 所属模块：ui
 * 验收对齐：
 *   - docs/requirements.md §3.5 事件流（单一时间轴、类型标签、记忆引用高亮、无回复按钮）
 *   - docs/dev-stage-plan.md §3 阶段 3 时间线 UI（渐进披露 + 分页 20 条/页）
 *
 * 组件契约：
 *   - TimelineView：完整时间线视图（分页 + 类型筛选 + 记忆引用角标）
 *   - TimelineEntryCard：渐进披露入口卡片（"过去 X 天"摘要 + 查看全部入口）
 *   - TypeTag / StateBadge / MemoryRefBadge：可复用的展示原子
 *
 * 说明：
 *   - 前端不感知事件引擎内部结构，只消费 event + rendered（来自 /api/pet/timeline）
 *   - 记忆引用通过 rendered.highlightTokens 在正文中高亮（EventCard 已实现）
 *   - 本组件额外把 memoryRefs 展示为角标（"pet_name / item / time_anchor / place"）
 *   - 无回复按钮（UI 强制；requirements §3.5"宠物单向输出、无社交压力"）
 */

import { Fragment, useMemo, useState } from "react";
import { EventCard } from "./event-card";
import type { EventTypeValue, PetState } from "@/domain/types";
import type { RenderedText, HighlightToken } from "@/domain/events/render";

/** 时间线单条事件的数据结构（与 /api/pet/timeline 响应一致） */
export interface TimelineItem {
  event: {
    id: string;
    type: EventTypeValue;
    ts: number;
    fsmState: PetState;
    isAggregate?: boolean;
    aggregateSpanDays?: number | null;
    generatedByCatchup?: boolean;
    memoryRefs?: Array<{ kind: string; value: string }>;
  };
  rendered: RenderedText;
}

/** 时间线 API 响应 */
export interface TimelineApiResponse {
  ok: boolean;
  pet: { id: string; name: string; state: PetState; activePackName?: string } | null;
  events: TimelineItem[];
  total?: number;
  hasMore?: boolean;
  latestAggregate:
    | {
        event: { ts: number; type: EventTypeValue; aggregateSpanDays?: number | null };
        rendered: RenderedText;
      }
    | null;
}

export const TYPE_LABELS: Record<EventTypeValue, string> = {
  outing: "散步",
  watching_water: "看水",
  counting_leaves: "数叶子",
  self_talk: "自言自语",
  brought_item: "带回",
  reply_letter: "回信",
  spontaneous_letter: "冒信",
  aggregate_summary: "聚合",
  system_announce: "公告",
  daily_grant: "馈赠",
  offer_received: "送赠",
};

export const STATE_LABELS: Record<PetState, string> = {
  at_home: "在家",
  out_walking: "出门",
  on_trip: "旅行",
};

export const MEMORY_REF_KIND_LABELS: Record<string, string> = {
  pet_name: "名字",
  item_name: "物品",
  time_anchor: "时间",
  place: "地点",
};

/** 类型标签（用于时间线单条事件上方的标签，与 EventCard 内标签同源） */
export function TypeTag({ type }: { type: EventTypeValue }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-xs"
      style={{ background: "var(--pack-accent)", color: "white" }}
    >
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

/** 状态徽章（"当时状态"：在家/出门/旅行） */
export function StateBadge({ state }: { state: PetState }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
      style={{
        background: "var(--pack-paper)",
        color: "var(--pack-ink)",
        border: "1px solid var(--pack-accent)",
      }}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: "var(--pack-primary)" }}
      />
      当时 {STATE_LABELS[state] ?? state}
    </span>
  );
}

/** 记忆引用角标（浅灰底色 + 角标，requirements §3.5） */
export function MemoryRefBadge({ item }: { item: { kind: string; value: string } }) {
  const label = MEMORY_REF_KIND_LABELS[item.kind] ?? item.kind;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
      style={{
        background: "var(--pack-memory-ref, #f0e6d2)",
        color: "var(--pack-ink)",
        textDecoration: "underline",
        textDecorationStyle: "dotted",
      }}
      title={`记忆引用：${label} - ${item.value}`}
    >
      <span aria-hidden>◆</span>
      {label}
    </span>
  );
}

/** 高亮 tokens（从 rendered.highlightTokens 提取，用于事件卡片外的补充展示） */
export function HighlightTokens({ tokens }: { tokens: HighlightToken[] }) {
  if (tokens.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tokens.map((t, i) => (
        <MemoryRefBadge key={i} item={t} />
      ))}
    </div>
  );
}

export interface TimelineViewProps {
  petName: string;
  items: TimelineItem[];
  loading?: boolean;
  error?: string | null;
  total?: number;
  hasMore?: boolean;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** 是否显示类型筛选器（默认 true） */
  showTypeFilter?: boolean;
  /** 是否显示"加载更多"按钮（hasMore 为 true 时） */
  showLoadMore?: boolean;
  /** 是否显示记忆引用角标（默认 true；用于阶段 3 记忆高亮验收） */
  showMemoryRefs?: boolean;
  /**
   * 新旧分隔线：在第一条旧事件（ts < dividerAfterTs）前插入“更早之前”分割线。
   * 仅当新旧都非空时显示。语义 = sync.catchup.offlineStartTs。
   */
  dividerAfterTs?: number | null;
}

/**
 * 完整时间线视图（分页 + 类型筛选 + 记忆引用角标）。
 *
 * 使用示例：
 * ```tsx
 * <TimelineView
 *   petName="小圆"
 *   items={data.events}
 *   total={data.total}
 *   hasMore={data.hasMore}
 *   page={1}
 *   onPageChange={loadPage}
 * />
 * ```
 */
export function TimelineView({
  petName,
  items,
  loading = false,
  error = null,
  total,
  hasMore = false,
  page = 1,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  showTypeFilter = true,
  showLoadMore = true,
  showMemoryRefs = true,
  dividerAfterTs = null,
}: TimelineViewProps) {
  const [activeTypes, setActiveTypes] = useState<Set<EventTypeValue>>(new Set());

  const toggleType = (type: EventTypeValue) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const displayed = useMemo(() => {
    if (activeTypes.size === 0) return items;
    return items.filter((it) => activeTypes.has(it.event.type));
  }, [items, activeTypes]);

  const allTypes = useMemo(() => {
    const set = new Set<EventTypeValue>();
    items.forEach((it) => set.add(it.event.type));
    return Array.from(set);
  }, [items]);

  // 新旧分隔线位置：在过滤后的列表里找第一个“旧事件”（ts < dividerAfterTs）。
  // idx === -1 → 全是新事件不插线；idx === 0 → 全是旧事件不插线；idx > 0 → 新旧并存，在 idx 前插线。
  const dividerIndex = useMemo(() => {
    if (dividerAfterTs == null || !Number.isFinite(dividerAfterTs)) return -1;
    return displayed.findIndex((it) => it.event.ts < (dividerAfterTs as number));
  }, [displayed, dividerAfterTs]);
  const showDivider = dividerIndex > 0;

  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="space-y-3">
      {showTypeFilter && allTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button
            onClick={() => setActiveTypes(new Set())}
            className="px-2 py-0.5 rounded border"
            style={{
              borderColor: activeTypes.size === 0 ? "var(--pack-primary)" : "var(--muted)",
              background: activeTypes.size === 0 ? "var(--pack-paper)" : "transparent",
              color: "var(--pack-ink)",
            }}
          >
            全部
          </button>
          {allTypes.map((t) => {
            const active = activeTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className="px-2 py-0.5 rounded border"
                style={{
                  borderColor: active ? "var(--pack-primary)" : "var(--muted)",
                  background: active ? "var(--pack-paper)" : "transparent",
                  color: "var(--pack-ink)",
                }}
              >
                {TYPE_LABELS[t] ?? t}
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div
          className="text-sm p-6 text-center rounded-lg"
          style={{ color: "var(--muted)", background: "var(--pack-paper)" }}
        >
          正在整理 {petName} 的时间线…
        </div>
      )}

      {!loading && error && (
        <div
          className="text-sm p-3 rounded-lg"
          style={{ color: "var(--danger)", background: "var(--pack-paper)" }}
        >
          {error}
        </div>
      )}

      {!loading && !error && displayed.length === 0 && (
        <div
          className="text-sm p-6 text-center rounded-lg"
          style={{ color: "var(--muted)", background: "var(--pack-paper)" }}
        >
          {items.length === 0
            ? `${petName} 还没有事件，去触发一次随机事件试试。`
            : "当前筛选下没有事件。"}
        </div>
      )}

      {!loading &&
        displayed.map((it, idx) => (
          <Fragment key={it.event.id}>
            {showDivider && idx === dividerIndex && (
              <div className="flex items-center gap-3 py-0.5" style={{ color: "var(--muted)" }}>
                <span className="text-xs shrink-0">更早之前</span>
                <span className="flex-1 h-px" style={{ background: "currentColor", opacity: 0.35 }} />
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <TypeTag type={it.event.type} />
                <StateBadge state={it.event.fsmState} />
                {showMemoryRefs && <HighlightTokens tokens={it.rendered.highlightTokens} />}
              </div>
              <EventCard event={it.event} petName={petName} rendered={it.rendered} />
            </div>
          </Fragment>
        ))}

      {!loading && (showLoadMore || totalPages > 1) && (
        <div
          className="flex items-center justify-between gap-2 text-xs pt-2"
          style={{ color: "var(--muted)" }}
        >
          <span>
            第 {page} 页
            {total !== undefined ? ` / 共 ${totalPages} 页 · ${total} 条` : ""}
          </span>
          <div className="flex gap-2">
            {hasMore && onPageChange && (
              <button
                onClick={() => onPageChange(page + 1)}
                className="px-3 py-1 rounded text-sm"
                style={{ background: "var(--pack-accent)", color: "white" }}
              >
                查看更多
              </button>
            )}
            {onPageSizeChange && (
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="px-2 py-1 rounded border text-xs"
                style={{ borderColor: "var(--muted)", color: "var(--pack-ink)" }}
              >
                <option value={10}>10 条/页</option>
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
              </select>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface TimelineEntryCardProps {
  petName: string;
  /** 覆盖天数（0 表示无聚合） */
  spanDays: number;
  /** 期间事件数（含聚合摘要） */
  eventCount: number;
  /** 聚合摘要事件（有则展示摘要文本） */
  summary?: RenderedText | null;
  /** 点击展开事件流的回调 */
  onExpand: () => void;
}

/**
 * 渐进披露入口卡片：时间线首屏只显示"过去 X 天"入口卡片，点开才展开事件流。
 *
 * 对齐 requirements §3.4"补算结果渐进披露"与 §6 #4 验收。
 */
export function TimelineEntryCard({
  petName,
  spanDays,
  eventCount,
  summary,
  onExpand,
}: TimelineEntryCardProps) {
  const spanLabel = spanDays < 1
    ? "今天"
    : spanDays < 7
      ? `${spanDays} 天`
      : spanDays < 30
        ? `${Math.floor(spanDays / 7)} 周`
        : `${Math.floor(spanDays / 30)} 个多月`;

  return (
    <button
      onClick={onExpand}
      className="w-full text-left rounded-lg p-4 space-y-2 hover:opacity-95"
      style={{
        background: "var(--pack-paper)",
        border: "2px solid var(--pack-primary)",
        borderLeft: "6px solid var(--pack-primary)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
        color: "var(--pack-ink)",
      }}
      aria-label={`查看 ${petName} 过去 ${spanLabel} 的事件流`}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
          style={{ background: "var(--pack-primary)", color: "white" }}
        >
          过去 {spanLabel}
        </span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {eventCount} 件事 · 看看这段日子
      </span>
      </div>
      {summary && (summary.title || summary.body) ? (
        <p
          className="text-sm leading-relaxed"
          style={{ fontFamily: "KaiTi, STKaiti, serif" }}
        >
          {summary.body || summary.title}
        </p>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {petName} 在这段时间里悄悄发生了一些事。
        </p>
      )}
    </button>
  );
}
