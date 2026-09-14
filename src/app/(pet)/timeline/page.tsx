"use client";
import { APP_NAME_DEFAULT } from "@/config/client-brand";

/**
 * 文件名称：page.tsx
 * 功能描述：时间线页（单一时间轴 + 渐进披露 + 分页）
 * 所属模块：app/(pet)/timeline
 * 验收对齐：
 *   - docs/requirements.md §3.5 事件流（单一时间轴、类型标签、记忆引用高亮、无回复按钮）
 *   - docs/dev-stage-plan.md §3 阶段 3 时间线 UI
 *   - docs/requirements.md §6 #4 补算（渐进披露入口卡片）
 *
 * 交互契约：
 *   - 首屏：若存在聚合摘要事件 → 顶部显示 TimelineEntryCard（"过去 X 天"入口卡片）
 *   - 展开：默认展示第 1 页事件（20 条/页），"查看更多"翻页
 *   - 类型筛选：点击类型标签过滤当前页事件
 *   - 状态徽章：每张卡片左上角"当时 在家/出门/旅行"
 *   - 记忆高亮：正文内的 memory_refs 用浅灰底色 + 下划线（EventCard 实现），
 *              卡片上方再列出记忆引用角标（本组件实现）
 *   - 无回复按钮：UI 层强制（requirements §3.5"宠物单向输出、无社交压力"）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import { runSyncOnce } from "@/lib/sync-client";
import { splitEventsByTs } from "@/lib/timeline-split";
import { TimelineView, type TimelineApiResponse } from "@/ui/timeline";

const DEFAULT_PAGE_SIZE = 20;

function TimelineInner() {
  const router = useRouter();
  const { packDisplayName, packName } = useTheme();

  const [data, setData] = useState<TimelineApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 首次加载前触发一次补算同步；翻页 / 筛选不重复触发（服务端幂等）
  const syncedRef = useRef(false);
  // 本次离线窗口起点（sync.catchup.offlineStartTs）：用于“你不在的时候”新旧分隔
  const [offlineStartTs, setOfflineStartTs] = useState<number | null>(null);
  // 新事件计数（离线窗口内，ts >= offlineStartTs；用于“你不在的时候”提示条）
  const freshCount = useMemo(
    () => splitEventsByTs(data?.events ?? [], offlineStartTs).fresh.length,
    [data, offlineStartTs]
  );

  const load = useCallback(
    async (p: number, size: number) => {
      if (!syncedRef.current) {
        syncedRef.current = true;
        const sync = await runSyncOnce();
        if (sync?.catchup?.offlineStartTs) {
          setOfflineStartTs(sync.catchup.offlineStartTs);
        }
      }
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          limit: String(size),
          offset: String((p - 1) * size),
          total: "1",
        });
        const res = await fetch(`/api/pet/timeline?${qs.toString()}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? `请求失败 (${res.status})`);
          return;
        }
        const json = (await res.json()) as TimelineApiResponse;
        if (!json.ok) {
          setError("接口返回异常");
          return;
        }
        setData(json);
      } catch (e) {
        setError(`网络错误：${String(e)}`);
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    // 微任务延迟：避免 effect 同步 tick 内 setState（react-hooks/set-state-in-effect）
    const t = setTimeout(() => {
      void load(page, pageSize);
    }, 0);
    return () => clearTimeout(t);
  }, [page, pageSize, load]);

  if (!data && loading) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        正在唤醒 {packDisplayName ?? packName ?? APP_NAME_DEFAULT}…
      </div>
    );
  }

  if (!data || !data.pet) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--pack-ink)" }}>
          时间线
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

  return (
    <div className="max-w-2xl mx-auto p-6 pb-32 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
            {petName} 的时间线
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {packDisplayName ?? packName ?? APP_NAME_DEFAULT} · 单一时间轴 · 无社交压力
          </p>
        </div>
        <Link href="/" className="text-xs underline" style={{ color: "var(--muted)" }}>
          首页
        </Link>
      </header>

      {/* 若本次有补算/新事件，在列表上方给出低打扰的“新旧”提示条（无社交压力，不用“未读”词） */}
      <section id="timeline-list" className="space-y-2">
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          事件流（第 {page} 页 · {pageSize} 条/页）
        </h2>
        {freshCount > 0 && (
          <div className="flex items-center gap-3 py-0.5" style={{ color: "var(--muted)" }}>
            <span className="text-xs shrink-0">你不在的时候，ta 悄悄发生了 {freshCount} 件事</span>
            <span className="flex-1 h-px" style={{ background: "currentColor", opacity: 0.35 }} />
          </div>
        )}
        <TimelineView
          petName={petName}
          items={data.events}
          loading={loading}
          error={error}
          total={data.total}
          hasMore={data.hasMore ?? false}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </section>

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {petName} 单向输出，没有回复按钮——这是刻意设计（无社交压力）。
      </p>
    </div>
  );
}

export default function TimelinePage() {
  return (
    <ThemeProvider>
      <TimelineInner />
    </ThemeProvider>
  );
}
