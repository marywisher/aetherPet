"use client";
import { APP_NAME_DEFAULT } from "@/config/client-brand";

/**
 * 文件名称：page.tsx
 * 功能描述：首页（无 pet → 跳创建；有 pet → 显示时间线 + 开发工具按钮）
 * 所属模块：app
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 2 演示步骤 1/2/3
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import { EventCard } from "@/ui/event-card";
import { TimelineEntryCard } from "@/ui/timeline";
import { runSyncOnce } from "@/lib/sync-client";
import { splitEventsByTs } from "@/lib/timeline-split";
import {
  fillFarewell,
  hasShownFarewell,
  markFarewellShown,
} from "@/lib/farewell";
import type { EventTypeValue, PetState } from "@/domain/types";
import type { RenderedText } from "@/domain/events/render";

interface TimelineItem {
  event: {
    id: string;
    type: EventTypeValue;
    ts: number;
    fsmState: PetState;
    isAggregate?: boolean;
    aggregateSpanDays?: number | null;
    memoryRefs?: Array<{ kind: string; value: string }>;
  };
  rendered: RenderedText;
}

interface TimelineResponse {
  ok: boolean;
  pet: { id: string; name: string; state: PetState } | null;
  events: TimelineItem[];
  total?: number;
  latestAggregate?: {
    event: { ts: number; type: EventTypeValue; aggregateSpanDays?: number | null };
    rendered: RenderedText;
  } | null;
}

const FORCE_TYPES: EventTypeValue[] = [
  "outing",
  "watching_water",
  "counting_leaves",
  "self_talk",
  "brought_item",
  "spontaneous_letter",
];

/** 开发工具区是否可见：仅非生产构建（Next.js 客户端构建期静态替换 NODE_ENV） */
const IS_DEV = process.env.NODE_ENV !== "production";

