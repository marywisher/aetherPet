import type { NextConfig } from "next";

/**
 * 文件名称：next.config.ts
 * 功能描述：Next.js 配置（P2-008：显式界定素材包 trace 范围）
 * 修订：Round 2 P2-008 —— 通过 outputFileTracingIncludes 把 /packs/* 路由
 *   的文件系统 trace 收敛到 src/assets/packs/，防止因 loader 里 fs.* 调用
 *   触发 "whole project traced" 告警（阶段 6 standalone 部署体积膨胀风险）。
 */

const nextConfig: NextConfig = {
  /* 让 standalone 产物只打包 src/assets/packs 而非整个 src/ */
  outputFileTracingIncludes: {
    "/packs/*": ["src/assets/packs/**/*"],
  },
  /* P2-008 附加：把 src/ 其它目录显式排除（若 trace 试图外扩） */
  outputFileTracingExcludes: {
    "/packs/*": [
      // 排除 node_modules 里的调试信息、.env、临时文件
      "**/.env*",
      "**/*.log",
    ],
  },
};

export default nextConfig;
