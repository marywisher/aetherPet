/**
 * 文件名称：route.ts
 * 功能描述：GET /packs/[name]/[file] — 提供素材包静态文件
 * 所属模块：app/packs
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 1 演示步骤 4
 *
 * P1-004 修复：
 *   - ThemeProvider 通过 <link href="/packs/{name}/{file}"> 拉 theme.css
 *   - 原实现只有 /api/packs，没有 /packs/* 路由，CSS 一直 404
 *   - 此 route 通过 readPackFile 按 category 读取文件并返回对应 MIME
 *   - 路径遍历防护沿用 loader 内的双保险（fileName 含 .. 或绝对路径直接拒绝）
 *
 * Edge 一致性修复：
 *   - 本 route 经 loader 间接使用 fs / path（Node API），显式声明 nodejs runtime，
 *     与其它 7 个 route 保持一致，避免将来误改成 Edge 时报
 *     "A Node.js module is loaded ('fs' ...) which is not supported in the Edge Runtime"。
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readPackFile } from "@/domain/packs/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string; file: string }> };

function inferCategory(fileName: string): "theme" | "image" | "text" | "audio" {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "css":
      return "theme";
    case "json":
      return "text";
    case "ogg":
    case "mp3":
    case "wav":
      return "audio";
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "svg":
    case "gif":
      return "image";
    default:
      return "image";
  }
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext
): Promise<NextResponse> {
  const { name, file } = await ctx.params;

  if (!name || !file) {
    return NextResponse.json({ error: "参数缺失" }, { status: 400 });
  }
  // 二次路径遍历校验（loader 内也有一次）
  // P3-006（Round 2）：不再直接判断 file.includes("..")（会误伤 foo..css 等合法文件名），
  // 改为：拆分段后判断任一段 === ".." 或 "."，且不允许以 / 开头。
  if (file.startsWith("/") || path.isAbsolute(file)) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }
  const segments = file.split(/[\\/]/);
  if (segments.some((seg) => seg === ".." || seg === ".")) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }

  const category = inferCategory(file);
  const result = await readPackFile(name, category, file);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  // 缓存：素材包不可热更新，5 分钟
  const headers: HeadersInit = {
    "Content-Type": result.data.contentType,
    "Cache-Control": "public, max-age=300",
  };

  return new NextResponse(new Uint8Array(result.data.content), {
    status: 200,
    headers,
  });
}
