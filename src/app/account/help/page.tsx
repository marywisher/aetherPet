"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * 文件名称：help/page.tsx
 * 功能描述：/account/help — 账号申诉入口（MVP 人工兜底通道）
 * 所属模块：app/account/help
 * 验收对齐：
 *   - docs/requirements.md §3.1 账号申诉机制（MVP 人工兜底：备份 hash 比对作身份证明）
 *   - docs/requirements.md §6 验收 #11 账号安全与恢复（申诉入口存在、备份可作身份证明）
 * 说明：
 *   - 页面说明申诉流程：提交备份 hash + 邮箱证明，中心管理员人工比对
 *   - 展示用户最近备份 hash（证明持有数据）
 */

export default function AccountHelpPage() {
  const router = useRouter();
  const [emailHash, setEmailHash] = useState("");
  const [lastBackupHash, setLastBackupHash] = useState("");
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setEmailHash(data.emailHash ?? "");
        setLastBackupHash(data.lastBackupHash ?? "");
        setCreatedAt(data.createdAt ?? null);
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
        
<Link href="/settings" className="text-xs underline" style={{ color: "var(--muted)" }}>
          ← 回设置
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
          账号申诉
        </h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          忘记邮箱？验证码收不到？通过数据备份证明身份。
        </p>
      </header>

      <section className="rounded-2xl p-4 border space-y-3" style={{ borderColor: "var(--pack-accent)", background: "var(--pack-paper)" }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>我的身份凭证</h2>
          <p className="text-[10px] mt-1 break-all" style={{ color: "var(--muted)" }}>
            账号标识（邮箱 hash）：<code>{loading ? "…" : emailHash || "（未获取）"}</code>
          </p>
          <p className="text-[10px] mt-1 break-all" style={{ color: "var(--muted)" }}>
            最近备份校验和：<code>{loading ? "…" : lastBackupHash || "（尚未导出过备份）"}</code>
          </p>
          {createdAt && (
            <p className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
              账号创建于：{new Date(createdAt).toLocaleString("zh-CN")}
            </p>
          )}
        </div>

        <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--pack-ink)" }}>申诉流程（人工兜底）</h2>
          <ol className="text-xs mt-2 space-y-1.5 list-decimal ml-4" style={{ color: "var(--muted)" }}>
            <li>
              在 
<Link href="/export" className="underline">导出备份</Link> 中导出一份完整 JSON，
              记录其中的 SHA256 校验和（就是你上面的「最近备份校验和」）。
            </li>
            <li>通过邮件联系服务中心管理员（见首页底部邮箱），提交：账号标识 hash + 备份校验和 + 你的邮箱地址。</li>
            <li>
              管理员会比对备份哈希：能提供「与你账号最近备份记录一致的校验和」即视为持有数据凭证，配合邮箱证明后恢复访问。
            </li>
            <li>申诉处理时限由各中心公布，通常 1–3 个工作日。</li>
          </ol>
          <p className="text-[10px] mt-3" style={{ color: "var(--muted)" }}>
            提示：备份校验和是「数据在手」的证明——只有持有完整备份的人才能提供它。请务必妥善保管导出文件。
          </p>
        </div>
      </section>
    </div>
  );
}