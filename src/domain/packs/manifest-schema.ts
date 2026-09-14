/**
 * 文件名称：manifest-schema.ts
 * 功能描述：素材包 manifest.json 的 zod schema
 * 所属模块：domain/packs
 * 说明：
 *   - 单一来源：schema 用于运行时校验 + TS 类型推导
 *   - 领域层纯 TS，可独立单测
 *   - 只支持 pack_schema_version "1.x.x"（当前大版本）
 */

import { z } from "zod";
import type { PackManifest } from "../types";

/** 当前支持的最大 pack schema 大版本 */
export const SUPPORTED_PACK_SCHEMA_MAJOR = "1";

export const PackManifestSchema: z.ZodType<PackManifest> = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_-]+$/, "包名只能含小写字母、数字、下划线、连字符"),
    display_name: z.string().min(1).max(128),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    pack_schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    min_engine_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    author: z.string().min(1),
    license: z.string().min(1),
    theme: z.object({
      css: z.string().min(1),
      palette: z.object({
        primary: z.string(),
        accent: z.string(),
        memory_ref: z.string(),
        paper: z.string(),
        ink: z.string(),
        muted: z.string().optional(),
        border: z.string().optional(),
      }),
    }),
    assets: z.record(z.string(), z.string()).default({}),
    texts: z
      .object({
        outing: z.string().min(1),
        watching_water: z.string().min(1),
        counting_leaves: z.string().min(1),
        self_talk: z.string().min(1),
        brought_item: z.string().min(1),
        reply_letter: z.string().min(1),
        spontaneous_letter: z.string().min(1),
        aggregate_summary: z.string().min(1),
        system_announce: z.string().min(1),
        daily_grant: z.string().min(1),
        offer_received: z.string().min(1),
      })
      .catchall(z.string()),
    fallback: z.string().nullable().default(null),
  })
  .passthrough();

export type PackManifestData = PackManifest;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

/** 判断给定的 pack_schema_version 是否受支持 */
export function isPackSchemaVersionSupported(version: string): boolean {
  return /^1\.\d+\.\d+/.test(version);
}

/** 解析 + 校验 manifest.json */
export function parsePackManifest(raw: unknown): ParseResult<PackManifest> {
  const result = PackManifestSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  if (!isPackSchemaVersionSupported(result.data.pack_schema_version)) {
    return {
      ok: false,
      errors: [
        `manifest pack_schema_version ${result.data.pack_schema_version} 不受支持（当前仅支持 ${SUPPORTED_PACK_SCHEMA_MAJOR}.x.x）`,
      ],
    };
  }
  return { ok: true, data: result.data };
}
