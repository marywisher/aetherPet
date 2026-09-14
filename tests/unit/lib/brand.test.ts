/**
 * 文件名称：brand.test.ts
 * 功能描述：品牌抽离单测——自证「改名只改 .env」
 * 所属模块：tests/unit/lib
 * 对应校验：
 *   - 2026-09-14 验收补齐：改名 AetherPet → 星野Pet 后，显示名 / 认证 cookie 名 / 邮件头联动
 *   - src/config/brand.ts：appName / brandKey / brandKeyTitle / hubHeaderName
 *   - src/lib/brand.ts：tokenCookieName / readTokenCookie
 *   - src/config/client-brand.ts：NEXT_PUBLIC_* 白名单通道与默认兜底
 * 注意：env.ts 会缓存解析结果，改 env 后必须 _resetEnvCache() 才生效
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _resetEnvCache } from "@/config/env";

const BRAND_KEYS = [
  "APP_NAME",
  "APP_BRAND_KEY",
  "NEXT_PUBLIC_APP_NAME",
  "NEXT_PUBLIC_APP_BRAND_KEY",
] as const;

/** 记录测试开始时的 env 原值，用例结束后还原（vitest 会把 .env 载入 process.env） */
const ORIGINALS: Record<string, string | undefined> = {};
for (const k of BRAND_KEYS) ORIGINALS[k] = process.env[k];

function setEnv(name?: string, key?: string, clientName?: string, clientKey?: string) {
  if (name === undefined) delete process.env.APP_NAME;
  else process.env.APP_NAME = name;
  if (key === undefined) delete process.env.APP_BRAND_KEY;
  else process.env.APP_BRAND_KEY = key;
  if (clientName === undefined) delete process.env.NEXT_PUBLIC_APP_NAME;
  else process.env.NEXT_PUBLIC_APP_NAME = clientName;
  if (clientKey === undefined) delete process.env.NEXT_PUBLIC_APP_BRAND_KEY;
  else process.env.NEXT_PUBLIC_APP_BRAND_KEY = clientKey;
  _resetEnvCache();
}

beforeEach(() => {
  vi.resetModules();
  setEnv();
});

afterEach(() => {
  for (const k of BRAND_KEYS) {
    if (ORIGINALS[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINALS[k];
  }
  _resetEnvCache();
  vi.resetModules();
});

describe("config/brand（服务端：显示名与技术标识来自 .env）", () => {
  it("默认值：APP_NAME / APP_BRAND_KEY 缺失时回退 AetherPet / aetherpet", async () => {
    setEnv(undefined, undefined);
    const { appName, brandKey, brandKeyTitle, hubHeaderName, hubHeaderDisplayName } =
      await import("@/config/brand");
    expect(appName()).toBe("AetherPet");
    expect(brandKey()).toBe("aetherpet");
    expect(brandKeyTitle()).toBe("Aetherpet");
    expect(hubHeaderName()).toBe("X-Aetherpet-Hub");
    expect(hubHeaderDisplayName()).toBe("X-Aetherpet-Hub-Name");
  });

  it("改名只改 .env：APP_NAME / APP_BRAND_KEY 变化即联动显示名、邮件头", async () => {
    setEnv("星野Pet", "xingye");
    const { appName, brandKey, brandKeyTitle, hubHeaderName, hubHeaderDisplayName } =
      await import("@/config/brand");
    expect(appName()).toBe("星野Pet");
    expect(brandKey()).toBe("xingye");
    expect(brandKeyTitle()).toBe("Xingye");
    expect(hubHeaderName()).toBe("X-Xingye-Hub");
    expect(hubHeaderDisplayName()).toBe("X-Xingye-Hub-Name");
  });

  it("大小写敏感：APP_NAME 原样透传，不做 toLowerCase 之类的加工", async () => {
    setEnv("STAR Pet", "STARPET");
    const { appName, brandKey } = await import("@/config/brand");
    expect(appName()).toBe("STAR Pet");
    expect(brandKey()).toBe("STARPET");
  });
});

describe("lib/brand（认证 cookie 名跟随 .env）", () => {
  it("默认 cookie 名为 aetherpet_token", async () => {
    setEnv();
    const { tokenCookieName } = await import("@/lib/brand");
    expect(tokenCookieName()).toBe("aetherpet_token");
  });

  it("改名为 xingye 后 cookie 名为 xingye_token", async () => {
    setEnv(undefined, "xingye");
    const { tokenCookieName } = await import("@/lib/brand");
    expect(tokenCookieName()).toBe("xingye_token");
  });

  it("readTokenCookie 命中当前品牌名，并忽略改名前的旧 cookie", async () => {
    setEnv(undefined, "xingye");
    const { readTokenCookie } = await import("@/lib/brand");
    expect(readTokenCookie("xingye_token=tok-123")).toBe("tok-123");
    expect(readTokenCookie("other=1; xingye_token=tok-123; foo=bar")).toBe("tok-123");
    // 改名后旧 cookie 名不再被识别（避免两个中心/两次改名互相串登录态）
    expect(readTokenCookie("aetherpet_token=old-token")).toBeNull();
    expect(readTokenCookie(null)).toBeNull();
    expect(readTokenCookie("")).toBeNull();
    expect(readTokenCookie("xingye_token")).toBeNull(); // 无 = 不算
  });
});

describe("config/client-brand（客户端 NEXT_PUBLIC_* 通道与兜底）", () => {
  it("NEXT_PUBLIC_* 未配置时回退默认品牌", async () => {
    setEnv();
    const { APP_NAME_DEFAULT, APP_BRAND_KEY_CLIENT } = await import("@/config/client-brand");
    expect(APP_NAME_DEFAULT).toBe("AetherPet");
    expect(APP_BRAND_KEY_CLIENT).toBe("aetherpet");
  });

  it("NEXT_PUBLIC_* 配置后客户端文案与备份文件名前缀跟随", async () => {
    setEnv(undefined, undefined, "星野Pet", "xingye");
    const { APP_NAME_DEFAULT, APP_BRAND_KEY_CLIENT } = await import("@/config/client-brand");
    expect(APP_NAME_DEFAULT).toBe("星野Pet");
    expect(APP_BRAND_KEY_CLIENT).toBe("xingye");
    // /export 页下载文件名前缀（`${APP_BRAND_KEY_CLIENT}-backup-...`）
    expect(`${APP_BRAND_KEY_CLIENT}-backup-好运来`).toBe("xingye-backup-好运来");
  });
});
