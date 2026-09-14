"use client";
import { APP_NAME_DEFAULT } from "@/config/client-brand";

/**
 * 文件名称：page.tsx
 * 功能描述：/(pet)/letter — 回信阅读页（信纸背景 + 内容 + ≥1 条记忆引用高亮）
 * 所属模块：app/(pet)/letter
 * 验收对齐：
 *   - docs/requirements.md §3.7 回信（信纸背景 + 内容 + 至少 1 条记忆引用）
 *   - docs/dev-stage-plan.md §3 阶段 4 UI（回信展示）
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import { LetterView } from "@/ui/letter-view";
import type { RenderedText } from "@/domain/events/render";
import type { EventTypeValue, PetState } from "@/domain/types";

interface LettersResponse {
  ok: boolean;
  pet: { id: string; name: string } | null;
  letters: Array<{
    event: {
      id: string;
      ts: number;
      type: EventTypeValue;
      fsmState: PetState;
    };
    rendered: RenderedText;
  }>;
  pendingReply: {
    due: boolean;
    replyPending: boolean;
    replyDueAt: number | null;
    lastReplyAt: number | null;
    nextProactiveTs: number | null;
  } | null;
}

function LettersInner() {
  const router = useRouter();
  const { packDisplayName, packName } = useTheme();

  const [data, setData] = useState<LettersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/letters", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(`请求失败 (${res.status})`);
        return;
      }
      setData((await res.json()) as LettersResponse);
    } catch (e) {
      setError(`网络错误：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // 微任务延迟：避免 effect 同步 tick 内 setState（react-hooks/set-state-in-effect）
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!data && loading) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        正在翻找信件…
      </div>
    );
  }

  if (!data || !data.pet) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--pack-ink)" }}>
          回信
        </h1>
        <div
          className="text-sm p-6 text-center rounded-lg"
          style={{ color: "var(--muted)", background: "var(--pack-paper)" }}
        >
          {error ?? "还没有 pet，先创建一只吧。"}
          <div className="mt-3">
            <Link href="/" className="text-xs underline" style={{ color: "var(--pack-primary)" }}>
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const petName = data.pet.name;
  const pending = data.pendingReply;
  const hasPending = pending?.replyPending;
  const isDue = pending?.due;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
            回信
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {packDisplayName ?? packName ?? APP_NAME_DEFAULT} · {petName} 写给你的信
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/timeline"
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            时间线
          </Link>
          <Link
            href="/gifts"
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            物品栏
          </Link>
        </div>
      </header>

      {error && (
        <div
          className="text-sm p-3 rounded-lg"
          style={{ color: "var(--danger)", background: "var(--pack-paper)" }}
        >
          {error}
        </div>
      )}

      {/* 待回信状态提示 */}
      {hasPending && (
        <div
          className="rounded-lg p-3 text-xs"
          style={{
            background: "var(--pack-memory-ref, #f0e6d2)",
            color: "var(--pack-ink)",
          }}
        >
          {isDue
            ? `${petName} 已经写好回信了——回到时间线或同步一次就能看到。`
            : `${petName} 正在写回信，明晚或后天就能看到。`}
        </div>
      )}

      {/* 信件列表 */}
      {data.letters.length === 0 ? (
        <section
          className="rounded-lg p-6 text-center space-y-2"
          style={{
            background: "var(--pack-paper)",
            border: "1px dashed var(--pack-accent)",
          }}
        >
          <div aria-hidden className="text-3xl" style={{ color: "var(--pack-primary)" }}>
            ˚ ʚ ˚
          </div>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--pack-ink)" }}
          >
            {petName} 还没有写信。
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            送它一件物品，明天它会写一封回信过来。
          </p>
          <Link
            href="/gifts"
            className="inline-block text-xs underline mt-2"
            style={{ color: "var(--pack-primary)" }}
          >
            去物品栏 →
          </Link>
        </section>
      ) : (
        <section className="space-y-3">
          {data.letters.map((it) => (
            <LetterView
              key={it.event.id}
              event={it.event}
              petName={petName}
              rendered={it.rendered}
            />
          ))}
        </section>
      )}
    </div>
  );
}

export default function LetterPage() {
  return (
    <ThemeProvider>
      <LettersInner />
    </ThemeProvider>
  );
}
