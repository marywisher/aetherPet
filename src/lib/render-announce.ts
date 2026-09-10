/**
 * 文件名称：render-announce.ts
 * 功能描述：系统公告事件的渲染辅助（API 层使用；P2-001 时间线可见性闭环）
 * 所属模块：lib
 * 说明：
 *   - 收集一批事件里的 system_announce 引用 id → 批量反查公告 → 返回
 *     announcement_id → 渲染占位符 的映射
 *   - 调用方把映射合并进事件 params 副本再 renderEvent
 */

import { findById as findAnnouncementById } from "@/domain/persistence/repos/announcements.repo";
import { announcePlaceholders } from "@/domain/announce/placeholders";

/**
 * 批量解析 system_announce 事件引用的公告占位符。
 * @param events 事件列表（含或不含 system_announce 均可）
 * @returns Map<announcement_id, { announcement_title, announcement_body }>
 */
export async function buildAnnouncePlaceholderMap(
  events: ReadonlyArray<{ type: string; params: Record<string, unknown> }>
): Promise<Map<string, { announcement_title: string; announcement_body: string }>> {
  const ids = [
    ...new Set(
      events
        .filter((e) => e.type === "system_announce")
        .map((e) => String(e.params.announcement_id ?? ""))
        .filter((id) => id.length > 0)
    ),
  ];
  const map = new Map<string, { announcement_title: string; announcement_body: string }>();
  for (const id of ids) {
    // 逐个反查（公告量级小，避免复杂 JOIN；找不到 → 降级占位文案）
    const ann = await findAnnouncementById(id);
    map.set(id, announcePlaceholders(ann));
  }
  return map;
}

/** 为单个事件注入公告占位符（返回浅拷贝事件，不修改原对象） */
export function withAnnouncePlaceholders<T extends { type: string; params: Record<string, unknown> }>(
  event: T,
  placeholders?: { announcement_title: string; announcement_body: string }
): T {
  if (!placeholders) return event;
  return {
    ...event,
    params: { ...event.params, ...placeholders },
  };
}