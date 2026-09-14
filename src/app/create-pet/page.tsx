"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * 文件名称：create-pet/page.tsx
 * 功能描述：创建 pet 页（命名 UI）
 * 所属模块：app/create-pet
 * 验收对齐：docs/requirements.md §6 #1 创建第一只 pet 并命名
 */

export default function CreatePetPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) {
          router.replace("/login");
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function createPet() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.existing) {
          router.replace("/");
          return;
        }
        setError(data.error ?? "创建失败");
        return;
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="paper p-8 w-full max-w-md space-y-6">
        <header className="text-center space-y-2">
          <Link href="/" className="block text-xs underline" style={{ color: "var(--muted)" }}>
            ← 回到首页
          </Link>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "KaiTi, serif" }}>
            给你的伙伴起个名字
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            它会一直在这个名字下过日子（MVP 阶段不支持改名）
          </p>
        </header>

        <div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            placeholder="例如：小圆"
            maxLength={32}
            className="w-full px-3 py-3 rounded border text-center text-lg"
            style={{
              borderColor: "var(--border)",
              background: "var(--paper)",
              color: "var(--ink)",
            }}
            required
            disabled={loading}
            autoFocus
          />
        </div>

        <button
          onClick={createPet}
          disabled={loading || !name.trim()}
          className="w-full py-3 rounded font-medium transition"
          style={{
            background: "var(--primary)",
            color: "white",
            opacity: loading || !name.trim() ? 0.6 : 1,
          }}
        >
          {loading ? "创建中..." : "开始陪伴"}
        </button>

        {error && (
          <p className="text-sm p-3 rounded" style={{ background: "#fee2e2", color: "#991b1b" }}>
            {error}
          </p>
        )}

        <footer className="text-center text-xs" style={{ color: "var(--muted)" }}>
          名字最长 32 字 · 支持中文、英文、数字、下划线
        </footer>
      </div>
    </main>
  );
}
