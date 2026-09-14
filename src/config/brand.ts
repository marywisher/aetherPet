/**
 * 文件名称：brand.ts（config 层）
 * 功能描述：应用品牌名的领域/服务端通用读取（改名只改 .env）
 * 所属模块：config（domain / lib / route 均可 import，不依赖 next）
 * 验收对齐：
 *   - 阶段 6 收官（用户要求）：应用名称不硬编码，抽离全局配置（.env）
 *
 * 约定：
 *   - appName()        对外显示名（APP_NAME，注意大小写）
 *   - brandKey()       技术标识（APP_BRAND_KEY，小写；cookie/localStorage/邮件头前缀）
 *   - brandKeyTitle()  首字母大写形式的品牌键（如 Aetherpet → 邮件头 X-Aetherpet-Hub）
 */

import { getEnv } from "./env";

/** 对外显示的应用名 */
export function appName(): string {
  return getEnv().APP_NAME;
}

/** 技术标识前缀（小写） */
export function brandKey(): string {
  return getEnv().APP_BRAND_KEY;
}

/** 首字母大写形式的品牌键（用于邮件头等协议字段，如 X-Aetherpet-Hub） */
export function brandKeyTitle(): string {
  return brandKey().replace(/^\w/, (c) => c.toUpperCase());
}

/** 邮件头：中心身份标识（X-Aetherpet-Hub） */
export function hubHeaderName(): string {
  return `X-${brandKeyTitle()}-Hub`;
}

/** 邮件头：中心显示名（X-Aetherpet-Hub-Name） */
export function hubHeaderDisplayName(): string {
  return `X-${brandKeyTitle()}-Hub-Name`;
}