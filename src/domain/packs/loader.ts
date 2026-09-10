/**
 * 文件名称：loader.ts
 * 功能描述：素材包加载器
 * 所属模块：domain/packs
 * 说明：
 *   - 扫描 ASSET_PACKS_DIR 下所有 manifest.json
 *   - 用 zod schema 校验
 *   - 校验 theme.css 是否存在
 *   - 读取所有资源到内存（供 API 提供）
 *   - 领域层纯 TS，可独立单测
 *   - 缓存加载结果，避免每次请求重扫
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getEnv } from "@/config/env";
import { PackManifestSchema, isPackSchemaVersionSupported } from "./manifest-schema";
import type { PackManifest, LoadedPack } from "../types";

/**
 * P2-008：静态锚定项目根目录。
 *
 * 使用 import.meta.url 而非 process.cwd()，避免 Next.js build 阶段的
 * 静态分析触发 "whole project traced" 告警（Turbopack/webpack 能把 import.meta.url
 * 视作静态锚点，进而只 trace 素材包子目录，而不是把 src/ 整个打包进 standalone）。
 * 编译为 Node.js 后 import.meta.url 指向 src/domain/packs/loader.ts 的路径。
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// loader.ts 位于 src/domain/packs/，项目根 = ../../..
const PROJECT_ROOT = path.resolve(MODULE_DIR, "..", "..", "..");

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

let _packsCache: LoadedPack[] | null = null;

/**
 * P2-011：手动刷新缓存。
 * 开发模式：热加新素材包后立即生效，无需重启进程。
 * 生产模式：仍受缓存保护，仅在显式调用 refreshPacks 时刷新。
 */
export function refreshPacks(): void {
  _packsCache = null;
}

