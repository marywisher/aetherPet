"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * 文件名称：developer/page.tsx
 * 功能描述：/developer — 开发者模式（阶段 6）：素材包切换验证 + 当前配置 + 测试事件
 * 所属模块：app/developer
 * 验收对齐：
 *   - docs/requirements.md §3.10 素材包可配置性（开发者模式加载另一套包，视觉/文案变化可见）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 5
 * 交互：
 *   - 列出可用素材包 + 当前生效包（GET /api/packs）
 *   - 一键切换（POST /api/packs/activate）→ 切换后前端刷新样式（ThemeProvider 重新注入）
 *   - 损坏包回退演示：操作说明引导手动破坏后验证
 */

interface PackInfo {
  name: string;
  displayName: string;
  schemaVersion: string;
  theme: { palette: { primary: string; accent: string; memory_ref: string; paper: string; ink: string } };
  webPath: string;
}

interface PacksResponse {
  ok: boolean;
  current: PackInfo | null;
  fallbackReason: string | null;
  available: Array<{ name: string; displayName: string }>;
}

export default function DeveloperPage() {
  const router = useRouter();
  const [packs, setPacks] = useState<PacksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/packs", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(`请求失败 (${res.status})`);
      setPacks(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [router]);

  useEffect(() => {
    // 微任务延迟：避免在 effect 同步 tick 内 setState（react-hooks/set-state-in-effect）
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function activate(name: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/packs/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packName: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `切换失败 (${res.status})`);
        return;
      }
      setMessage(`已切换到「${data.current?.displayName ?? name}」`);
      void load();
      // 提示：主题变量由 ThemeProvider 按生效包注入；刷新页面可看到完整视觉变化
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 pb-32 space-y-4">
      <header>
        
<Link href="/settings" className="text-xs underline" style={{ color: "var(--muted)" }}>
          ← 回设置
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
          开发者模式
        </h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          素材包切换验证 · 配置查看（验收 #8）
        </p>
      </header>

      <section className="rounded-2xl p-4 border" style={{ borderColor: "var(--pack-accent)", background: "var(--pack-paper)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>当前生效素材包</h2>
        {packs?.current ? (
          <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            <p>
              <strong>{packs.current.displayName}</strong>（{packs.current.name} · schema {packs.current.schemaVersion}）
            </p>
            <div className="flex gap-2 mt-2">
              {Object.entries(packs.current.theme.palette).map(([k, v]) => (
                <span key={k} title={k} className="inline-block w-5 h-5 rounded-full border" style={{ background: v, borderColor: "#999" }} />
              ))}
            </div>
          </div>
        ) : packs?.fallbackReason ? (
          <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>
            默认包加载失败，已回退到空包（fallbackReason: {packs.fallbackReason}）
          </p>
        ) : null}

        <h2 className="text-sm font-semibold mt-4" style={{ color: "var(--pack-ink)" }}>切换素材包</h2>
        <ul className="mt-2 space-y-2">
          {(packs?.available ?? []).map((p) => {
            const isCurrent = packs?.current?.name === p.name;
            return (
              <li key={p.name} className="flex items-center justify-between rounded-xl p-3 border" style={{ borderColor: isCurrent ? "var(--pack-accent)" : "var(--muted)" }}>
                <span className="text-sm" style={{ color: "var(--pack-ink)" }}>
                  {p.displayName}
                  {isCurrent && <span className="ml-1 text-xs" style={{ color: "var(--pack-accent)" }}>（当前）</span>}
                </span>
                <button
                  onClick={() => activate(p.name)}
                  disabled={busy || isCurrent}
                  className="px-3 py-1 rounded-full text-xs disabled:opacity-40"
                  style={{ background: isCurrent ? "transparent" : "var(--pack-accent)", color: isCurrent ? "var(--muted)" : "var(--pack-paper)" }}
                >
                  {busy ? "切换中…" : isCurrent ? "使用中" : "切换"}
                </button>
              </li>
            );
          })}
        </ul>

        <h2 className="text-sm font-semibold mt-4" style={{ color: "var(--pack-ink)" }}>损坏回退演示</h2>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          手动验证：把 <code>src/assets/packs/morning/theme.css</code> 改名或删掉 manifest 的 theme 字段 → 刷新
          <code>/api/packs</code> 会返回 fallbackReason，视为加载失败但不影响应用（回退默认包）。改回来后在
          <code>/api/packs/refresh</code>（或重启）恢复。注意：不要在生产环境操作。
        </p>

        {message && <p className="text-xs mt-3" style={{ color: "var(--pack-accent)" }}>✅ {message}</p>}
        {error && <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>{error}</p>}
      </section>
    </div>
  );
}