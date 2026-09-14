#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""品牌硬编码批量抽离（带断言，失败即中止）。执行后跑 tsc/eslint 兜底。"""
import io, sys

def load(p):
    return io.open(p, encoding="utf-8").read()

def save(p, s):
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)

def rep(p, old, new, expect=1):
    s = load(p)
    n = s.count(old)
    assert n == expect, f"{p}: 期望 {expect} 处, 实际 {n} 处 | {old[:60]!r}"
    save(p, s.replace(old, new))
    print(f"  ok {p}")

# ---------- E1. 服务端显示名：domain 层用 config/brand ----------
rep("src/domain/auth/hub-identity.ts",
    'hubDisplayName: displayName || "AetherPet",',
    'hubDisplayName: displayName || appName(),')
rep("src/domain/auth/hub-identity.ts",
    'import { getHubMeta } from "./hub-meta";',
    'import { getHubMeta } from "./hub-meta";\nimport { appName } from "@/config/brand";')

rep("src/domain/export/error-messages.ts",
    'message: "导入失败：备份文件缺少必要字段，不是一份完整的 AetherPet 导出文件。",',
    'message: "导入失败：备份文件缺少必要字段，不是一份完整的 " + appName() + " 导出文件。",')
rep("src/domain/export/error-messages.ts",
    'import { IMPORT_ERROR_HTTP_STATUS } from "./schema";',
    'import { IMPORT_ERROR_HTTP_STATUS } from "./schema";\nimport { appName } from "@/config/brand";')

# fallback.ts（模块级常量：函数内取 appName，避免 import 顺序问题）
s = load("src/domain/packs/fallback.ts")
assert 'author: "AetherPet core",' in s
s = s.replace('author: "AetherPet core",', 'author: `${appName()} core`,')
assert 'themeCssContent: "/* AetherPet fallback */",' in s
s = s.replace('themeCssContent: "/* AetherPet fallback */",', 'themeCssContent: `/* ${appName()} fallback */`,')
if 'import { appName } from "@/config/brand";' not in s:
    # 插到第一个 import 之后
    idx = s.index("\n")
    s = s[:idx] + '\nimport { appName } from "@/config/brand";' + s[idx:]
save("src/domain/packs/fallback.ts", s)
print("  ok src/domain/packs/fallback.ts")

# ---------- E2. 邮件：header 名 + 显示名（email-template / mail-sender） ----------
s = load("src/domain/auth/email-template.ts")
s = s.replace('const subject = `[${hub.hubDisplayName}] 你的 AetherPet 验证码`;',
              'const subject = `[${hub.hubDisplayName}] 你的 ${appName()} 验证码`;')
s = s.replace('`来自「${hub.hubDisplayName}」的 AetherPet 验证码：${code}`',
              '`来自「${hub.hubDisplayName}」的 ${appName()} 验证码：${code}`')
s = s.replace('<title>${escapeHtml(hub.hubDisplayName)} - AetherPet 验证码</title>',
              '<title>${escapeHtml(hub.hubDisplayName)} - ${appName()} 验证码</title>')
s = s.replace('''<p>你的 AetherPet 验证码是：</p>''',
              '''<p>你的 ${appName()} 验证码是：</p>''')
s = s.replace('<strong>${escapeHtml(hub.hubDisplayName)}</strong> · AetherPet',
              '<strong>${escapeHtml(hub.hubDisplayName)}</strong> · ${appName()}')
s = s.replace('"X-Aetherpet-Hub": hub.hubId,\n      "X-Aetherpet-Hub-Name": hub.hubDisplayName,',
              '`${hubHeaderName()}`: hub.hubId,\n      `${hubHeaderDisplayName()}`: hub.hubDisplayName,')
if 'import { appName, hubHeaderName, hubHeaderDisplayName } from "@/config/brand";' not in s:
    idx = s.index("import ")
    end = s.index("\n", idx)
    s = s[:end] + '\nimport { appName, hubHeaderName, hubHeaderDisplayName } from "@/config/brand";' + s[end:]
save("src/domain/auth/email-template.ts", s)
print("  ok src/domain/auth/email-template.ts")

