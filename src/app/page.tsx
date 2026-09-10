"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/ui/theme-provider";

/**
 * 文件名称：page.tsx
 * 功能描述：首页（登录后跳转）
 * 所属模块：app/
 * 验收对齐：docs/requirements.md §6 #1 注册登录 + #8 素材包
 */

interface Pet {
  id: string;
  name: string;
  state: "at_home" | "out_walking" | "on_trip";
  stateSince: number;
  createdAt: number;
  activePackName: string;
  hubId: string;
}

const STATE_LABELS: Record<Pet["state"], string> = {
  at_home: "在家",
  out_walking: "出门散步",
  on_trip: "旅行中",
};

export default function HomePage() {
  const router = useRouter();
  const theme = useTheme();
  const [pet, setPet] = useState<Pet | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hubId, setHubId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        router.replace("/login");
        return;
      }
      const me = await meRes.json();
      setUserId(me.userId);
      setHubId(me.hubId);

      const petRes = await fetch("/api/pet");
      const petData = await petRes.json();
      if (petData.pet) {
        setPet(petData.pet);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <main className="flex-1 flex flex-col">
      {/* 顶栏 */}
      <header
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: "var(--border)", background: "var(--paper)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold" style={{ fontFamily: "KaiTi, serif" }}>
            aetherPet
          </span>
          {hubId && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--accent)", color: "white" }}>
              中心：{hubId}
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="text-sm px-3 py-1 rounded border"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          退出登录
        </button>
      </header>

      {/* 主区 */}
      <section className="flex-1 flex items-center justify-center p-6">
        {loading ? (
          <p style={{ color: "var(--muted)" }}>加载中...</p>
        ) : error ? (
          <p style={{ color: "#991b1b" }}>{error}</p>
        ) : !pet ? (
          <div className="paper p-8 text-center space-y-4 max-w-md">
            <p>你还没有 pet。</p>
            <button
              onClick={() => router.replace("/create-pet")}
              className="px-6 py-2 rounded font-medium"
              style={{ background: "var(--primary)", color: "white" }}
            >
              创建第一只 pet
            </button>
          </div>
        ) : (
          <div className="paper p-8 w-full max-w-2md space-y-6 text-center">
            <div>
              <h1
                className="text-4xl font-semibold"
                style={{ fontFamily: "KaiTi, serif", color: "var(--ink)" }}
              >
                {pet.name}
              </h1>
              <p className="mt-2 text-lg" style={{ color: "var(--muted)" }}>
                · {STATE_LABELS[pet.state] ?? pet.state} ·
              </p>
            </div>

            <div
              className="rounded-lg p-6 space-y-2"
              style={{ background: "var(--primary)", color: "white" }}
            >
              <p className="text-sm opacity-80">当前素材包</p>
              <p className="text-lg font-medium">
                {theme.packDisplayName ?? "官方默认（手绘暖调）"}
              </p>
              {theme.loading && <p className="text-xs opacity-70">素材加载中...</p>}
              {!theme.loading && !theme.packName && (
                <p className="text-xs opacity-70">素材加载失败，使用降级模式</p>
              )}
            </div>

            {theme.availablePacks.length > 0 && (
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                可用素材包：{theme.availablePacks.map((p) => p.displayName).join(" · ")}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
