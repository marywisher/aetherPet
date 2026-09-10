/**
 * 文件名称：placeholders.ts
 * 功能描述：system_announce 事件渲染时的公告占位符解析（P2-001/P2-003 闭环）
 * 所属模块：domain/announce
 * 说明：
 *   - 事件 params 只存 announcement_id（"事件结构不含文案"硬约束）
 *   - 渲染时由 API 层反查 announcements 表，把 title/body 临时注入 event.params
 *     副本后交给 renderEvent（渲染层无感知，buildPlaceholderMap 已支持这两个键）
 *   - 公告已归档/不存在 → 降级为占位文案（UI 不白屏）
 */

import type { Announcement } from "./types";

/** 公告 → 渲染占位符；公告不存在/已归档时返回降级文案 */
export function announcePlaceholders(a: Announcement | null): {
  announcement_title: string;
  announcement_body: string;
} {
  if (!a) {
    return {
      announcement_title: "（公告已归档）",
      announcement_body: "这条公告已经被服务中心归档了。",
    };
  }
  return {
    announcement_title: a.title,
    announcement_body: a.body,
  };
}