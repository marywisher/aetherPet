/**
 * 文件名称：client-brand.ts
 * 功能描述：客户端品牌常量（Next.js 客户端构建期静态替换 NEXT_PUBLIC_*）
 * 所属模块：config
 * 验收对齐：
 *   - 阶段 6 收官（用户要求）：应用名称不得硬编码，抽离到全局配置（.env）
 *
 * 用法：.env 设置 NEXT_PUBLIC_APP_NAME / NEXT_PUBLIC_APP_BRAND_KEY，
 *       重构后无需改代码即可整体更名。客户端无法读取服务端 env（会暴露密钥），
 *       所以品牌名走 NEXT_PUBLIC_ 前缀的白名单通道。
 */

/** 对外显示名（UI fallback；默认 AetherPet） */
export const APP_NAME_DEFAULT: string =
  process.env.NEXT_PUBLIC_APP_NAME || "AetherPet";

/** 技术标识前缀（小写；localStorage 前缀、cookie 清空等；默认 aetherpet） */
export const APP_BRAND_KEY_CLIENT: string =
  process.env.NEXT_PUBLIC_APP_BRAND_KEY || "aetherpet";