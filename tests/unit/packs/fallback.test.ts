/**
 * 文件名称：fallback.test.ts
 * 功能描述：素材包 fallback 逻辑单测
 * 所属模块：tests/unit/packs
 * 验收对齐：docs/requirements.md §6 #8 素材包降级
 */

import { describe, it, expect } from "vitest";
import {
  applyFallback,
  getEffectivePack,
  EMPTY_PACK_MANIFEST,
  isFallbackReasonValid,
} from "@/domain/packs/fallback";
import type { LoadedPack, FallbackReason } from "@/domain/types";

function makeLoadedPack(overrides: Partial<LoadedPack> = {}): LoadedPack {
  return {
    name: "default",
    displayName: "官方默认",
    manifest: EMPTY_PACK_MANIFEST,
    path: "/tmp/packs/default",
    webPath: "/packs/default",
    themeCssContent: ":root { --pack-primary: #e8a87c; }",
    images: {},
    texts: {},
    audio: {},
    ...overrides,
  };
}

describe("fallback", () => {
  describe("applyFallback", () => {
    it("默认成功不 fallback", () => {
      const packed = makeLoadedPack({
        name: "default",
        themeCssContent: ":root { --x: 1 }",
      });
      const result = applyFallback(packed, "default");
      expect(result.effectivePack).toBe(packed);
      expect(result.fallbackReason).toBeNull();
    });

    it("manifest 缺失时 fallback", () => {
      const broken = makeLoadedPack({ manifest: null });
      const defaultPack = makeLoadedPack();
      const result = applyFallback(broken, "default", defaultPack);
      expect(result.effectivePack).toBe(defaultPack);
      expect(result.fallbackReason).toBe("manifest_missing");
    });

    it("theme.css 缺失时 fallback", () => {
      const broken = makeLoadedPack({ themeCssContent: null });
      const defaultPack = makeLoadedPack();
      const result = applyFallback(broken, "default", defaultPack);
      expect(result.effectivePack).toBe(defaultPack);
      expect(result.fallbackReason).toBe("theme_css_missing");
    });

    it("没有 default fallback 时降级到空包", () => {
      const broken = makeLoadedPack({ manifest: null });
      const result = applyFallback(broken, "default");
      expect(result.effectivePack.name).toBe("default");
      expect(result.effectivePack.manifest).toBe(EMPTY_PACK_MANIFEST);
      expect(result.effectivePack.themeCssContent).toBe("/* aetherpet fallback */");
      expect(result.fallbackReason).toBe("manifest_missing");
    });
  });

  describe("getEffectivePack", () => {
    it("default 存在时使用 default（requested==default 同义）", () => {
      const defaultPack = makeLoadedPack({ name: "default" });
      const result = getEffectivePack("default", "default", [defaultPack]);
      expect(result.effectivePack.name).toBe("default");
      expect(result.fallbackReason).toBeNull();
    });

    it("default 不存在时返回空包 + fallback reason", () => {
      const result = getEffectivePack("default", "default", []);
      expect(result.effectivePack.name).toBe("default");
      expect(result.effectivePack.manifest).toBe(EMPTY_PACK_MANIFEST);
      expect(result.fallbackReason).toBe("manifest_missing");
    });

    it("default 存在但损坏时 fallback 到空包", () => {
      const broken = makeLoadedPack({ name: "default", manifest: null });
      const result = getEffectivePack("default", "default", [broken]);
      expect(result.effectivePack.name).toBe("default");
      expect(result.effectivePack.manifest).toBe(EMPTY_PACK_MANIFEST);
      expect(result.fallbackReason).toBe("manifest_missing");
    });

    // P3-002：验证重构后的三参数签名（requested ≠ default）
    it("P3-002：requested 包存在且健康时使用 requested（不再总返回 default）", () => {
      const requested = makeLoadedPack({ name: "custom" });
      const defaultPack = makeLoadedPack({ name: "default" });
      const result = getEffectivePack("custom", "default", [defaultPack, requested]);
      expect(result.effectivePack.name).toBe("custom");
      expect(result.fallbackReason).toBeNull();
    });

    it("P3-002：requested 不存在时 fallback 到 default", () => {
      const defaultPack = makeLoadedPack({ name: "default" });
      const result = getEffectivePack("nonexistent", "default", [defaultPack]);
      expect(result.effectivePack.name).toBe("default");
      expect(result.fallbackReason).toBe("manifest_missing"); // requested 为 null → isPackHealthy 报 manifest_missing
    });

    it("P3-002：requested 损坏时 fallback 到 default", () => {
      const broken = makeLoadedPack({ name: "custom", manifest: null });
      const defaultPack = makeLoadedPack({ name: "default" });
      const result = getEffectivePack("custom", "default", [defaultPack, broken]);
      expect(result.effectivePack.name).toBe("default");
      expect(result.fallbackReason).toBe("manifest_missing");
    });
  });

  describe("isFallbackReasonValid", () => {
    it("合法 reason 通过", () => {
      const reasons: FallbackReason[] = [
        "manifest_missing",
        "manifest_invalid",
        "theme_css_missing",
      ];
      for (const r of reasons) {
        expect(isFallbackReasonValid(r)).toBe(true);
      }
    });

    it("未知 reason 拒绝", () => {
      expect(isFallbackReasonValid("unknown" as never)).toBe(false);
    });
  });
});
