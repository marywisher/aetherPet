/**
 * 文件名称：smtp-config.test.ts
 * 功能描述：SMTP 配置加载单测
 * 所属模块：tests/unit/auth
 */

import { describe, it, expect } from "vitest";
import { loadSmtpConfig, isSmtpConfigured } from "@/domain/auth/smtp-config";
import { _resetEnvCache } from "@/config/env";

describe("smtp-config（中心自治）", () => {
  it("默认配置：dry run 模式（本地开发）", () => {
    _resetEnvCache();
    const cfg = loadSmtpConfig();
    expect(cfg.dryRun).toBe(true);
    expect(cfg.host).toBeDefined();
  });

  it("isSmtpConfigured 在 dry run 下返回 false", () => {
    _resetEnvCache();
    const cfg = loadSmtpConfig();
    expect(isSmtpConfigured(cfg)).toBe(false);
  });

  it("有 host 且非 dry run 时 isSmtpConfigured 返回 true", () => {
    const fakeCfg = {
      host: "smtp.example.com",
      port: 587,
      user: "u",
      pass: "***",
      from: "from@example.com",
      secure: false,
      dryRun: false,
    };
    expect(isSmtpConfigured(fakeCfg as never)).toBe(true);
  });

  it("空 host 时 isSmtpConfigured 返回 false", () => {
    const fakeCfg = {
      host: "",
      port: 587,
      user: "",
      pass: "",
      from: "",
      secure: false,
      dryRun: false,
    };
    expect(isSmtpConfigured(fakeCfg as never)).toBe(false);
  });
});
