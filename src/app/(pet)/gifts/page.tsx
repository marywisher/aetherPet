"use client";
import { APP_NAME_DEFAULT } from "@/config/client-brand";

/**
 * 文件名称：page.tsx
 * 功能描述：/(pet)/gifts — 物品栏 + 送赠交互（阶段 4 UI）
 * 所属模块：app/(pet)/gifts
 * 验收对齐：
 *   - docs/dev-stage-plan.md §3 阶段 4 UI（桌上物品展示、物品栏、赠送交互）
 *   - docs/requirements.md §3.7（用户主动摆放；每日限一次；文案禁「打卡/签到」）
 *
 * 交互：
 *   - 加载 GET /api/inventory（未送出 + 储物罐）
 *   - 点击物品卡片 → POST /api/gift/offer
 *   - 日限一次后按钮禁用（服务端 also 校验）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeProvider, useTheme } from "@/ui/theme-provider";
import { GiftTray } from "@/ui/gift-tray";
import type { Inventory, Item } from "@/domain/types";

interface InventoryResponse {
  ok: boolean;
  pet: { id: string; name: string } | null;
  /** P3-003：服务端回传的 pet.offer_last_date（YYYY-MM-DD） */
  offerLastDate?: string | null;
  /** P3-003：服务端回传的今日是否已送，前端 load 时预置禁用状态 */
  offeredToday?: boolean;
  unoffered: Inventory[];
  storage: Inventory[];
  itemsCatalog: Item[];
}

interface OfferResponse {
  ok: boolean;
  event?: unknown;
  replyDueAt?: number;
  inventory?: Inventory;
  skipReason?: string;
  message?: string;
}

function GiftsInner() {
  const router = useRouter();
  const { packDisplayName, packName } = useTheme();

  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerMessage, setOfferMessage] = useState<string | null>(null);
  const [offeredToday, setOfferedToday] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(`请求失败 (${res.status})`);
        return;
      }
      const json = (await res.json()) as InventoryResponse;
      setData(json);
      // P3-003：首次加载时从服务端同步 offeredToday 状态
      if (json.offeredToday) {
        setOfferedToday(true);
      }
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

  const itemsCatalog = useMemo(() => {
    const map = new Map<string, Item>();
    (data?.itemsCatalog ?? []).forEach((it) => map.set(it.id, it));
    return map;
  }, [data]);

  const handleOffer = useCallback(
    async (inventoryId: string) => {
      setOfferLoading(true);
      setOfferMessage(null);
      try {
        const res = await fetch("/api/gift/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inventoryId }),
        });
        const json = (await res.json()) as OfferResponse;
        if (json.ok) {
          setOfferMessage("已经放在桌上了。");
          setOfferedToday(true);
          // 刷新物品栏
          void load();
        } else {
          setOfferMessage(json.message ?? "操作失败");
          if (json.skipReason === "already_offered_today") {
            setOfferedToday(true);
          }
        }
      } catch (e) {
        setOfferMessage(`网络错误：${String(e)}`);
      } finally {
        setOfferLoading(false);
      }
    },
    [load]
  );

  if (!data && loading) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        正在整理桌面…
      </div>
    );
  }

  if (!data || !data.pet) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--pack-ink)" }}>
          物品栏
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
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
            物品栏 · 送给 {petName}
          </h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {packDisplayName ?? packName ?? APP_NAME_DEFAULT} · 每日馈赠 · 用户主动摆放
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
            href="/letter"
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            回信
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

      <GiftTray
        petName={petName}
        unoffered={data.unoffered}
        itemsCatalog={itemsCatalog}
        storageCount={data.storage.length}
        offeredToday={offeredToday}
        onOffer={handleOffer}
        offerLoading={offerLoading}
        offerMessage={offerMessage}
      />

      {/* 储物罐（已送出） */}
      {data.storage.length > 0 && (
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
              储物罐（{data.storage.length} 件）
            </h2>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {petName} 收下的东西
            </span>
          </header>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {data.storage.slice(0, 12).map((inv) => {
              const item = itemsCatalog.get(inv.itemId);
              const d = inv.offeredAt
                ? new Date(inv.offeredAt).toLocaleDateString("zh-CN", {
                    month: "short",
                    day: "numeric",
                  })
                : "";
              return (
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
                    {item?.displayName ?? inv.itemId}
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {d}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        每天限送一次，错过不惩罚。送给 {petName} 的东西，明天会在回信里被提到。
      </p>
    </div>
  );
}

export default function GiftsPage() {
  return (
    <ThemeProvider>
      <GiftsInner />
    </ThemeProvider>
  );
}
