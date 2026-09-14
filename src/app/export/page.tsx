"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { APP_BRAND_KEY_CLIENT } from "@/config/client-brand";

/**
 * 文件名称：export/page.tsx
 * 功能描述：/export — 导出确认页（数据主权）
 * 所属模块：app/export
 * 验收对齐：
 *   - docs/requirements.md §3.9（导出前确认弹窗：明确包含/不包含的数据）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 1（导出 JSON 含 schema/checksum/exported_from）
 * 交互：
 *   - 展示「包含 / 不包含」清单 → 用户确认 → GET /api/export → 浏览器下载 JSON
 */

export default function ExportPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; size: string } | null>(null);

  async function doExport() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/export", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `导出失败 (${res.status})`);
        return;
      }
      const payload = data.payload;
      const fileName = `${APP_BRAND_KEY_CLIENT}-backup-${payload.pet.base.name}-${new Date(payload.meta.exported_at).toISOString().slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone({
        name: fileName,
        size: blob.size > 1024 ? `${(blob.size / 1024).toFixed(1)} KB` : `${blob.size} B`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 pb-32 space-y-4">
      <header>
        
<Link href="/" className="text-xs underline" style={{ color: "var(--muted)" }}>
          首页
        </Link>
        <Link href="/settings" className="text-xs underline" style={{ color: "var(--muted)" }}>
          ← 回设置
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
          导出备份
        </h1>
      </header>

      {/* 确认弹窗（包含/不包含清单） */}
      <section className="rounded-2xl p-4 border" style={{ borderColor: "var(--pack-accent)", background: "var(--pack-paper)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>
          导出将包含
        </h2>
        <ul className="text-xs mt-2 space-y-1" style={{ color: "var(--muted)" }}>
          <li>· pet 基本信息（名字、状态、创建时间、退避/馈赠进度）</li>
          <li>· 记忆片段（它记得你的一切）</li>
          <li>· 完整事件时间线（结构 + 记忆引用）</li>
          <li>· 物品栏与物品目录快照</li>
          <li>· 未读公告快照、主题偏好</li>
          <li>· 账号元数据（邮箱 hash、最近备份校验和）</li>
        </ul>
        <h2 className="text-sm font-semibold mt-4" style={{ color: "var(--pack-ink)" }}>
          不会包含
        </h2>
        <ul className="text-xs mt-2 space-y-1" style={{ color: "var(--muted)" }}>
          <li>· 登录 token / 会话 / 验证码记录（无法通过备份窃取登录态）</li>
          <li>· 服务中心审计日志（那是中心侧的运营数据）</li>
          <li>· 邮箱明文（仅导出单向哈希）</li>
        </ul>
        <p className="text-[10px] mt-3" style={{ color: "var(--muted)" }}>
          文件内含 schema 版本、导出时间、来源中心标识与 SHA256 校验和；导入时逐项核验，防止损坏与篡改。
        </p>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={doExport}
            disabled={busy}
            className="px-4 py-2 rounded-full text-sm disabled:opacity-50"
            style={{ background: "var(--pack-accent)", color: "var(--pack-paper)" }}
          >
            {busy ? "导出中…" : "确认导出"}
          </button>
          {done && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              已下载：{done.name}（{done.size}）
            </span>
          )}
        </div>
        {error && <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>{error}</p>}
      </section>
    </div>
  );
}