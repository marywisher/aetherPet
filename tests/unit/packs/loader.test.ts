/**
 * 文件名称：loader.test.ts
 * 功能描述：素材包加载单测（用真实 fs 读官方 default pack）
 * 所属模块：tests/unit/packs
 * 验收对齐：docs/requirements.md §6 #8 素材包扩展
 */

import { describe, it, expect, beforeAll } from "vitest";
import { loadPacks, loadPackByName, readPackFile, _resetPacksCache } from "@/domain/packs/loader";

describe("loader（加载官方默认素材包）", () => {
  beforeAll(() => {
    _resetPacksCache();
  });

  it("loadPacks 能加载 default 包", async () => {
    const packs = await loadPacks(process.env.ASSET_PACKS_DIR || "./src/assets/packs");
    console.log("[debug] packs loaded:", packs.map((p) => p.name));
    console.log("[debug] packs dir:", process.env.ASSET_PACKS_DIR || "./src/assets/packs");
    expect(packs.length).toBeGreaterThanOrEqual(1);
    const defaultPack = packs.find((p) => p.name === "default");
    if (defaultPack) {
      console.log("[debug] defaultPack manifest keys:", Object.keys(defaultPack.manifest || {}));
      console.log("[debug] defaultPack images keys:", Object.keys(defaultPack.images));
      console.log("[debug] defaultPack texts keys:", Object.keys(defaultPack.texts));
    }
    expect(defaultPack).toBeDefined();
    if (defaultPack) {
      expect(defaultPack.manifest).not.toBeNull();
      expect(defaultPack.manifest?.name).toBe("default");
      expect(defaultPack.manifest?.pack_schema_version).toBe("1.0.0");
      expect(defaultPack.themeCssContent).toMatch(/--pack-primary/);
      expect(defaultPack.images.home_bg).toBeDefined();
      expect(defaultPack.texts.outing).toBeDefined();
      expect(defaultPack.texts.daily_grant).toBeDefined();
    }
  });

  it("loadPackByName 能按名字加载", async () => {
    const pack = await loadPackByName("default");
    expect(pack).toBeDefined();
    expect(pack?.name).toBe("default");
  });

  it("loadPackByName 找不到时返回 null", async () => {
    const pack = await loadPackByName("nonexistent-pack");
    expect(pack).toBeNull();
  });

  it("readPackFile 能读取图片（通过 asset key）", async () => {
    const result = await readPackFile("default", "image", "home_bg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contentType).toBe("image/svg+xml");
      expect(result.data.content.toString()).toContain("<svg");
    }
  });

  it("readPackFile 能读取图片（通过文件名）", async () => {
    const result = await readPackFile("default", "image", "home-bg.svg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contentType).toBe("image/svg+xml");
      expect(result.data.content.toString()).toContain("<svg");
    }
  });

  it("readPackFile 能读取文本", async () => {
    const result = await readPackFile("default", "text", "outing.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contentType).toBe("application/json");
      const parsed = JSON.parse(result.data.content.toString());
      // 阶段 2 文本 JSON 契约（见 docs/packs-contract.md §3）使用 title/body/sign_off 顶层字段
      expect(parsed).toHaveProperty("body");
      expect(parsed.body).toHaveProperty("variants");
    }
  });

  it("readPackFile 拒绝路径遍历", async () => {
    const result = await readPackFile("default", "text", "../../secret.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("非法路径");
    }
  });

  it("readPackFile 拒绝不存在的文件", async () => {
    const result = await readPackFile("default", "text", "not-exist.json");
    expect(result.ok).toBe(false);
  });

  it("readPackFile 能读取 theme.css", async () => {
    const result = await readPackFile("default", "theme", "theme.css");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contentType).toBe("text/css");
      expect(result.data.content.toString()).toContain("--pack-primary");
    }
  });
});
