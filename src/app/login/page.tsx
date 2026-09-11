"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 文件名称：login/page.tsx
 * 功能描述：登录页（邮箱验证码）
 * 所属模块：app/login
 * 验收对齐：docs/requirements.md §6 #1 注册登录（含安全边界）
 */

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [step, setStep] = useState<"email" | "code">("email");

  // 已有 token 直接跳转
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.ok) router.replace("/");
      })
      .catch(() => {});
  }, [router]);

  // 倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendCode() {
    if (!email || cooldown > 0) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "发送失败");
        return;
      }
      setInfo(
        data.dryRun
          ? `开发模式：验证码已生成（见服务端 console）· ${data.expiresInMin} 分钟有效`
          : `验证码已发送到 ${email} · ${data.expiresInMin} 分钟有效`
      );
      setCooldown(60);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!email || code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "验证失败");
        return;
      }
      // token 已写入 cookie
      if (data.isNewUser) {
        router.replace("/create-pet");
      } else {
        router.replace("/");
      }
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
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "KaiTi, serif" }}>
            AetherPet
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            佛系陪伴 · 隐居模式 · 数据主权
          </p>
        </header>

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded border"
              style={{
                borderColor: "var(--border)",
                background: "var(--paper)",
                color: "var(--ink)",
              }}
              required
              disabled={loading}
            />
          </div>

          <button
            onClick={sendCode}
            disabled={loading || cooldown > 0 || !email}
            className="w-full py-2 rounded font-medium transition"
            style={{
              background: "var(--primary)",
              color: "white",
              opacity: loading || cooldown > 0 || !email ? 0.6 : 1,
            }}
          >
            {loading
              ? "发送中..."
              : cooldown > 0
                ? `重新发送（${cooldown}s）`
                : step === "email"
                  ? "发送验证码"
                  : "重新发送验证码"}
          </button>
        </div>

        {info && (
          <p className="text-sm p-3 rounded" style={{ background: "var(--accent)", color: "white" }}>
            {info}
          </p>
        )}

        {step === "code" && (
          <div className="space-y-4 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <div>
              <label className="block text-sm mb-1">6 位验证码</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full px-3 py-2 rounded border text-center tracking-widest text-xl"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                }}
                disabled={loading}
                autoFocus
              />
            </div>
            <button
              onClick={verify}
              disabled={loading || code.length !== 6}
              className="w-full py-2 rounded font-medium transition"
              style={{
                background: "var(--accent)",
                color: "white",
                opacity: loading || code.length !== 6 ? 0.6 : 1,
              }}
            >
              {loading ? "验证中..." : "登录 / 注册"}
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm p-3 rounded" style={{ background: "#fee2e2", color: "#991b1b" }}>
            {error}
          </p>
        )}

        <footer className="text-center text-xs" style={{ color: "var(--muted)" }}>
          使用邮箱验证码登录 · 30 天免登
        </footer>
      </div>
    </main>
  );
}
