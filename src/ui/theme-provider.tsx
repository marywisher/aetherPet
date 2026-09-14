"use client";
import { APP_BRAND_KEY_CLIENT } from "@/config/client-brand";

import { useEffect, useState, createContext, useContext } from "react";

/**
 * 文件名称：theme-provider.tsx
 * 功能描述：主题提供器（注入素材包 CSS 变量）
 * 所属模块：ui
 * 说明：
 *   - 首次挂载时从 /api/packs 拉取当前生效素材包
 *   - 通过 <link> 标签注入 theme.css
 *   - 通过 CSS 变量注入 palette
 *   - 前端不感知素材包内部结构，只消费 palette
 */

interface ThemeContextValue {
  packName: string | null;
  packDisplayName: string | null;
  palette: {
    primary: string;
    accent: string;
    memoryRef: string;
    paper: string;
    ink: string;
  } | null;
  webPath: string | null;
  availablePacks: { name: string; displayName: string }[];
  loading: boolean;
  error: string | null;
}

const ThemeContext = createContext<ThemeContextValue>({
  packName: null,
  packDisplayName: null,
  palette: null,
  webPath: null,
  availablePacks: [],
  loading: true,
  error: null,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<ThemeContextValue>({
    packName: null,
    packDisplayName: null,
    palette: null,
    webPath: null,
    availablePacks: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function loadTheme() {
      try {
        const res = await fetch("/api/packs");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        const current = data.current;
        if (current) {
          // 注入 CSS 变量到 :root
          const palette = current.theme.palette;
          const root = document.documentElement;
          root.style.setProperty("--pack-primary", palette.primary);
          root.style.setProperty("--pack-accent", palette.accent);
          root.style.setProperty("--pack-memory-ref", palette.memory_ref);
          root.style.setProperty("--pack-paper", palette.paper);
          root.style.setProperty("--pack-ink", palette.ink);

          // 通过 link 标签注入 theme.css（Next.js 会自动缓存）
          const linkId = `${APP_BRAND_KEY_CLIENT}-pack-css`;
          let link = document.getElementById(linkId) as HTMLLinkElement | null;
          if (!link) {
            link = document.createElement("link");
            link.id = linkId;
            link.rel = "stylesheet";
            document.head.appendChild(link);
          }
          link.href = `${current.webPath}/${current.theme.css}`;

          setValue({
            packName: current.name,
            packDisplayName: current.displayName,
            palette: {
              primary: palette.primary,
              accent: palette.accent,
              memoryRef: palette.memory_ref,
              paper: palette.paper,
              ink: palette.ink,
            },
            webPath: current.webPath,
            availablePacks: data.available ?? [],
            loading: false,
            error: null,
          });
        } else {
          setValue((v) => ({ ...v, loading: false, error: "素材包加载失败，使用降级模式" }));
        }
      } catch (err) {
        if (cancelled) return;
        setValue((v) => ({
          ...v,
          loading: false,
          error: err instanceof Error ? err.message : "素材包加载失败",
        }));
      }
    }
    void loadTheme();
    return () => {
      cancelled = true;
    };
  }, []);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
