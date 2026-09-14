"use client";
import { APP_NAME_DEFAULT } from "@/config/client-brand";

/**
 * 文件名称：page.tsx
 * 功能描述：/announcements — 公告列表页（阶段 5）
 * 所属模块：app/announcements
 * 验收对齐：
 *   - docs/requirements.md §3.8 公告（倒序列表、已读/未读、静音、空态）
 *   - docs/current-stage.md 阶段 5 关键交付 3（公告 UI）
 * 交互：
 *   - 加载 GET /api/announcements → 显示倒序列表
 *   - 点击公告 → 展开详情 + POST mark_read 标记已读
 *   - 未读 ≥ 1 → 顶部按钮"静音 3 条" → POST mute(count=3)
 *   - 空态：无公告 → 显示"暂无公告"
 * 硬约束：
 *   - 文案禁"打卡/签到"（当前文件无此类字样）
 *   - 静音语义明确："静音 3 条"表示跳过最新的 3 条未读（7 天后自动恢复）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import type { Announcement, AnnouncementAggregation } from "@/domain/announce/types";
import type { AnnouncementStatus } from "@/domain/announce/hub";

interface AnnouncementItem {
  announcement: Announcement;
  status: AnnouncementStatus;
  readAt: number | null;
  mutedUntilTs: number | null;
}

interface ListResponse {
  ok: boolean;
  items: AnnouncementItem[];
  unreadCount: number;
  mutedCount: number;
  aggregation: AnnouncementAggregation | null;
  /** P2-002：被聚合隐藏的公告 id + 完整条目（次级展开用） */
  aggregatedIds?: string[];
  aggregatedItems?: AnnouncementItem[];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LEVEL_BADGE: Record<string, { label: string; color: string }> = {
  info: { label: "通知", color: "var(--muted)" },
  important: { label: "重要", color: "var(--pack-accent)" },
  critical: { label: "紧急", color: "var(--danger)" },
};

