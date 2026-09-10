/**
 * 文件名称：manifest-schema.test.ts
 * 功能描述：manifest.json schema 校验单测
 * 所属模块：tests/unit/packs
 * 验收对齐：docs/requirements.md §6 #8 素材包扩展（manifest 校验）
 */

import { describe, it, expect } from "vitest";
import {
  PackManifestSchema,
  isPackSchemaVersionSupported,
  SUPPORTED_PACK_SCHEMA_MAJOR,
  parsePackManifest,
} from "@/domain/packs/manifest-schema";
import type { PackManifest } from "@/domain/types";

const VALID_MANIFEST: PackManifest = {
  name: "test-pack",
  display_name: "Test Pack",
  version: "1.0.0",
  pack_schema_version: "1.0.0",
  min_engine_version: "1.0.0",
  author: "测试者",
  license: "MIT",
  theme: {
    css: "theme.css",
    palette: {
      primary: "#e8a87c",
      accent: "#85c485",
      memory_ref: "#d4b483",
      paper: "#f6efe4",
      ink: "#3d2f23",
    },
  },
  assets: { home_bg: "images/home-bg.svg", letter_bg: "images/letter-bg.svg" },
  texts: {
    outing: "text/outing.json",
    watching_water: "text/watching-water.json",
    counting_leaves: "text/counting-leaves.json",
    self_talk: "text/self-talk.json",
    brought_item: "text/brought-item.json",
    reply_letter: "text/reply-letter.json",
    spontaneous_letter: "text/spontaneous-letter.json",
    aggregate_summary: "text/aggregate-summary.json",
    system_announce: "text/system-announce.json",
    daily_grant: "text/daily-grant.json",
    offer_received: "text/offer-received.json",
  },
  fallback: null,
};

describe("manifest-schema", () => {
  it("合法 manifest 通过校验", () => {
    const result = PackManifestSchema.safeParse(VALID_MANIFEST);
    expect(result.success).toBe(true);
  });

  it("缺失必填字段时拒绝", () => {
    const rest: Record<string, unknown> = { ...VALID_MANIFEST };
    delete rest.display_name;
    const result = PackManifestSchema.safeParse(rest as never);
    expect(result.success).toBe(false);
  });

  it("pack_schema_version 格式错误时拒绝", () => {
    const result = PackManifestSchema.safeParse({
      ...VALID_MANIFEST,
      pack_schema_version: "not-a-version",
    });
    expect(result.success).toBe(false);
  });

  it("name 不匹配正则时拒绝", () => {
    const result = PackManifestSchema.safeParse({
      ...VALID_MANIFEST,
      name: "UPPER SPACE",
    });
    expect(result.success).toBe(false);
  });

  it("空 palette 时拒绝", () => {
    const result = PackManifestSchema.safeParse({
      ...VALID_MANIFEST,
      theme: { css: "theme.css", palette: {} },
    });
    expect(result.success).toBe(false);
  });

  it("isPackSchemaVersionSupported 接受 1.x.x", () => {
    expect(isPackSchemaVersionSupported("1.0.0")).toBe(true);
    expect(isPackSchemaVersionSupported("1.5.2")).toBe(true);
    expect(isPackSchemaVersionSupported("1.99.0")).toBe(true);
  });

  it("isPackSchemaVersionSupported 拒绝其他大版本", () => {
    expect(isPackSchemaVersionSupported("0.9.0")).toBe(false);
    expect(isPackSchemaVersionSupported("2.0.0")).toBe(false);
    expect(isPackSchemaVersionSupported("3.1.0")).toBe(false);
    expect(isPackSchemaVersionSupported("not-a-version")).toBe(false);
  });

  it("SUPPORTED_PACK_SCHEMA_MAJOR 固定为 '1'", () => {
    expect(SUPPORTED_PACK_SCHEMA_MAJOR).toBe("1");
  });

  it("parsePackManifest 正确返回 success=true", () => {
    const result = parsePackManifest(VALID_MANIFEST);
    expect(result.ok).toBe(true);
  });

  it("parsePackManifest 拒绝不支持的大版本", () => {
    const result = parsePackManifest({ ...VALID_MANIFEST, pack_schema_version: "2.0.0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 错误信息应包含 "不受支持" 或 "unsupported"
      expect(result.errors.some((e) => e.includes("不受支持") || e.includes("unsupported") || e.includes("format"))).toBe(true);
    }
  });

  it("parsePackManifest 接受未知字段（extra 不报错）", () => {
    const result = parsePackManifest({
      ...VALID_MANIFEST,
      custom_field: "anything",
    });
    expect(result.ok).toBe(true);
  });
});
