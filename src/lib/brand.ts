/**
 * 文件名称：brand.ts
 * 功能描述：应用品牌与标识符的服务端单点读取（改名只改 .env）
 * 所属模块：lib（服务端专用；客户端请用 config/client-brand.ts）
 * 验收对齐：
 *   - 阶段 6 收官（用户要求）：应用名称不得硬编码到核心逻辑，
 *     全部抽离到全局配置（.env）：APP_NAME / APP_BRAND_KEY
 *
 * 约定：
 *   - APP_NAME      对外显示名（注意大小写，如 "AetherPet"）
 *   - APP_BRAND_KEY 技术标识符（小写，用于 cookie 名、localStorage key 前缀等）
 *   - 认证 cookie 名 = `${APP_BRAND_KEY}_token`
 */

import { brandKey as configBrandKey } from "@/config/brand";

/** 对外显示的应用名（委托 config/brand） */
export { appName as brandName } from "@/config/brand";

/** 技术标识前缀（小写；委托 config/brand） */
export { brandKey } from "@/config/brand";

/** 认证 cookie 名（默认 aetherpet_token） */
export function tokenCookieName(): string {
  return `${configBrandKey()}_token`;
}

/**
 * 从 Cookie 请求头中读取认证 token（服务端统一实现，替代各 route 的本地正则副本）。
 *
 * @param cookieHeader `req.headers.get("cookie")` 的原始字符串（可为 null）
 * @returns token 字符串；未携带时为 null
 */
export function readTokenCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const name = tokenCookieName();
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}
