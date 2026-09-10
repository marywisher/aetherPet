/**
 * 文件名称：smtp-config.ts
 * 功能描述：SMTP 配置加载（中心自治）
 * 所属模块：domain/auth
 * 说明：
 *   - 从 env 读取 SMTP_* 变量
 *   - 支持 dry run 模式（本地无 SMTP 也能跑）
 *   - 领域层纯 TS，可独立单测
 */

import { getEnv } from "@/config/env";
import type { SmtpConfig } from "../types";

/** 加载 SMTP 配置 */
export function loadSmtpConfig(): SmtpConfig {
  const env = getEnv();
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
    secure: env.SMTP_SECURE,
    dryRun: env.SMTP_DRY_RUN,
  };
}

/** SMTP 是否可用（有 host 且非 dry run） */
export function isSmtpConfigured(config: SmtpConfig = loadSmtpConfig()): boolean {
  return config.host.length > 0 && !config.dryRun;
}
