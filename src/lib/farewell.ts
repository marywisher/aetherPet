/**
 * 文件名称：farewell.ts
 * 功能描述：首会话收尾句（pre-launch 增量 2）
 * 所属模块：lib
 * 说明：
 *   - 按 petId 标记「是否已展示」，支持双落点（首页页脚 + 退出登录落地页）
 *   - 「先触发者置标记」：logout 路径（/settings → /login?farewell=1）优先；
 *     首页页脚兜底（pagehide 时标记，适用于直接关页面用户）
 *   - localStorage 方案：换设备/清缓存会重复一次，可接受（§7.2）
 */

const KEY_PREFIX = "aetherpet_farewell";
const KEY_NAME = `${KEY_PREFIX}_petname`;
const KEY_SHOWN = (petId: string) => `${KEY_PREFIX}_shown_${petId}`;

/** 收尾句的 {pet_name} 占位符 */
const PLACEHOLDER = "{pet_name}";

/** 替换 {pet_name} 占位符 */
export function fillFarewell(template: string, petName: string): string {
  return template.replace(new RegExp(PLACEHOLDER.replace(/_/g, "[_ ]"), "g"), petName);
}

/** 是否已展示过收尾句（当前 pet） */
export function hasShownFarewell(petId: string): boolean {
  if (typeof window === "undefined") return true; // SSR 安全
  return localStorage.getItem(KEY_SHOWN(petId)) === "1";
}

/** 标记收尾句已展示 */
export function markFarewellShown(petId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_SHOWN(petId), "1");
}

/** 在退出登录前存储 pet name，供 /login 页使用 */
export function stashFarewellPetName(petName: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_NAME, petName);
}

/** 取出 pet name 并清空（消费一次） */
export function takeFarewellPetName(): string | null {
  if (typeof window === "undefined") return null;
  const name = localStorage.getItem(KEY_NAME);
  if (name) localStorage.removeItem(KEY_NAME);
  return name;
}