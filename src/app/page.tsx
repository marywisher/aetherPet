"use client";

/**
 * 文件名称：page.tsx
 * 功能描述：首页（无 pet → 跳创建；有 pet → 显示时间线 + 开发工具按钮）
 * 所属模块：app
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 2 演示步骤 1/2/3
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import { EventCard } from "@/ui/event-card";
import type { EventTypeValue, PetState } from "@/domain/types";
import type { RenderedText } from "@/domain/events/render";

interface TimelineItem {
  event: {
    id: string;
    type: EventTypeValue;
    ts: number;
    fsmState: PetState;
  };
  rendered: RenderedText;
}

interface TimelineResponse {
  ok: boolean;
  pet: { id: string; name: string; state: PetState } | null;
  events: TimelineItem[];
}

const FORCE_TYPES: EventTypeValue[] = [
  "outing",
  "watching_water",
  "counting_leaves",
  "self_talk",
  "brought_item",
  "spontaneous_letter",
];

function HomeInner() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [petName, setPetName] = useState<string | null>(null);
  const [petState, setPetState] = useState<PetState>("at_home");
  const [events, setEvents] = useState<TimelineItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [devTip, setDevTip] = useState<string | null>(null);
  const { packDisplayName, packName } = useTheme();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pet/timeline", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = (await res.json()) as TimelineResponse;
      if (!data.ok) return;
      if (!data.pet) {
        router.push("/create-pet");
        return;
      }
      setPetName(data.pet.name);
      setPetState(data.pet.state);
      setEvents(data.events);
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const generateEvent = async (type?: EventTypeValue) => {
    setGenerating(true);
    setDevTip(null);
    try {
      const res = await fetch("/api/pet/generate-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type ? { type } : {}),
      });
      if (res.status === 403) {
        setDevTip("生产模式禁用了开发端点");
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        setDevTip(err?.error ?? "生成失败");
        return;
      }
      const data = await res.json();
      setPetState(data.nextPet.state);
      await load();
    } catch (e) {
      setDevTip(`网络错误：${String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  if (checking) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        正在唤醒 {packDisplayName ?? packName ?? "aetherPet"}…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 pb-32 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
            {petName}
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {packDisplayName ?? packName ?? "aetherPet"} ·{" "}
            {petState === "at_home"
              ? "在家"
              : petState === "out_walking"
                ? "出门中"
                : "旅行中"}
          </p>
        </div>
        <a href="/settings" className="text-xs underline" style={{ color: "var(--muted)" }}>
          设置
        </a>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          最近发生的事
        </h2>
        {events.length === 0 ? (
          <div className="text-sm p-6 text-center rounded-lg" style={{ color: "var(--muted)", background: "var(--pack-paper)" }}>
            还没有事件。点击"触发一次随机事件"生成。
          </div>
        ) : (
          events.map((it) => (
            <EventCard
              key={it.event.id}
              event={it.event}
              petName={petName ?? ""}
              rendered={it.rendered}
            />
          ))
        )}
      </section>

      {/* 开发工具区（仅非生产模式） */}
      <section className="mt-6 p-4 rounded-lg border border-dashed" style={{ borderColor: "var(--muted)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
          开发工具（阶段 2 演示）
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void generateEvent()}
            disabled={generating}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: "var(--pack-accent)", color: "white" }}
          >
            {generating ? "生成中…" : "随机触发一次"}
          </button>
          {FORCE_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => void generateEvent(t)}
              disabled={generating}
              className="px-2 py-1 rounded text-xs border"
              style={{ borderColor: "var(--muted)", color: "var(--pack-ink)" }}
            >
              {t}
            </button>
          ))}
        </div>
        {devTip && (
          <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
            {devTip}
          </p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          事件引擎：{petName} 的状态 {petState}；新事件会插入时间线上方。
        </p>
      </section>
    </div>
  );
}

export default function HomePage() {
  return (
    <ThemeProvider>
      <HomeInner />
    </ThemeProvider>
  );
}