function HomeInner() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [petName, setPetName] = useState<string | null>(null);
  const [petId, setPetId] = useState<string | null>(null);
  const [petState, setPetState] = useState<PetState>("at_home");
  const [events, setEvents] = useState<TimelineItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [devTip, setDevTip] = useState<string | null>(null);
  // 渐进披露入口卡片数据（阶段 3 新增；来自 /api/pet/timeline 的 latestAggregate）
  const [aggregateEntry, setAggregateEntry] = useState<{
    spanDays: number;
    eventCount: number;
    summary: RenderedText | null;
  } | null>(null);
  // 今日馈赠欢迎卡片（阶段 6 收官：馈赠仪式感；来自 /api/sync 的 dailyGrant）
  const [dailyWelcome, setDailyWelcome] = useState<
    | { kind: "granted"; itemName: string }
    | { kind: "pool_empty"; fallback: string }
    | null
  >(null);
  // 本次离线窗口起点（sync.catchup.offlineStartTs）：用于“你不在的时候”新旧分隔
  const [offlineStartTs, setOfflineStartTs] = useState<number | null>(null);
  const { packDisplayName, packName, assets, webPath, guidance } = useTheme();

  // 初见前的初次展示：收尾句仅本会话展示一次（localStorage 按 petId 标记）
  const [showFarewell, setShowFarewell] = useState(false);
  useEffect(() => {
    if (petId && guidance?.first_session_farewell) {
      setShowFarewell(!hasShownFarewell(petId));
    }
  }, [petId, guidance]);

  // 页面卸载（直接关标签/跳外部）→ 标记收尾句已展示（避免下次重复）；
  // 客户端路由跳转不触发 pagehide，logout 路径保持未标记，由 /login 落点消费。
  useEffect(() => {
    if (!petId) return;
    const onHide = () => {
      if (!hasShownFarewell(petId)) markFarewellShown(petId);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [petId]);

  // 按 pet 状态选状态图（asset key → 相对路径）
  const petImageKey =
    petState === "at_home"
      ? "pet_at_home"
      : petState === "out_walking"
        ? "pet_out_walking"
        : "pet_on_trip";
  const petImageUrl =
    webPath && assets[petImageKey] ? `${webPath}/${assets[petImageKey]}` : null;
  const homeBgUrl =
    webPath && assets["home_bg"] ? `${webPath}/${assets["home_bg"]}` : null;
  const firstMeetingNoteUrl =
    webPath && assets["first_meeting_note"]
      ? `${webPath}/${assets["first_meeting_note"]}`
      : null;

  // 新旧分组：ts >= 离线起点 = “你不在的时候发生的”，其余为更早的老事件
  const { fresh, past } = useMemo(
    () => splitEventsByTs(events, offlineStartTs),
    [events, offlineStartTs]
  );

  const load = useCallback(async () => {
    try {
      // 补算同步先行：确保时间线拉到补算后的最新事件（幂等，见 runSyncOnce 注释）
      const sync = await runSyncOnce();
      if (sync?.catchup?.offlineStartTs) {
        setOfflineStartTs(sync.catchup.offlineStartTs);
      }
      if (sync?.dailyGrant) {
        const g = sync.dailyGrant;
        if (g.granted && g.itemDisplayName) {
          setDailyWelcome({ kind: "granted", itemName: g.itemDisplayName });
        } else if (g.skipped === "empty_pool" && g.fallbackMessage) {
          setDailyWelcome({ kind: "pool_empty", fallback: g.fallbackMessage });
        } else {
          setDailyWelcome(null);
        }
      }
      const res = await fetch("/api/pet/timeline?total=1", { cache: "no-store" });
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
      setPetId(data.pet.id);
      setPetState(data.pet.state);
      setEvents(data.events);
      // 渐进披露入口卡片：若存在聚合摘要事件，展示"过去 X 天"入口
      if (data.latestAggregate && data.latestAggregate.event.aggregateSpanDays) {
        setAggregateEntry({
          spanDays: data.latestAggregate.event.aggregateSpanDays,
          eventCount: data.total ?? Math.max(data.events.length, 1),
          summary: data.latestAggregate.rendered,
        });
      } else {
        setAggregateEntry(null);
      }
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [router]);

  useEffect(() => {
    // 微任务延迟：避免 effect 同步 tick 内 setState（react-hooks/set-state-in-effect）
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
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
        正在唤醒 {packDisplayName ?? packName ?? APP_NAME_DEFAULT}…
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
            {packDisplayName ?? packName ?? APP_NAME_DEFAULT} ·{" "}
            {petState === "at_home"
              ? "在家"
              : petState === "out_walking"
                ? "出门中"
                : "旅行中"}
          </p>
        </div>
        <nav className="flex items-center gap-3">
          <a href="/profile" className="text-xs underline" style={{ color: "var(--muted)" }}>
            档案
          </a>
          <a href="/announcements" className="text-xs underline" style={{ color: "var(--muted)" }}>
            公告
          </a>
          <a href="/gifts" className="text-xs underline" style={{ color: "var(--muted)" }}>
            送礼物
          </a>
          <a href="/settings" className="text-xs underline" style={{ color: "var(--muted)" }}>
            设置
          </a>
        </nav>
      </header>

      {/* 主场景区（pre-launch：首页背景 + 按状态切换的小刺猬） */}
      <section
        className="relative rounded-2xl overflow-hidden"
        style={{
          border: "1px solid var(--pack-border)",
          background: "var(--pack-paper)",
        }}
      >
        {homeBgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={homeBgUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: 0.55 }}
          />
        )}
        <div className="relative flex flex-col items-center py-6">
          {petImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={petImageUrl}
              alt={petName ?? ""}
              className="w-40 h-40 object-contain drop-shadow"
            />
          ) : (
            <div
              className="w-32 h-32 rounded-full"
              style={{ background: "var(--pack-primary)", opacity: 0.3 }}
            />
          )}
          <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
            {petState === "at_home"
              ? "在家"
              : petState === "out_walking"
                ? "出门中"
                : "旅行中"}
          </p>
        </div>
      </section>

      {/* 今日馈赠欢迎卡片（阶段 6 收官：馈赠仪式感；sync 自动发放，仅当日首次显示） */}
      {dailyWelcome && (
        <section
          className="rounded-2xl p-4 border"
          style={{ borderColor: "var(--pack-accent)", background: "var(--pack-paper)" }}
        >
          {dailyWelcome.kind === "granted" ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm" style={{ color: "var(--pack-ink)" }}>
                信箱里多了一个小礼物：「{dailyWelcome.itemName}」。放桌上，看看它会怎么回应吧。
              </p>
              <a
                href="/gifts"
                className="shrink-0 text-xs rounded-full px-3 py-1"
                style={{ background: "var(--pack-accent)", color: "#fff" }}
              >
                去送礼
              </a>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {dailyWelcome.fallback}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          最近发生的事
        </h2>
        {/* 渐进披露入口卡片（阶段 3 验收 #4：30 天场景首屏出现聚合摘要 + 入口卡片） */}
        {aggregateEntry && (
          <TimelineEntryCard
            petName={petName ?? ""}
            spanDays={aggregateEntry.spanDays}
            eventCount={aggregateEntry.eventCount}
            summary={aggregateEntry.summary}
            onExpand={() => router.push("/timeline")}
          />
        )}
        {events.length === 0 ? (
          <div className="text-sm p-6 text-center rounded-lg" style={{ color: "var(--muted)", background: "var(--pack-paper)" }}>
            还没有事件。点击「触发一次随机事件」生成。
          </div>
        ) : (
          <>
            {fresh.length > 0 && (
              <p className="text-xs py-0.5" style={{ color: "var(--muted)" }}>
                你不在的时候，ta 悄悄发生了 {fresh.length} 件事
              </p>
            )}
            {fresh.map((it) => (
              <EventCard
                key={it.event.id}
                event={it.event}
                petName={petName ?? ""}
                rendered={it.rendered}
                imageUrl={it.event.type === "first_meeting" ? firstMeetingNoteUrl : null}
              />
            ))}
            {fresh.length > 0 && past.length > 0 && (
              <div className="flex items-center gap-3 py-0.5" style={{ color: "var(--muted)" }}>
                <span className="text-xs shrink-0">更早之前</span>
                <span className="flex-1 h-px" style={{ background: "currentColor", opacity: 0.35 }} />
              </div>
            )}
            {past.map((it) => (
              <EventCard
                key={it.event.id}
                event={it.event}
                petName={petName ?? ""}
                rendered={it.rendered}
                imageUrl={it.event.type === "first_meeting" ? firstMeetingNoteUrl : null}
              />
            ))}
          </>
        )}
        <a
          href="/timeline"
          className="block text-center text-xs underline py-2 rounded"
          style={{ color: "var(--pack-primary)", background: "var(--pack-paper)" }}
        >
          查看全部时间线 →
        </a>
      </section>

      {/* 桌面小字（pre-launch：placeholder 语义——无馈赠卡/无内容时显示，引导送礼） */}
      {!dailyWelcome && guidance?.desk_hint && (
        <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
          {guidance.desk_hint}
        </p>
      )}

      {/* 首会话收尾句（pre-launch：双落点之一，仅首次会话展示） */}
      {showFarewell && guidance?.first_session_farewell && (
        <footer className="text-center pt-4">
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {fillFarewell(guidance.first_session_farewell, petName ?? "")}
          </p>
        </footer>
      )}

      {/* 开发工具区（仅非生产构建可见：本地 dev / 测试；生产隐藏，避免 403 死按钮） */}
      {IS_DEV && (
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
      )}
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
