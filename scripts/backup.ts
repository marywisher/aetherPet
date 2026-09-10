/**
 * 文件名称：backup.ts
 * 功能描述：数据库备份脚本（mysqldump 包装）——数据主权之外的运维备份
 * 所属模块：scripts
 * 用法：
 *   node scripts/backup.ts                    # 备份到 data/backups/aetherpet-YYYY-MM-DD.sql.gz
 *   DB_PASS=xxx node scripts/backup.ts        # 密码可用进程 env 覆盖（也支持 .env）
 * 说明：
 *   - 使用系统 mysqldump --single-transaction（InnoDB 一致性快照，不锁表）
 *   - 输出 gzip 压缩；定期验证：zcat data/backups/aetherpet-<date>.sql.gz | head -5
 *   - 官方托管（宝塔）建议直接用宝塔面板自带的定时备份任务（零代码），本脚本供
 *     自托管/CI 使用
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";

// ---- 轻量 .env 加载（不引入 dotenv 依赖；mysql2 之外保持最小依赖面） ----
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, "..");
try {
  const envFile = await fs.readFile(path.join(projectRoot, ".env"), "utf-8");
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    // 进程 env 优先（不覆盖显式传入的变量）
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
} catch {
  /* 无 .env 时静默，使用 env.ts 默认值 */
}

const { getEnv } = await import("../src/config/env");
const env = getEnv();

const OUT_DIR = path.join(projectRoot, "data", "backups");

function dayStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `aetherpet-${dayStr(new Date())}.sql.gz`);

  // P3-002：预检外部二进制（mysqldump / gzip），缺失时给出可操作提示而非挂起
  for (const bin of ["mysqldump", "gzip"]) {
    const ok = await new Promise<boolean>((resolve) => {
      const probe = spawn(bin, ["--version"], { stdio: "ignore" });
      probe.on("error", () => resolve(false));
      probe.on("close", () => resolve(true));
    });
    if (!ok) {
      console.error(`[backup] 未找到 ${bin}，请先安装：apt install ${bin === "mysqldump" ? "default-mysql-client" : "gzip"} 或使用宝塔数据库备份。`);
      process.exit(1);
    }
  }

  const dump = spawn(
    "mysqldump",
    [
      `--host=${env.DB_HOST}`,
      `--port=${String(env.DB_PORT)}`,
      `--user=${env.DB_USER}`,
      `--password=${env.DB_PASS}`,
      "--single-transaction",
      "--quick",
      "--routines",
      env.DB_NAME,
    ],
    { stdio: ["ignore", "pipe", "inherit"] }
  );
  const gz = spawn("gzip", ["-9"], { stdio: ["pipe", "pipe", "inherit"] });
  dump.stdout.pipe(gz.stdin);
  const outStream = createWriteStream(outFile);
  gz.stdout.pipe(outStream);

  const dumpExit = await new Promise<number>((resolve) => dump.on("close", resolve));
  if (dumpExit !== 0) {
    outStream.destroy();
    console.error(`[backup] mysqldump 失败（exit ${dumpExit}），未生成备份`);
    process.exit(1);
  }
  gz.stdin.end();
  const gzExit = await new Promise<number>((resolve) => gz.on("close", resolve));
  if (gzExit !== 0) {
    outStream.destroy();
    console.error(`[backup] gzip 失败（exit ${gzExit}）`);
    process.exit(1);
  }
  const stat = await fs.stat(outFile);
  console.log(`[backup] ✅ ${outFile} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error("[backup] 失败:", err);
  process.exit(1);
});