s = load("src/domain/auth/mail-sender.ts")
s = s.replace('payload.headers["X-Aetherpet-Hub"]', 'payload.headers[hubHeaderName()]')
if 'import { hubHeaderName } from "@/config/brand";' not in s:
    idx = s.index("import ")
    end = s.index("\n", idx)
    s = s[:end] + '\nimport { hubHeaderName } from "@/config/brand";' + s[end:]
save("src/domain/auth/mail-sender.ts", s)
print("  ok src/domain/auth/mail-sender.ts")

# ---------- D1. lib/brand 复用 config/brand ----------
s = load("src/lib/brand.ts")
s = s.replace('import { getEnv } from "@/config/env";', 'import { brandKey as configBrandKey } from "@/config/brand";')
s = s.replace('''/** 对外显示的应用名（邮件、错误文案、UI 默认值等） */
export function brandName(): string {
  return getEnv().APP_NAME;
}

/** 技术标识前缀（小写；cookie / localStorage 等） */
export function brandKey(): string {
  return getEnv().APP_BRAND_KEY;
}

/** 认证 cookie 名（默认 aetherpet_token） */
export function tokenCookieName(): string {
  return `${getEnv().APP_BRAND_KEY}_token`;
}''', '''/** 对外显示的应用名（委托 config/brand） */
export { appName as brandName } from "@/config/brand";

/** 技术标识前缀（小写；委托 config/brand） */
export { brandKey } from "@/config/brand";

/** 认证 cookie 名（默认 aetherpet_token） */
export function tokenCookieName(): string {
  return `${configBrandKey()}_token`;
}''')
save("src/lib/brand.ts", s)
print("  ok src/lib/brand.ts")

# ---------- D2. 客户端：settings 清 cookie + theme-provider linkId ----------
rep("src/app/settings/page.tsx",
    'document.cookie = "aetherpet_token=; Max-Age=0; Path=/";',
    'document.cookie = `${APP_BRAND_KEY_CLIENT}_token=; Max-Age=0; Path=/`;')
s = load("src/app/settings/page.tsx")
if 'import { APP_BRAND_KEY_CLIENT } from "@/config/client-brand";' not in s:
    idx = s.index('"use client";\n')
    end = s.index("\n", idx + len('"use client";'))
    s = s[:end] + '\nimport { APP_BRAND_KEY_CLIENT } from "@/config/client-brand";' + s[end:]
save("src/app/settings/page.tsx", s)
print("  ok src/app/settings/page.tsx (settings)")

rep("src/ui/theme-provider.tsx",
    'const linkId = "aetherpet-pack-css";',
    'const linkId = `${APP_BRAND_KEY_CLIENT}-pack-css`;')
s = load("src/ui/theme-provider.tsx")
if 'import { APP_BRAND_KEY_CLIENT } from "@/config/client-brand";' not in s:
    first_import = s.index("import ")
    end = s.index("\n", first_import)
    s = s[:end] + '\nimport { APP_BRAND_KEY_CLIENT } from "@/config/client-brand";' + s[end:]
save("src/ui/theme-provider.tsx", s)
print("  ok src/ui/theme-provider.tsx")

# ---------- D3. UI 显示名 7 处 ----------
ui_files = [
    "src/app/(pet)/gifts/page.tsx",
    "src/app/(pet)/letter/page.tsx",
    "src/app/(pet)/profile/page.tsx",
    "src/app/(pet)/timeline/page.tsx",
    "src/app/announcements/page.tsx",
    "src/app/page.tsx",
]
for f in ui_files:
    s = load(f)
    n = s.count('?? "AetherPet"')
    assert n >= 1, f"{f}: 未找到 AetherPet 显示名"
    s = s.replace('?? "AetherPet"', "?? APP_NAME_DEFAULT")
    if 'import { APP_NAME_DEFAULT } from "@/config/client-brand";' not in s:
        first_import = s.index("import ")
        end = s.index("\n", first_import)
        s = s[:end] + '\nimport { APP_NAME_DEFAULT } from "@/config/client-brand";' + s[end:]
    save(f, s)
    print(f"  ok {f}")

print("\n全部替换完成 ✅")