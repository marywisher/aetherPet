/**
 * AetherPet · PM2 进程守护配置（宝塔/自托管路径 a）
 *
 * 用法：
 *   1) npm run build            # 产出 .next/standalone
 *   2) 配置 .env（见 SELF_HOST.md）
 *   3) pm2 start pm2-ecosystem.config.js
 *   4) pm2 save && pm2 startup  # 开机自启
 *   5) 宝塔面板：站点 → 反向代理 → 目标 http://127.0.0.1:3000
 *
 * 说明：
 *   - 用 standalone server（.next/standalone/server.js），不经过 next start，
 *     内存占用与启动速度更优，且不依赖源码目录
 *   - 环境变量从 .env 读取（dotenv 在 PM2 下默认注入 cwd/.env）
 *   - cluster 模式注意：进程内缓存（素材包、连接池、内存节流）各自独立，
 *     MVP 建议 instances:1 避免竞态（DB 条件幂等已兜底，仍建议单实例）
 */
module.exports = {
  apps: [
    {
      name: "aetherpet-web",
      cwd: __dirname,
      script: ".next/standalone/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      // 日志按日拆分（PM2 管理，与应用内 logs/ 并存）
      out_file: "logs/pm2-out.log",
      error_file: "logs/pm2-error.log",
      merge_logs: true,
      time: true,
      // 启动失败自动重启（最多 5 次，之后进入 errored 状态便于排查）
      max_restarts: 5,
      min_uptime: "10s",
    },
  ],
};