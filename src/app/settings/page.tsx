"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * 文件名称：settings/page.tsx
 * 功能描述：/settings — 设置中枢（阶段 6）：数据主权（导出/导入/申诉）+ 开发者模式
 * 所属模块：app/settings
 * 验收对齐：
 *   - docs/requirements.md §3.9 数据导出/导入入口
 *   - docs/dev-stage-plan.md 阶段 6 前端交付（导出确认弹窗、导入 UI、申诉入口、开发者模式）
 * 说明：
 *   - 修复阶段 5 遗留：首页 header 的 /settings 链接原本 404（P2 缺口闭合）
 *   - 展示上次备份 hash（申诉自证信息），并导航到各子页
 */

export default function SettingsPage() {
  const router = useRouter();
  const [emailHash, setEmailHash] = useState<string>("");
  const [lastBackupHash, setLastBackupHash] = useState<string>("");
  const [packName, setPackName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 退出登录状态（P1-001 修复：提供 UI 入口，对齐 runbook §1 第 4 步）
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error(`请求失败 (${res.status})`);
        const data = await res.json();
        if (!alive) return;
        setEmailHash(data.emailHash ?? "");
        setLastBackupHash(data.lastBackupHash ?? "");
        setPackName(data.pet?.activePackName ?? "default");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="max-w-2xl mx-auto p-6 pb-32 space-y-4">
      <header>
        
<Link href="/" className="text-xs underline" style={{ color: "var(--muted)" }}>
          ← 回首页
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
          设置
        </h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          数据主权 · 账号安全 · 开发者工具
        </p>
      </header>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>加载中…</p>
      ) : error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
      ) : (
        <>
          <section className="rounded-2xl p-4 border" style={{ borderColor: "var(--pack-accent)", background: "var(--pack-paper)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>数据主权</h2>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              你的 pet 数据属于你——一键导出完整备份，随时可导入恢复。
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link
                href="/export"
                className="px-3 py-1.5 rounded-full text-sm"
                style={{ background: "var(--pack-accent)", color: "var(--pack-paper)" }}
              >
                导出备份
              </Link>
              <Link
                href="/import"
                className="px-3 py-1.5 rounded-full text-sm border"
                style={{ borderColor: "var(--pack-accent)", color: "var(--pack-ink)" }}
              >
                导入恢复
              </Link>
              <Link
                href="/account/help"
                className="px-3 py-1.5 rounded-full text-sm border"
                style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
              >
                账号申诉
              </Link>
            </div>
            {lastBackupHash && (
              <p className="text-[10px] mt-3 break-all" style={{ color: "var(--muted)" }}>
                最近备份校验和：<code>{lastBackupHash}</code>
              </p>
            )}
            {emailHash && (
              <p className="text-[10px] mt-1 break-all" style={{ color: "var(--muted)" }}>
                账号标识（邮箱 hash）：<code>{emailHash}</code>
              </p>
            )}
          </section>

          <section className="rounded-2xl p-4 border" style={{ borderColor: "var(--muted)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>开发者模式</h2>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              当前生效素材包：<strong>{packName}</strong>
            </p>
            <div className="mt-3">
              <Link
                href="/developer"
                className="px-3 py-1.5 rounded-full text-sm border"
                style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
              >
                打开开发者页
              </Link>
            </div>
          </section>

          <section className="rounded-2xl p-4 border" style={{ borderColor: "var(--muted)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>账号</h2>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              退出后会撤销当前会话，回到登录页。
            </p>
            <div className="mt-3">
              <button
                type="button"
                disabled={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  try {
                    await fetch("/api/auth/logout", { method: "POST" });
                  } catch {
                    // 即使 API 失败也强制清 cookie 并跳转
                    document.cookie = "aetherpet_token=; Max-Age=0; Path=/";
                  } finally {
                    router.replace("/login");
                  }
                }}
                className="px-3 py-1.5 rounded-full text-sm border"
                style={{
                  borderColor: "var(--danger, #b3261e)",
                  color: "var(--danger, #b3261e)",
                  opacity: loggingOut ? 0.6 : 1,
                }}
              >
                {loggingOut ? "退出中…" : "退出登录"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}