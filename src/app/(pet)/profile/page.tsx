"use client";

/**
 * 文件名称：page.tsx
 * 功能描述：/(pet)/profile — 档案页（阶段 5）
 * 所属模块：app/(pet)/profile
 * 验收对齐：
 *   - docs/requirements.md §3.6 档案页（状态、记忆片段、事件历史、储物罐）
 *   - docs/current-stage.md 阶段 5 关键交付 4
 * 交互：
 *   - 加载 GET /api/profile → 显示 pet 状态卡片
 *   - 记忆片段（前 12 条）
 *   - 储物罐（已送出物品）
 *   - 事件历史入口（跳转 /timeline）
 *   - 事件计数摘要
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import type { Inventory, Memory, PetState } from "@/domain/types";

interface ProfileResponse {
  ok: boolean;
  pet: {
    id: string;
    name: string;
    state: PetState;
    stateSince: number;
    createdAt: number;
    activePackName: string;
    userLastActiveTs: number;
    lastActivityTs: number;
  } | null;
  memories: Memory[];
  memoriesTotal: number;
  storage: Inventory[];
  eventStats: {
    total: number;
    countsByType: Record<string, number>;
  };
}

const STATE_LABEL: Record<string, string> = {
  at_home: "在家",
  out_walking: "出门散步",
  on_trip: "旅行中",
};

const MEMORY_KIND_LABEL: Record<string, string> = {
  naming: "命名",
  preference: "偏好",
  item_received: "收到过",
  place_visited: "去过",
  sentiment: "情绪",
  custom: "其他",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / (60 * 1000));
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  if (day < 30) return `${Math.floor(day / 7)} 周前`;
  return `${Math.floor(day / 30)} 个月前`;
}

function ProfileInner() {
  const router = useRouter();
  const { packDisplayName, packName } = useTheme();

  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(`请求失败 (${res.status})`);
        return;
      }
      setData((await res.json()) as ProfileResponse);
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
        正在整理档案…
      </div>
    );
  }

  if (!data || !data.pet) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--pack-ink)" }}>
          档案
        </h1>
        <div
          className="text-sm p-6 text-center rounded-lg"
          style={{ color: "var(--muted)", background: "var(--pack-paper)" }}
        >
          {error ?? "还没有 pet，先创建一只吧。"}
        </div>
      </div>
    );
  }

  const { pet, memories, memoriesTotal, storage, eventStats } = data;
  const stateLabel = STATE_LABEL[pet.state] ?? pet.state;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
            {pet.name} · 档案
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {packDisplayName ?? packName ?? "AetherPet"} · 创建于 {formatDate(pet.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/" className="text-xs underline" style={{ color: "var(--muted)" }}>
            首页
          </Link>
          <Link href="/gifts" className="text-xs underline" style={{ color: "var(--muted)" }}>
            物品栏
          </Link>
          <Link href="/announcements" className="text-xs underline" style={{ color: "var(--muted)" }}>
            公告
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

      {/* 状态卡片 */}
      <section
        className="rounded-lg p-4"
        style={{
          background: "var(--pack-paper)",
          border: "1px solid var(--pack-accent)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-lg font-semibold"
              style={{ color: "var(--pack-ink)" }}
            >
              {pet.name} · {stateLabel}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              状态于 {formatDate(pet.stateSince)} 起 · 最近活跃 {timeAgo(pet.userLastActiveTs)}
            </div>
          </div>
          <div
            className="text-xs px-3 py-1 rounded-full"
            style={{ background: "rgba(0,0,0,0.05)", color: "var(--pack-ink)" }}
          >
            {eventStats.total} 条事件
          </div>
        </div>
      </section>

      {/* 事件历史入口 */}
      <section
        className="rounded-lg p-4 flex items-center justify-between"
        style={{
          background: "var(--pack-paper)",
          border: "1px dashed var(--pack-accent)",
        }}
      >
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>
            事件历史
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            时间线 · 散步 / 自言自语 / 回信 / 聚合摘要 全部在此
          </div>
        </div>
        <Link
          href="/timeline"
          className="text-xs px-3 py-1.5 rounded"
          style={{
            background: "var(--pack-accent)",
            color: "var(--pack-paper)",
          }}
        >
          查看时间线 →
        </Link>
      </section>

      {/* 记忆片段 */}
      <section
        className="rounded-lg p-4 space-y-2"
        style={{
          background: "var(--pack-paper)",
          border: "1px solid var(--pack-accent)",
        }}
      >
        <header className="flex items-center justify-between">
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--muted)" }}
          >
            记忆片段（{memoriesTotal}）
          </h2>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            前 {memories.length} 条
          </span>
        </header>
        {memories.length === 0 ? (
          <div className="text-xs p-2" style={{ color: "var(--muted)" }}>
            {pet.name} 还没有留下记忆。送过一次礼物后就会有。
          </div>
        ) : (
          <div className="space-y-1.5">
            {memories.map((m) => (
              <div
                key={m.id}
                className="text-sm flex items-baseline gap-2"
                style={{ color: "var(--pack-ink)" }}
              >
                <span
                  className="inline-block text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: "rgba(0,0,0,0.05)",
                    color: "var(--muted)",
                  }}
                >
                  {MEMORY_KIND_LABEL[m.kind] ?? m.kind}
                </span>
                <span className="flex-1 truncate">{m.value}</span>
                <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>
                  {timeAgo(m.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 储物罐 */}
      <section
        className="rounded-lg p-4 space-y-2"
        style={{
          background: "var(--pack-paper)",
          border: "1px solid var(--pack-accent)",
        }}
      >
        <header className="flex items-center justify-between">
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--muted)" }}
          >
            储物罐（{storage.length} 件）
          </h2>
          <Link
            href="/gifts"
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            去物品栏
          </Link>
        </header>
        {storage.length === 0 ? (
          <div className="text-xs p-2" style={{ color: "var(--muted)" }}>
            储物罐还是空的。桌上送出物品后会收进来。
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {storage.slice(0, 12).map((inv) => (
              <div
                key={inv.id}
                className="rounded p-2 text-center"
                style={{
                  background: "var(--pack-paper)",
                  border: "1px dashed var(--pack-accent)",
                  opacity: 0.85,
                }}
              >
                <div
                  className="text-sm font-semibold"
                  style={{ color: "var(--pack-ink)" }}
                >
                  {inv.itemId}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {inv.offeredAt ? formatDate(inv.offeredAt) : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 事件类型分布 */}
      <section
        className="rounded-lg p-4 space-y-2"
        style={{
          background: "var(--pack-paper)",
          border: "1px solid var(--pack-accent)",
        }}
      >
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          事件类型
        </h2>
        {Object.keys(eventStats.countsByType).length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            还没有事件。
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(eventStats.countsByType).map(([type, count]) => (
              <span
                key={type}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: "rgba(0,0,0,0.05)",
                  color: "var(--pack-ink)",
                }}
              >
                {type} · {count}
              </span>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        档案页展示 {pet.name} 的全貌：状态、记忆、事件、收下的物品。
      </p>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ThemeProvider>
      <ProfileInner />
    </ThemeProvider>
  );
}
