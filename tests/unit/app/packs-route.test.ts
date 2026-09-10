/**
 * 文件名称：packs-route.test.ts
 * 功能描述：GET /packs/[name]/[file] 路由测试（P1-004）
 * 所属模块：tests/unit/app
 * 验收对齐：docs/requirements.md §6 #8 素材包
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// mock loader 避免真读盘
vi.mock("@/domain/packs/loader", () => ({
  readPackFile: vi.fn(),
}));

import { readPackFile } from "@/domain/packs/loader";
import { GET } from "@/app/packs/[name]/[file]/route";

const mockedRead = vi.mocked(readPackFile);

describe("GET /packs/[name]/[file] (P1-004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("合法请求返回文件内容 + 正确 MIME", async () => {
    mockedRead.mockResolvedValue({
      ok: true,
      data: { content: Buffer.from("body { color: red }"), contentType: "text/css" },
    });
    const ctx = { params: Promise.resolve({ name: "default", file: "theme.css" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css");
    const text = await res.text();
    expect(text).toBe("body { color: red }");
  });

  it("路径遍历被拒绝（file 含 ..）", async () => {
    const ctx = { params: Promise.resolve({ name: "default", file: "../../secret.txt" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.status).toBe(400);
    // 未调用 loader（二次防护）
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("绝对路径被拒绝", async () => {
    const ctx = { params: Promise.resolve({ name: "default", file: "/etc/passwd" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.status).toBe(400);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("loader 返回 404 时路由也 404", async () => {
    mockedRead.mockResolvedValue({ ok: false, error: "文件不存在" });
    const ctx = { params: Promise.resolve({ name: "default", file: "missing.css" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.status).toBe(404);
  });

  it("素材包不存在时返回 404", async () => {
    mockedRead.mockResolvedValue({ ok: false, error: "素材包 nope 不存在" });
    const ctx = { params: Promise.resolve({ name: "nope", file: "theme.css" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.status).toBe(404);
  });

  it("参数缺失返回 400", async () => {
    const ctx = { params: Promise.resolve({ name: "", file: "" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.status).toBe(400);
  });

  it("json 文件返回 application/json", async () => {
    mockedRead.mockResolvedValue({
      ok: true,
      data: { content: Buffer.from('{"a":1}'), contentType: "application/json" },
    });
    const ctx = { params: Promise.resolve({ name: "default", file: "manifest.json" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("image 文件返回正确 MIME", async () => {
    mockedRead.mockResolvedValue({
      ok: true,
      data: { content: Buffer.from("pngdata"), contentType: "image/png" },
    });
    const ctx = { params: Promise.resolve({ name: "default", file: "hero.png" }) } as any;
    const res = await GET(null as any, ctx);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});
