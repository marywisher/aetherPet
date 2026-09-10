import { z } from "zod";

/**
 * 文件名称：env.ts
 * 功能描述：环境变量统一校验与解析（zod schema）
 * 所属模块：config
 * 说明：
 *   - 单点定义：所有 env 从这里读，业务代码不再直接访问 process.env
 *   - Server-only：本文件只在服务端使用，不能从客户端 import（会暴露密钥）
 *   - 启动即校验：应用启动时立刻 assertEnv()，避免运行期才发现配置缺失
 */

const bool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => (typeof v === "boolean" ? v : ["true", "1"].includes(v)));

export const envSchema = z.object({
  // ============== 数据库 ==============
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default("aetherpet"),
  DB_PASS: z.string().default("aetherpet"),
  DB_NAME: z.string().min(1).default("aetherpet"),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DB_AUTO_MIGRATE: bool.default(true),

  // ============== 认证 ==============
  TOKEN_TTL_MS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60 * 1000),
  VERIFICATION_CODE_TTL_MS: z.coerce.number().int().positive().default(600_000),
  VERIFICATION_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  VERIFICATION_MAX_PER_WINDOW: z.coerce.number().int().positive().default(3),
  IP_RATE_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  IP_RATE_MAX_PER_WINDOW: z.coerce.number().int().positive().default(30),
  // /api/auth/verify 独立节流桶（防止 6 位验证码枚举），可另调更严格
  VERIFY_IP_RATE_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  VERIFY_IP_RATE_MAX_PER_WINDOW: z.coerce.number().int().positive().default(30),
  // 验证码校验失败次数上限（单 email 累计，内存计数，进程重启后清零）
  VERIFY_MAX_ATTEMPTS_PER_EMAIL: z.coerce.number().int().positive().default(10),

  // ============== SMTP（中心自治） ==============
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default("aetherpet@example.com"),
  SMTP_SECURE: bool.default(false),
  SMTP_DRY_RUN: bool.default(true), // 开发默认 true，仅 console.log

  // ============== 中心身份（hub-autonomous email） ==============
  HUB_ID: z.string().min(1).default("local"),
  HUB_DISPLAY_NAME: z.string().min(1).default("aetherPet Local"),
  HUB_ADMIN_EMAIL: z.string().default("admin@example.com"),
  HUB_PRIVACY_URL: z.string().default("https://example.com/privacy"),
  HUB_DOMAIN: z.string().default(""),

  // ============== 素材包 ==============
  ASSET_PACKS_DIR: z.string().default("./src/assets/packs"),
  DEFAULT_PACK: z.string().default("default"),

  // ============== 运行时 ==============
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 是否信任上游反代注入的 X-Forwarded-For / X-Real-Ip。
  // 默认 false：直接取 req.socket.remoteAddress，拒绝客户端伪造。
  // 部署在可信反代后（宝塔/Nginx/Caddy 且已配置 proxy_set_header）才置 true。
  TRUST_PROXY: bool.default(false),
  // 反代信任跳数（从右往左，对应 X-Forwarded-For 里的段数）
  PROXY_TRUST_HOPS: z.coerce.number().int().positive().default(1),
  // 是否开启开发端点白名单（Round 2 修复 P2-013）。
  // 生产模式下 /api/pet/generate-event 默认禁用；仅当此字段显式为 true 才允许开启。
  // 典型用途：内网演示 / staging 环境需要手动触发生成器调试。
  // 警告：本项只影响 /api/pet/generate-event 一个端点，不会放宽其他端点。
  ENABLE_DEV_ENDPOINTS: bool.default(false),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/** 读取并缓存环境变量（首次调用时校验） */
export function getEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[env] 环境变量校验失败：\n${msg}`);
  }
  _env = parsed.data;
  return _env;
}

/** 显式校验（用于启动脚本 / 健康检查） */
export function assertEnv(): Env {
  return getEnv();
}

/** 供测试重置缓存 */
export function _resetEnvCache(): void {
  _env = null;
}
