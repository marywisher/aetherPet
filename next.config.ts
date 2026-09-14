import type { NextConfig } from "next";

/**
 * 文件名称：next.config.ts
 * 功能描述：Next.js 配置
 * 修订：
 *   - P2-008（阶段 2）：outputFileTracingIncludes 把 /packs/* 路由的 fs trace
 *     收敛到 src/assets/packs/，防止 loader 里 fs.* 调用触发 whole-project trace
 *   - 阶段 6：output: "standalone"（自托管/宝塔 pm2 部署用）；
 *     * 通配把 migrations/*.sql 与素材包目录纳入 standalone 产物——
 *     它们由 runner/loader 在运行时按相对路径读取，缺了会启动失败或回退。
 * 说明：next.config.ts 不读取 process.env 之外的运行时状态。
 */

const nextConfig: NextConfig = {
  /* 阶段 6 部署：产出 .next/standalone 自包含服务器（PM2 / Docker 均可用） */
  output: "standalone",

  /* Next 16 开发态 Origin 安全校验（防 DNS rebinding）：
     默认只信任 localhost，用户从 http://127.0.0.1:30219 访问时
     HMR WebSocket 握手会因 Origin 不在允许列表被拒（ERR_INVALID_HTTP_RESPONSE，3 秒重连一次）。
     显式放行 127.0.0.1 与 localhost，保持开发体验。 */
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  /* 把运行时按路径读取的目录纳入 standalone trace（保持相对路径不变）：
     - src/domain/persistence/migrations/*.sql（migration runner 按
       process.cwd()/src/domain/persistence/migrations 读取）
     - src/assets/packs/**（素材包 loader 按 PROJECT_ROOT/src/assets/packs 读取） */
  outputFileTracingIncludes: {
    "*": [
      "src/domain/persistence/migrations/**/*.sql",
      "src/assets/packs/**/*",
    ],
    "/packs/*": ["src/assets/packs/**/*"],
  },
  /* P2-008 附加：把可执行代码外的噪音排除（.env / 日志不进入产物） */
  outputFileTracingExcludes: {
    "*": ["**/.env*", "**/*.log", "**/.DS_Store"],
  },
};

export default nextConfig;