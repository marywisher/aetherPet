/**
 * 文件名称：contract-vs-schema.test.ts
 * 功能描述：契约文档与实际 manifest schema / manifest.json 一致性校验（阶段 2 Round 2 修复 P1-003）
 * 所属模块：tests/unit/packs
 * 说明：
 *   - 加载默认包 manifest.json，断言其能被 PackManifestSchema 校验通过
 *   - 断言字段名与契约 §2 对齐（name/display_name/version/pack_schema_version/min_engine_version/
 *     author/license/theme/css/palette/assets/texts/fallback）
 *   - 断言 11 个事件类型的 text 键齐全
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  PackManifestSchema,
  parsePackManifest,
  isPackSchemaVersionSupported,
} from "@/domain/packs/manifest-schema";

const MANIFEST_PATH = resolve(
  process.cwd(),
  "src/assets/packs/default/manifest.json"
);

describe("contract-vs-schema（阶段 2 Round 2 · P1-003）", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

  it("默认包 manifest.json 能被 PackManifestSchema 校验通过", () => {
    expect(PackManifestSchema.safeParse(manifest).success).toBe(true);
    expect(parsePackManifest(manifest).ok).toBe(true);
  });

  it("pack_schema_version 是受支持的大版本（1.x.x）", () => {
    expect(isPackSchemaVersionSupported(manifest.pack_schema_version)).toBe(true);
    expect(manifest.pack_schema_version).toMatch(/^1\.\d+\.\d+$/);
  });

  it("契约 §2 字段名全部对齐：name / display_name / version / pack_schema_version", () => {
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.display_name).toBe("string");
    expect(typeof manifest.version).toBe("string");
    expect(typeof manifest.pack_schema_version).toBe("string");
    expect(typeof manifest.min_engine_version).toBe("string");
    expect(typeof manifest.author).toBe("string");
    expect(typeof manifest.license).toBe("string");
  });

  it("theme.css + theme.palette 结构（契约 §2 嵌套对象）", () => {
    expect(manifest.theme).toBeDefined();
    expect(typeof manifest.theme.css).toBe("string");
    expect(manifest.theme.palette).toBeDefined();
    for (const key of ["primary", "accent", "memory_ref", "paper", "ink"]) {
      expect(typeof manifest.theme.palette[key]).toBe("string");
    }
  });

  it("11 个事件类型 text 键齐全（契约 §5 事件契约速查表）", () => {
    const EXPECTED_TYPES = [
      "outing",
      "watching_water",
      "counting_leaves",
      "self_talk",
      "brought_item",
      "reply_letter",
      "spontaneous_letter",
      "aggregate_summary",
      "system_announce",
      "daily_grant",
      "offer_received",
    ];
    expect(Object.keys(manifest.texts).length).toBe(11);
    for (const t of EXPECTED_TYPES) {
      expect(manifest.texts[t], `缺少 text 键: ${t}`).toBeDefined();
      expect(typeof manifest.texts[t]).toBe("string");
      expect(manifest.texts[t]).toContain(".json");
    }
  });

  it("manifest 不使用旧版错误字段名（pack_id / pack_name / text_files / theme_css）", () => {
    // 反证：旧契约 v1.0.0 中错误描述的字段不应出现
    expect(manifest).not.toHaveProperty("pack_id");
    expect(manifest).not.toHaveProperty("pack_name");
    expect(manifest).not.toHaveProperty("text_files");
    expect(manifest).not.toHaveProperty("theme_css");
    expect(manifest).not.toHaveProperty("description");
  });

  it("使用 texts 对象而非 text_files 数组（v1.0.1 契约修正）", () => {
    expect(manifest.texts).toBeDefined();
    expect(typeof manifest.texts).toBe("object");
    expect(Array.isArray(manifest.texts)).toBe(false);
  });

  it("fallback 字段默认为 null（MVP 阶段不启用包间回退）", () => {
    expect(manifest.fallback).toBeNull();
  });

  it("PackManifestSchema 拒绝旧版错误结构（回归防护）", () => {
    // 模拟旧契约 §2 描述的错误结构
    const legacyManifest = {
      pack_id: "default",
      pack_name: "AetherPet 默认包",
      engine_version: "1.0.0",
      text_files: ["outing"],
      theme_css: "theme.css",
      description: "默认",
      min_engine_version: "1.0.0",
      author: "team",
      license: "MIT",
    };
    expect(PackManifestSchema.safeParse(legacyManifest).success).toBe(false);
  });

  it("PackManifestSchema 拒绝缺失必填字段", () => {
    const broken = { ...manifest, name: undefined };
    expect(PackManifestSchema.safeParse(broken).success).toBe(false);
  });
});