function AnnouncementsInner() {
  const router = useRouter();
  const { packDisplayName } = useTheme();

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAggregated, setShowAggregated] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/announcements", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(`请求失败 (${res.status})`);
        return;
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
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

  const handleRead = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_read", ids: [id] }),
        });
        if (res.ok) {
          void load();
        }
      } catch (e) {
        console.warn("mark_read failed:", e);
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const handleMute = useCallback(
    async (count: number) => {
      if (!data || data.unreadCount === 0) return;
      if (!window.confirm(`跳过最新的 ${Math.min(count, data.unreadCount)} 条公告（7 天后自动恢复）`)) {
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mute", count }),
        });
        if (res.ok) {
          void load();
        }
      } catch (e) {
        console.warn("mute failed:", e);
      } finally {
        setBusy(false);
      }
    },
    [data, load]
  );

  const items = useMemo(() => data?.items ?? [], [data]);

  if (!data && loading) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        正在拉取公告…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
            公告
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {packDisplayName ?? APP_NAME_DEFAULT} · 低频触达 · 倒序列表
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
          <Link href="/" style={{ color: "var(--muted)" }} className="underline">
            首页
          </Link>
          <Link href="/gifts" style={{ color: "var(--muted)" }} className="underline">
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

      {/* 顶部工具栏 */}
      {data && data.items.length > 0 && (
        <section
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: "var(--pack-paper)", border: "1px solid var(--pack-accent)" }}
        >
          <div className="text-sm" style={{ color: "var(--pack-ink)" }}>
            <span className="font-semibold">未读 {data.unreadCount}</span>
            <span className="mx-2" style={{ color: "var(--muted)" }}>·</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              静音 {data.mutedCount}
            </span>
          </div>
          <div className="flex gap-2">
            {data.unreadCount >= 3 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleMute(3)}
                className="text-xs px-3 py-1 rounded border"
                style={{
                  borderColor: "var(--pack-accent)",
                  color: "var(--pack-ink)",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                静音 3 条
              </button>
            )}
            {data.unreadCount >= 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleMute(Math.max(1, Math.min(data.unreadCount, 10)))}
                className="text-xs px-3 py-1 rounded border"
                style={{
                  borderColor: "var(--pack-accent)",
                  color: "var(--pack-ink)",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                静音全部未读
              </button>
            )}
          </div>
        </section>
      )}

      {/* 空窗聚合摘要（P2-002：主列表已隐藏聚合项，这里提供次级展开） */}
      {data?.aggregation && (
        <section
          className="rounded-lg p-4"
          style={{
            background: "var(--pack-paper)",
            border: "1px dashed var(--pack-accent)",
          }}
        >
          <div className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>
            过去 {data.aggregation.spanDays} 天有 {data.aggregation.count} 条公告（已合并）
          </div>
          <ul className="mt-2 text-xs space-y-1" style={{ color: "var(--muted)" }}>
            {data.aggregation.previewTitles.map((t, i) => (
              <li key={i}>· {t}</li>
            ))}
          </ul>
          {(data.aggregatedItems?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowAggregated((v) => !v)}
              className="mt-2 text-xs underline"
              style={{ color: "var(--pack-accent)" }}
            >
              {showAggregated ? "收起已合并公告" : `展开全部 ${data.aggregation.count} 条`}
            </button>
          )}
          {showAggregated && (
            <div className="mt-3 space-y-2">
              {(data.aggregatedItems ?? []).map((it) => (
                <AnnouncementCard
                  key={it.announcement.id}
                  item={it}
                  expanded={expandedId === it.announcement.id}
                  onToggle={() => {
                    const next = expandedId === it.announcement.id ? null : it.announcement.id;
                    setExpandedId(next);
                    if (next && it.status === "unread") {
                      void handleRead(it.announcement.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {items.length === 0 && !data?.aggregation ? (
        <div
          className="text-sm p-6 text-center rounded-lg"
          style={{ color: "var(--muted)", background: "var(--pack-paper)" }}
        >
          暂无公告
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <AnnouncementCard
              key={it.announcement.id}
              item={it}
              expanded={expandedId === it.announcement.id}
              onToggle={() => {
                const next = expandedId === it.announcement.id ? null : it.announcement.id;
                setExpandedId(next);
                if (next && it.status === "unread") {
                  void handleRead(it.announcement.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        公告由服务中心低频发布；静音后 7 天自动恢复。
      </p>
    </div>
  );
}

interface AnnouncementCardProps {
  item: AnnouncementItem;
  expanded: boolean;
  onToggle: () => void;
}

function AnnouncementCard({ item, expanded, onToggle }: AnnouncementCardProps) {
  const { announcement: a, status } = item;
  const badge = LEVEL_BADGE[a.level] ?? LEVEL_BADGE.info;

  const statusDot: { color: string; label: string } =
    status === "unread"
      ? { color: "var(--pack-accent)", label: "未读" }
      : status === "muted"
        ? { color: "var(--muted)", label: "已静音" }
        : { color: "var(--muted)", label: "已读" };

  return (
    <div
      className="rounded-lg p-3 cursor-pointer"
      style={{
        background: "var(--pack-paper)",
        border: `1px solid ${status === "muted" ? "var(--muted)" : "var(--pack-accent)"}`,
        opacity: status === "muted" ? 0.7 : 1,
      }}
      onClick={onToggle}
      role="button"
      aria-expanded={expanded}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: statusDot.color }}
            aria-label={statusDot.label}
          />
          <span
            className="inline-block text-[10px] px-1.5 py-0.5 rounded shrink-0"
            style={{ color: badge.color, background: "rgba(0,0,0,0.04)" }}
          >
            {badge.label}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: "var(--pack-ink)" }}>
            {a.title}
          </span>
        </div>
        <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>
          {formatDate(a.publishedAt)}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 text-sm whitespace-pre-wrap" style={{ color: "var(--pack-ink)" }}>
          {a.body}
        </div>
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <ThemeProvider>
      <AnnouncementsInner />
    </ThemeProvider>
  );
}
