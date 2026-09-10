/**
 * 文件名称：setup.ts
 * 功能描述：Vitest 全局 setup
 * 所属模块：tests
 */

// 提供测试环境变量（覆盖 .env）
process.env.SMTP_DRY_RUN = "true";
process.env.DB_AUTO_MIGRATE = "false";
process.env.HUB_ID = "test-hub";
process.env.HUB_DISPLAY_NAME = "Test Hub";
process.env.HUB_ADMIN_EMAIL = "admin@test.local";
process.env.HUB_PRIVACY_URL = "https://test.local/privacy";

// 防止启动时真正初始化 pool（单元测试不连真 DB）
process.env.DB_HOST = "127.0.0.1";
