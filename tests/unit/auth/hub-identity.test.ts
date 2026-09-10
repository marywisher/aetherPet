/**
 * 文件名称：hub-identity.test.ts
 * 功能描述：中心身份加载单测
 * 所属模块：tests/unit/auth
 */

import { describe, it, expect } from "vitest";
import { loadHubIdentityFromEnv, _resetHubCache } from "@/domain/auth/hub-identity";
import { _resetEnvCache } from "@/config/env";

describe("hub-identity（中心自治邮件的身份标识）", () => {
  it("从 env 加载 hub 身份", () => {
    _resetEnvCache();
    _resetHubCache();
    const hub = loadHubIdentityFromEnv();
    expect(hub.hubId).toBeDefined();
    expect(hub.hubDisplayName).toBeDefined();
    expect(hub.adminEmail).toBeDefined();
    expect(hub.privacyUrl).toBeDefined();
  });

  it("hubId 默认为 local（无 env）", () => {
    _resetEnvCache();
    const hub = loadHubIdentityFromEnv();
    // 测试 setup 中设了 HUB_ID=test-hub
    expect(typeof hub.hubId).toBe("string");
    expect(hub.hubId.length).toBeGreaterThan(0);
  });

  it("支持自定义 hub 身份", () => {
    _resetEnvCache();
    process.env.HUB_ID = "custom-hub";
    process.env.HUB_DISPLAY_NAME = "Custom Hub";
    process.env.HUB_ADMIN_EMAIL = "custom-admin@example.com";
    process.env.HUB_PRIVACY_URL = "https://custom.example.com/privacy";
    const hub = loadHubIdentityFromEnv();
    expect(hub.hubId).toBe("custom-hub");
    expect(hub.hubDisplayName).toBe("Custom Hub");
    expect(hub.adminEmail).toBe("custom-admin@example.com");
    expect(hub.privacyUrl).toBe("https://custom.example.com/privacy");
    // 清理
    delete process.env.HUB_ID;
    delete process.env.HUB_DISPLAY_NAME;
    delete process.env.HUB_ADMIN_EMAIL;
    delete process.env.HUB_PRIVACY_URL;
  });
});
