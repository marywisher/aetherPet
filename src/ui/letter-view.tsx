"use client";

/**
 * 文件名称：letter-view.tsx
 * 功能描述：信纸阅读组件（供 /letter 页使用）
 * 所属模块：ui
 * 验收对齐：
 *   - docs/requirements.md §3.7 回信（信纸背景 + 内容 + ≥1 条记忆引用高亮）
 *   - docs/dev-stage-plan.md §3 阶段 4 UI（回信展示）
 */

import type { RenderedText, HighlightToken } from "@/domain/events/render";
import type { EventTypeValue, PetState } from "@/domain/types";

export interface LetterViewProps {
  event: {
    id: string;
    ts: number;
    type: EventTypeValue;
    fsmState: PetState;
  };
  petName: string;
  rendered: RenderedText;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, tokens: HighlightToken[]): React.ReactNode {
  if (!text || tokens.length === 0) return text;
  const sorted = [...tokens].sort((a, b) => b.value.length - a.value.length);
  if (sorted.length === 0) return text;
  const re = new RegExp(
    `(${sorted.map((t) => escapeRegExp(t.value)).join("|")})`,
    "g"
  );
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

const TYPE_LABELS: Record<string, string> = {
  reply_letter: "回信",
  spontaneous_letter: "自主信",
};

/**
 * 单封信的信纸展示。
 */
export function LetterView({ event, petName, rendered }: LetterViewProps) {
  const d = new Date(event.ts);
  const dateStr = d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const timeStr = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const typeLabel = TYPE_LABELS[event.type] ?? event.type;

  return (
    <article
      className="rounded-lg p-6 space-y-4"
      style={{
        background: "var(--pack-paper)",
        color: "var(--pack-ink)",
        border: "1px solid var(--pack-accent)",
        borderLeft: "6px solid var(--pack-primary)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <header
        className="flex items-center justify-between text-xs"
        style={{ color: "var(--muted)" }}
      >
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{
            background: "var(--pack-primary)",
            color: "white",
          }}
        >
          {typeLabel}
        </span>
        <span>
          {dateStr} · {timeStr}
        </span>
      </header>

      {rendered.title && (
        <h3
          className="text-lg font-semibold"
          style={{ fontFamily: "KaiTi, STKaiti, serif" }}
        >
          {highlight(rendered.title, rendered.highlightTokens)}
        </h3>
      )}

      <p
        className="text-sm leading-loose whitespace-pre-wrap"
        style={{ fontFamily: "KaiTi, STKaiti, serif" }}
      >
        {highlight(rendered.body, rendered.highlightTokens)}
      </p>

      {rendered.signOff && (
        <p
          className="text-right text-xs"
          style={{
            color: "var(--muted)",
            fontFamily: "KaiTi, STKaiti, serif",
          }}
        >
          {highlight(rendered.signOff, rendered.highlightTokens)}
        </p>
      )}

      {rendered.highlightTokens.length > 0 && (
        <footer
          className="flex flex-wrap gap-1 pt-2"
          style={{
            borderTop: "1px dashed var(--pack-accent)",
          }}
        >
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            记忆引用：
          </span>
          {rendered.highlightTokens.map((t, i) => (
            <span
              key={i}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: "var(--pack-memory-ref)",
                color: "var(--pack-ink)",
              }}
            >
              {t.value}
            </span>
          ))}
        </footer>
      )}

      <p className="text-xs italic" style={{ color: "var(--muted)" }}>
        — 来自 {petName}
      </p>
    </article>
  );
}
