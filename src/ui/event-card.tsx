"use client";

/**
 * 文件名称：event-card.tsx
 * 功能描述：事件卡片（记忆引用高亮 + 类型标签）
 * 所属模块：ui
 * 验收对齐：
 *   - docs/requirements.md §3.5 事件流（记忆引用高亮）
 *   - docs/dev-stage-plan.md §3 阶段 2 事件卡片最小渲染
 */

import type { EventTypeValue } from "@/domain/types";
import type { RenderedText } from "@/domain/events/render";

export interface EventCardProps {
  event: {
    id: string;
    type: EventTypeValue;
    ts: number;
    fsmState: "at_home" | "out_walking" | "on_trip";
  };
  petName: string;
  rendered: RenderedText;
}

const TYPE_LABELS: Record<string, string> = {
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

const STATE_LABELS: Record<string, string> = {
  at_home: "在家",
  out_walking: "出门",
  on_trip: "旅行",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, tokens: { value: string }[]): React.ReactNode {
  if (!text || tokens.length === 0) return text;
  const sorted = [...tokens].sort((a, b) => b.value.length - a.value.length);
  if (sorted.length === 0) return text;
  const re = new RegExp(`(${sorted.map((t) => escapeRegExp(t.value)).join("|")})`, "g");
  const parts = text.split(re);
  const valueSet = new Set(sorted.map((t) => t.value));
  return parts.map((part, i) =>
    valueSet.has(part) ? (
      <span
        key={i}
        data-mem
        style={{
          background: "var(--pack-memory-ref)",
          padding: "0 2px",
          borderRadius: 2,
          textDecoration: "underline",
          textDecorationStyle: "dotted",
        }}
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function EventCard({ event, petName, rendered }: EventCardProps) {
  const typeLabel = TYPE_LABELS[event.type] ?? event.type;
  const stateLabel = STATE_LABELS[event.fsmState] ?? event.fsmState;
  const d = new Date(event.ts);
  const tsLabel = d.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article
      className="rounded-lg p-4 space-y-2"
      style={{
        background: "var(--pack-paper)",
        color: "var(--pack-ink)",
        borderLeft: "3px solid var(--pack-primary)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <header className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
        <span className="inline-flex items-center gap-1">
          <span
            className="px-1.5 py-0.5 rounded"
            style={{ background: "var(--pack-accent)", color: "white" }}
          >
            {typeLabel}
          </span>
          <span className="opacity-80">· {stateLabel}</span>
        </span>
        <span>{tsLabel}</span>
      </header>
      {rendered.title && (
        <h3
          className="text-base font-semibold"
          style={{ fontFamily: "KaiTi, STKaiti, serif" }}
        >
          {highlight(rendered.title, rendered.highlightTokens)}
        </h3>
      )}
      <p className="text-sm leading-relaxed" style={{ fontFamily: "KaiTi, STKaiti, serif" }}>
        {highlight(rendered.body, rendered.highlightTokens)}
      </p>
      {rendered.signOff && (
        <p className="text-right text-xs" style={{ color: "var(--muted)" }}>
          {highlight(rendered.signOff, rendered.highlightTokens)}
        </p>
      )}
      {event.type === "spontaneous_letter" && (
        <p className="text-xs italic" style={{ color: "var(--muted)" }}>
          （{petName} 的一封自主信）
        </p>
      )}
    </article>
  );
}
