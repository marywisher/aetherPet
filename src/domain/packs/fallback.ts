/**
 * 文件名称：fallback.ts
 * 功能描述：损坏包回退 + 空包降级
 * 所属模块：domain/packs
 * 说明：
 *   - 当前生效包损坏 → 强制回退 default
 *   - default 也损坏 → 返回空 manifest（前端降级为纯文本）
 *   - 领域层纯 TS，可独立单测
 */

import type { PackManifest, LoadedPack, FallbackReason } from "../types";

/** 空 manifest（所有资源缺失时的兜底） */
export const EMPTY_PACK_MANIFEST: PackManifest = {
  name: "default",
  display_name: "官方默认（降级模式）",
  version: "1.0.0",
  pack_schema_version: "1.0.0",
  min_engine_version: "1.0.0",
  author: "aetherPet core",
  license: "MIT",
  theme: {
    css: "",
    palette: {
      primary: "#e8a87c",
      accent: "#85c485",
      memory_ref: "#d4b483",
      paper: "#f6efe4",
      ink: "#3d2f23",
    },
  },
  assets: {},
  texts: {},
  fallback: null,
};

/** 校验 pack 是否健康（关键字段齐全） */
export function isPackHealthy(pack: LoadedPack | null): { healthy: true } | { healthy: false; reason: FallbackReason } {
  if (!pack) return { healthy: false, reason: "manifest_missing" };
  if (!pack.manifest) return { healthy: false, reason: "manifest_missing" };
  if (!pack.themeCssContent) return { healthy: false, reason: "theme_css_missing" };
  return { healthy: true };
}

const VALID_FALLBACK_REASONS: Set<FallbackReason> = new Set([
  "manifest_missing",
  "manifest_invalid",
  "theme_css_missing",
]);

/** 校验 fallback reason 是否为合法值（供测试使用） */
export function isFallbackReasonValid(r: string): r is FallbackReason {
  return VALID_FALLBACK_REASONS.has(r as FallbackReason);
}

export interface FallbackResult {
  effectivePack: LoadedPack;
  fallbackReason: FallbackReason | null;
}

/**
 * 从当前生效包计算最终降级结果
 * @param pack 当前生效包（可能为 null 或损坏）
 * @param defaultPackName 默认包名
 * @param defaultPack 默认包（用于 fallback）
 */
export function applyFallback(
  pack: LoadedPack | null,
  defaultPackName: string = "default",
  defaultPack?: LoadedPack | null
): FallbackResult {
  const health = isPackHealthy(pack);
  if (health.healthy) {
    return { effectivePack: pack!, fallbackReason: null };
  }
  // fallback 到 default pack
  if (defaultPack) {
    const dh = isPackHealthy(defaultPack);
    if (dh.healthy) {
      return { effectivePack: defaultPack, fallbackReason: health.reason };
    }
  }
  // 没有 default pack → 用空包 + 最小 CSS
  const emptyPack: LoadedPack = {
    name: defaultPackName,
    displayName: EMPTY_PACK_MANIFEST.display_name,
    manifest: EMPTY_PACK_MANIFEST,
    path: "",
    webPath: "",
    themeCssContent: "/* aetherpet fallback */",
    images: {},
    texts: {},
    audio: {},
  };
  return { effectivePack: emptyPack, fallbackReason: health.reason };
}

/**
 * 从 packs 列表获取当前生效包（含 fallback）
 * P3-002（Round 2）：重构签名——区分 requestedPackName / defaultPackName，
 * 支持未来「用户级 active_pack_name 切换」。当 requestedPackName 与 defaultPackName 相同时，
 * 行为与旧版一致（MVP 默认只用 default pack）。
 */
export function getEffectivePack(
  requestedPackName: string,
  defaultPackName: string,
  packs: LoadedPack[]
): FallbackResult {
  const defaultPack = packs.find((p) => p.name === defaultPackName) ?? null;
  const requestedPack =
    requestedPackName === defaultPackName
      ? defaultPack
      : packs.find((p) => p.name === requestedPackName) ?? null;
  return applyFallback(requestedPack, defaultPackName, defaultPack);
}
