"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * 文件名称：import/page.tsx
 * 功能描述：/import — 导入恢复页（数据主权）
 * 所属模块：app/import
 * 验收对齐：
 *   - docs/requirements.md §3.9（导入失败三类错误分文案展示）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 2/3/4
 * 交互：
 *   - 选择导出 JSON → 本地预解析预览 → 确认导入 → POST /api/import
 *   - 服务端返回 code（ERR_VERSION_MISMATCH / ERR_CHECKSUM_MISMATCH / ERR_FIELD_MISSING…）
 *     → 页面按 code 渲染对应文案
 * 安全提示：导入会清空当前账号已有 pet 数据并重建（恢复语义），需确认二次。
 */

interface ImportErrorShape {
  error: string;
  code?: string;
  detail?: string;
}

const ERR_COPY: Record<string, { title: string; hint: string } | undefined> = {
  ERR_VERSION_MISMATCH: {
    title: "版本不匹配",
    hint: "这份备份来自不兼容的版本。请确认它由同一中心的最新版本导出。",
  },
  ERR_CHECKSUM_MISMATCH: {
    title: "校验和失败",
    hint: "文件在导出后可能被改动或损坏。建议重新导出后再导入，不要手动编辑备份文件。",
  },
  ERR_FIELD_MISSING: {
    title: "字段缺失",
    hint: "文件不完整或有结构问题，不是一份完整的 AetherPet 备份。",
  },
  ERR_NOT_JSON: {
    title: "不是合法的 JSON",
    hint: "请选择「导出备份」生成的 .json 文件。",
  },
  ERR_TOO_LARGE: {
    title: "文件过大",
    hint: "备份文件超过 10MB 上限，请重新导出。",
  },
};

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<{ name: string; pets: number; memories: number; events: number } | null>(null);
  const [raw, setRaw] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorKind(null);
    setErrorMsg(null);
    setSuccess(null);
    setPreview(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRaw(text);
      setFileName(file.name);
      try {
        const obj = JSON.parse(text) as {
          meta?: { schema_version?: string; exported_from?: string; exported_at?: number };
          pet?: { base?: { name?: string }; memories?: unknown[]; events?: unknown[] };
        };
        setPreview({
          name: obj.pet?.base?.name ?? "（未知）",
          pets: 1,
          memories: obj.pet?.memories?.length ?? 0,
          events: obj.pet?.events?.length ?? 0,
        });
      } catch {
        setPreview(null);
        setErrorKind("ERR_NOT_JSON");
        setErrorMsg("文件不是合法的 JSON，无法预览。");
      }
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!raw) return;
    setBusy(true);
    setErrorKind(null);
    setErrorMsg(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await res.json()) as ImportErrorShape & { imported?: { petName: string; events: number; memories: number; inventory: number } };
      if (!res.ok) {
        setErrorKind(data.code ?? "ERR_UNKNOWN");
        setErrorMsg(data.error ?? `导入失败 (${res.status})`);
        return;
      }
      const s = data.imported;
      setSuccess(
        s
          ? `导入完成！pet「${s.petName}」已恢复：${s.memories} 条记忆、${s.events} 条事件、${s.inventory} 件物品。`
          : "导入完成！"
      );
    } catch (e) {
      setErrorKind("ERR_UNKNOWN");
      setErrorMsg(e instanceof Error ? e.message : "网络错误");
    } finally {
      setBusy(false);
    }
  }

  const copy = errorKind ? ERR_COPY[errorKind] : undefined;

  return (
    <div className="max-w-2xl mx-auto p-6 pb-32 space-y-4">
      <header>
        
<Link href="/settings" className="text-xs underline" style={{ color: "var(--muted)" }}>
          ← 回设置
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "var(--pack-ink)" }}>
          导入恢复
        </h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          从备份 JSON 恢复你的 pet 数据。
        </p>
      </header>

      <section className="rounded-2xl p-4 border" style={{ borderColor: "var(--pack-accent)", background: "var(--pack-paper)" }}>
        <label
          className="block px-4 py-6 text-center rounded-xl border border-dashed cursor-pointer"
          style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
        >
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          {fileName ? `已选择：${fileName}` : "点击选择备份文件（.json）"}
        </label>

        {preview && (
          <div className="mt-4 text-xs space-y-1" style={{ color: "var(--muted)" }}>
            <p>文件预览：</p>
            <p>· pet：{preview.name}</p>
            <p>· 记忆 {preview.memories} 条 · 事件 {preview.events} 条</p>
            <p className="mt-2" style={{ color: "var(--danger)" }}>
              ⚠️ 导入将<strong>清空并替换</strong>当前账号已有的 pet 数据（恢复语义）。
            </p>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={doImport}
                disabled={busy}
                className="px-4 py-2 rounded-full text-sm disabled:opacity-50"
                style={{ background: "var(--pack-accent)", color: "var(--pack-paper)" }}
              >
                {busy ? "导入中…" : "确认导入"}
              </button>
            </div>
          </div>
        )}

        {errorKind && (
          <div className="mt-4 rounded-xl p-3 border" style={{ borderColor: "var(--danger)", background: "var(--pack-paper)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
              {copy?.title ?? "导入失败"}（{errorKind}）
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{errorMsg}</p>
            {copy?.hint && <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{copy.hint}</p>}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-xl p-3 border" style={{ borderColor: "var(--pack-accent)" }}>
            <p className="text-sm" style={{ color: "var(--pack-ink)" }}>✅ {success}</p>
            
<Link href="/timeline" className="text-xs underline mt-1 inline-block" style={{ color: "var(--muted)" }}>
              去看看恢复后的时间线 →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}