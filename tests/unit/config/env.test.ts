/**
 * 文件名称：env.test.ts
 * 功能描述：环境变量 zod schema 校验（Round 2 修复 P2-013 回归测试）
 * 所属模块：tests/unit/config
 * 验收对齐：docs/current-stage.md 阶段 2
 *
 * 关键场景（P2-013 修复）：
 *   - `ENABLE_DEV_ENDPOINTS=true` 在 zod schema 中正确解析为 `true`（不是 undefined）
 *   - 未设 → 默认 false
 *   - "false" / "0" → false
 *   - 显式 "true" / "1" → true
 *   - 非法值 → safeParse 失败
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envSchema, getEnv, _resetEnvCache } from "@/config/env";

// 保存原 process.env，避免污染其它测试
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  _resetEnvCache();
});

afterEach(() => {
  _resetEnvCache();
  process.env = { ...ORIGINAL_ENV };
});

describe("env schema 默认值", () => {
  it("空 env 时 getEnv() 返回全部默认值，不抛错", () => {
    // 用一个最小 env（仅 NODE_ENV）
    process.env = { NODE_ENV: "development" };
    const env = getEnv();
    expect(env.NODE_ENV).toBe("development");
    expect(env.DB_HOST).toBe("127.0.0.1");
    expect(env.DB_PORT).toBe(3306);
  });
});

describe("P2-013 · ENABLE_DEV_ENDPOINTS 字段注册", () => {
  it("未设置时默认为 false（fail-closed）", () => {
    process.env = { NODE_ENV: "development" };
    const env = getEnv();
    expect(env.ENABLE_DEV_ENDPOINTS).toBe(false);
  });

  it("`ENABLE_DEV_ENDPOINTS=true` 解析为 boolean true", () => {
    process.env = { NODE_ENV: "production", ENABLE_DEV_ENDPOINTS: "true" };
    const env = getEnv();
    expect(env.ENABLE_DEV_ENDPOINTS).toBe(true);
  });

  it("`ENABLE_DEV_ENDPOINTS=false` 解析为 boolean false", () => {
    process.env = { NODE_ENV: "production", ENABLE_DEV_ENDPOINTS: "false" };
    const env = getEnv();
    expect(env.ENABLE_DEV_ENDPOINTS).toBe(false);
  });

  it("`ENABLE_DEV_ENDPOINTS=1` 视为 true（bool 转换器兼容）", () => {
    process.env = { NODE_ENV: "production", ENABLE_DEV_ENDPOINTS: "1" };
    const env = getEnv();
    expect(env.ENABLE_DEV_ENDPOINTS).toBe(true);
  });

  it("`ENABLE_DEV_ENDPOINTS=0` 视为 false", () => {
    process.env = { NODE_ENV: "production", ENABLE_DEV_ENDPOINTS: "0" };
    const env = getEnv();
    expect(env.ENABLE_DEV_ENDPOINTS).toBe(false);
  });

  it("非法字符串 → safeParse 失败", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      ENABLE_DEV_ENDPOINTS: "maybe",
    });
    expect(result.success).toBe(false);
  });

  it("Env 类型导出后 ENABLE_DEV_ENDPOINTS 字段存在（TS 编译期）", () => {
    // 编译期断言：`Env` 类型必须包含 ENABLE_DEV_ENDPOINTS 字段且类型为 boolean
    process.env = { NODE_ENV: "development" };
    const env = getEnv();
    const _typeCheck: boolean = env.ENABLE_DEV_ENDPOINTS;
    expect(typeof _typeCheck).toBe("boolean");
  });
});

describe("NODE_ENV 与 ENABLE_DEV_ENDPOINTS 组合", () => {
  it("生产模式默认拒绝（NODE_ENV=production + 未设白名单）", () => {
    process.env = { NODE_ENV: "production" };
    const env = getEnv();
    // 模拟 route.ts 中 isDevEndpointEnabled 逻辑
    const isProd = env.NODE_ENV === "production";
    const enabled = !isProd || env.ENABLE_DEV_ENDPOINTS === true;
    expect(enabled).toBe(false);
  });

  it("生产模式 + 白名单显式开启 → 允许", () => {
    process.env = { NODE_ENV: "production", ENABLE_DEV_ENDPOINTS: "true" };
    const env = getEnv();
    const isProd = env.NODE_ENV === "production";
    const enabled = !isProd || env.ENABLE_DEV_ENDPOINTS === true;
    expect(enabled).toBe(true);
  });

  it("开发模式不管白名单 → 允许", () => {
    process.env = { NODE_ENV: "development" };
    const env = getEnv();
    const isProd = env.NODE_ENV === "production";
    const enabled = !isProd || env.ENABLE_DEV_ENDPOINTS === true;
    expect(enabled).toBe(true);
  });
});
