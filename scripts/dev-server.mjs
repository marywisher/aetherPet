/**
 * 文件名称：dev-server.mjs
 * 功能描述：开发服务器启动器（运行端口只改 .env 一处）
 * 所属模块：scripts
 * 背景：
 *   - Next.js 内置 dotenv 在「端口解析之后」才加载 .env，因此 `.env` 里的 PORT 不会被 next dev 消费，
 *     直接 `npm run dev` 永远 3000。
 *   - 本启动器先用 @next/env 加载 .env，再把 PORT 以 `-p` 显式传给 next dev，
 *     实现「npm run dev / 启动服务.bat / 任意入口」统一读 .env 的 PORT。
 * 用法：package.json `"dev": "node scripts/dev-server.mjs"`（等价于 next dev，可后接 next 参数）
 */
import { spawn } from "node:child_process";
import envPkg from "@next/env";

const { loadEnvConfig } = envPkg;
loadEnvConfig(process.cwd(), false);
const port = process.env.PORT || "3000";

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", port, ...process.argv.slice(2)],
  { stdio: "inherit" }
);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("[dev-server] 启动失败:", err);
  process.exit(1);
});