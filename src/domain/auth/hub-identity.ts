/**
 * 文件名称：hub-identity.ts
 * 功能描述：中心身份加载（hub-autonomous email 的身份标识）
 * 所属模块：domain/auth
 * 说明：
 *   - 从 env 读取中心身份，首次启动时写入 meta 表
 *   - 邮件模板、公告、导出 JSON 都从这里读
 *   - 领域层纯 TS，可独立单测
 */

import { getEnv } from "@/config/env";
import { appName } from "@/config/brand";
import { setManyMeta, getMeta } from "../persistence/repos/meta.repo";
import type { HubIdentity } from "../types";

let _hub: HubIdentity | null = null;

/** 从 env 加载中心身份 */
export function loadHubIdentityFromEnv(): HubIdentity {
  const env = getEnv();
  return {
    hubId: env.HUB_ID,
    hubDisplayName: env.HUB_DISPLAY_NAME,
    adminEmail: env.HUB_ADMIN_EMAIL,
    privacyUrl: env.HUB_PRIVACY_URL,
    domain: env.HUB_DOMAIN,
  };
}

/** 同步写入 meta 表（幂等） */
export async function persistHubIdentityToMeta(): Promise<void> {
  const hub = loadHubIdentityFromEnv();
  await setManyMeta({
    hub_id: hub.hubId,
    hub_display_name: hub.hubDisplayName,
    hub_admin_email: hub.adminEmail,
    hub_privacy_url: hub.privacyUrl,
    hub_domain: hub.domain || "",
    schema_version: "1.0.0",
    engine_version: "1.0.0",
    pack_schema_ver: "1.0.0",
    created_at: String(Date.now()),
    last_migration_at: String(Date.now()),
  });
}

/** 读取中心身份（缓存优先，其次 meta 表） */
export async function getHubIdentity(): Promise<HubIdentity> {
  if (_hub) return _hub;
  _hub = loadHubIdentityFromEnv();
  return _hub;
}

/** 从 meta 表读中心身份（供测试验证） */
export async function getHubIdentityFromMeta(): Promise<HubIdentity | null> {
  const [hubId, displayName, adminEmail, privacyUrl, domain] = await Promise.all([
    getMeta("hub_id"),
    getMeta("hub_display_name"),
    getMeta("hub_admin_email"),
    getMeta("hub_privacy_url"),
    getMeta("hub_domain"),
  ]);
  if (!hubId) return null;
  return {
    hubId,
    hubDisplayName: displayName || appName(),
    adminEmail: adminEmail || "",
    privacyUrl: privacyUrl || "",
    domain: domain || "",
  };
}

/** 重置缓存（测试用） */
export function _resetHubCache(): void {
  _hub = null;
}
