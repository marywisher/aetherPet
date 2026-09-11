/**
 * 文件名称：setup.ts
 * 功能描述：Vitest 全局 setup
 * 所属模块：tests
 */

// 集成测试模式下先加载项目根 .env（获取真实 DB 凭证等）
// - 单测默认不加载，保持确定性
// - 显式 INTEGRATION_DB=1 时才加载，让 integration tests 走真实 MySQL
// - 放在文件最顶部：@next/env 用 dotenv 语义，不覆盖已存在的 process.env 值，
//   所以后续「测试环境变量」仍能覆盖 .env 里的同名字段（DB_HOST / SMTP_DRY_RUN / HUB_*）
if (process.env.INTEGRATION_DB === "1") {
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(process.cwd(), false);
}

// 提供测试环境变量（覆盖 .env）
process.env.SMTP_DRY_RUN = "true";
process.env.DB_AUTO_MIGRATE = "false";
process.env.HUB_ID = "test-hub";
process.env.HUB_DISPLAY_NAME = "Test Hub";
process.env.HUB_ADMIN_EMAIL = "admin@test.local";
process.env.HUB_PRIVACY_URL = "https://test.local/privacy";

// 防止启动时真正初始化 pool（单元测试不连真 DB）
process.env.DB_HOST = "127.0.0.1";