/** 扫描并加载所有素材包 */
export async function loadPacks(packsDir?: string): Promise<LoadedPack[]> {
  if (_packsCache) return _packsCache;

  const env = getEnv();
  // P2-008：优先用相对项目根解析，避免 process.cwd() 触发全项目 trace
  const rawDir = packsDir || env.ASSET_PACKS_DIR;
  const absDir = path.isAbsolute(rawDir)
    ? rawDir
    : path.resolve(PROJECT_ROOT, rawDir);
  const result: LoadedPack[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(absDir);
  } catch (err) {
    console.error("[loader] 无法读取素材包目录:", err);
    return [];
  }

  for (const entry of entries) {
    const packDir = path.join(absDir, entry);
    let stat;
    try {
      stat = await fs.stat(packDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const manifestPath = path.join(packDir, "manifest.json");
    let manifestRaw: string;
    try {
      manifestRaw = await fs.readFile(manifestPath, "utf-8");
    } catch {
      console.warn(`[loader] ${entry}: 缺少 manifest.json，跳过`);
      continue;
    }

    let manifestData: PackManifest;
    try {
      const parsed = JSON.parse(manifestRaw);
      const schemaResult = PackManifestSchema.safeParse(parsed);
      if (!schemaResult.success) {
        const reason = schemaResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        console.warn(`[loader] ${entry}: manifest schema 校验失败：${reason}`);
        continue;
      }
      manifestData = schemaResult.data;
    } catch (err) {
      console.warn(`[loader] ${entry}: manifest 解析失败:`, err);
      continue;
    }

    if (!isPackSchemaVersionSupported(manifestData.pack_schema_version)) {
      console.warn(`[loader] ${entry}: pack_schema_version ${manifestData.pack_schema_version} 不受支持`);
      continue;
    }

    // 校验 theme.css 存在
    const cssPath = path.join(packDir, manifestData.theme.css);
    let themeCssContent: string | null = null;
    try {
      themeCssContent = await fs.readFile(cssPath, "utf-8");
    } catch {
      console.warn(`[loader] ${entry}: 缺少 theme.css (${manifestData.theme.css})`);
      continue;
    }

    // 读取图片
    const images: Record<string, { content: Buffer; contentType: string }> = {};
    for (const [key, relPath] of Object.entries(manifestData.assets || {})) {
      try {
        const abs = path.resolve(packDir, relPath);
        if (!abs.startsWith(packDir)) continue;
        const content = await fs.readFile(abs);
        images[key] = {
          content,
          contentType: IMAGE_MIME[path.extname(relPath).toLowerCase()] || "application/octet-stream",
        };
      } catch {
        // 图片缺失时跳过（不阻塞）
      }
    }

    // 读取文本
    const texts: Record<string, unknown> = {};
    for (const [key, relPath] of Object.entries(manifestData.texts)) {
      try {
        const abs = path.resolve(packDir, relPath);
        if (!abs.startsWith(packDir)) continue;
        const content = await fs.readFile(abs, "utf-8");
        texts[key] = JSON.parse(content);
      } catch {
        // 文本缺失时跳过
      }
    }

    // 读取音频（预留：从 manifest.audio 读，MVP 默认无音频）
    const audio: Record<string, { content: Buffer; contentType: string }> = {};

    const webPath = `/packs/${manifestData.name}`;
    result.push({
      name: manifestData.name,
      displayName: manifestData.display_name,
      manifest: manifestData,
      path: packDir,
      webPath,
      themeCssContent,
      images,
      texts,
      audio,
    });
  }

  _packsCache = result;
  return result;
}

/** 测试用：重置缓存 */
export function _resetPacksCache(): void {
  _packsCache = null;
}

/** 按名字加载指定素材包 */
export async function loadPackByName(name: string, packsDir?: string): Promise<LoadedPack | null> {
  const dir = packsDir || getEnv().ASSET_PACKS_DIR;
  const packs = await loadPacks(dir);
  return packs.find((p) => p.name === name) ?? null;
}

export type ReadPackResult =
  | { ok: true; data: { content: Buffer; contentType: string } }
  | { ok: false; error: string };

/** 读取素材包内某个文件 */
export async function readPackFile(
  packName: string,
  category: "image" | "text" | "audio" | "theme",
  fileName: string,
  packsDir?: string
): Promise<ReadPackResult> {
  const pack = await loadPackByName(packName, packsDir);
  if (!pack) return { ok: false, error: `素材包 ${packName} 不存在` };

  // 拒绝路径遍历（P3-006：不再判断 fileName.includes("..")，避免误伤 foo..css）
  if (path.isAbsolute(fileName) || fileName.startsWith("/")) {
    return { ok: false, error: "非法路径" };
  }
  const segments = fileName.split(/[\\/]/);
  if (segments.some((seg) => seg === ".." || seg === ".")) {
    return { ok: false, error: "非法路径" };
  }

  const packDir = pack.path;

  if (category === "image") {
    // 优先通过 asset key 查找（如 home_bg）
    let image = pack.images[fileName];
    if (!image) {
      // 尝试通过文件名查找（如 home-bg.svg → 匹配 manifest.assets 中的值）
      for (const [key, relPath] of Object.entries(pack.manifest?.assets || {})) {
        if (relPath.endsWith(fileName) || relPath.endsWith(`/${fileName}`)) {
          image = pack.images[key];
          break;
        }
      }
    }
    if (image) return { ok: true, data: image };
    // 兜底：直接找文件
    const abs = path.resolve(packDir, fileName);
    if (!abs.startsWith(packDir)) return { ok: false, error: "非法路径" };
    try {
      const content = await fs.readFile(abs);
      const ct = IMAGE_MIME[path.extname(fileName).toLowerCase()] || "application/octet-stream";
      return { ok: true, data: { content, contentType: ct } };
    } catch {
      return { ok: false, error: "文件不存在" };
    }
  }

  if (category === "text") {
    // 优先通过 text key 查找
    if (pack.texts[fileName]) {
      const obj = pack.texts[fileName];
      return { ok: true, data: { content: Buffer.from(JSON.stringify(obj)), contentType: "application/json" } };
    }
    // 通过文件名查找 manifest.texts 中的值
    let relPath: string | undefined;
    for (const [, val] of Object.entries(pack.manifest?.texts || {})) {
      if (val.endsWith(fileName) || val.endsWith(`/${fileName}`)) {
        relPath = val;
        break;
      }
    }
    if (relPath) {
      const abs = path.resolve(packDir, relPath);
      if (!abs.startsWith(packDir)) return { ok: false, error: "非法路径" };
      try {
        const content = await fs.readFile(abs);
        return { ok: true, data: { content, contentType: "application/json" } };
      } catch {
        return { ok: false, error: "文件不存在" };
      }
    }
    // 兜底：直接找文件
    const abs = path.resolve(packDir, fileName);
    if (!abs.startsWith(packDir)) return { ok: false, error: "非法路径" };
    try {
      const content = await fs.readFile(abs);
      return { ok: true, data: { content, contentType: "application/json" } };
    } catch {
      return { ok: false, error: "文件不存在" };
    }
  }

  if (category === "theme") {
    if (!pack.themeCssContent) return { ok: false, error: "theme.css 缺失" };
    return { ok: true, data: { content: Buffer.from(pack.themeCssContent), contentType: "text/css" } };
  }

  if (category === "audio") {
    const audio = pack.audio[fileName.replace(/\.[^.]+$/, "")] || pack.audio[fileName];
    if (!audio) return { ok: false, error: "音频不存在" };
    return { ok: true, data: audio };
  }

  return { ok: false, error: "未知类别" };
}
