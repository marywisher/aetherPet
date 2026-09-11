/**
 * 文件名称：dev-filter.mjs
 * 功能描述：过滤 `next dev` 输出里的 Edge Runtime 分析噪音，让 dev-server.log / 终端更清爽
 * 所属模块：scripts
 * 用法：
 *   npm run dev:quiet
 *   （等价于 next dev 2>&1 | node scripts/dev-filter.mjs）
 * 说明：
 *   - Next.js 16 + Turbopack 在开发模式会对 instrumentation.ts 链路（startup → logger /
 *     migrations runner）做一次 Edge Runtime 静态分析，Node.js-only 的 import（fs/path/crypto）
 *     会触发一批 "Warning: A Node.js module is loaded ... not supported in the Edge Runtime"
 *     警告 + 高亮代码片段 + "Ecmascript file had an error" + Import trace。
 *   - 这些是**分析噪音，不是真错误**：不影响 healthz / 验证码 / DB 连接等功能。
 *   - 本过滤器按行丢弃这些噪音块，保留：启动日志、migration、[INFO]、[mail:dry-run]、
 *     请求日志（GET/POST ... 200）、以及 package-lock/turbopack.root 等有用 ⚠ 提示。
 *   - 保守策略：只丢弃"明确属于警告块"的行；无法确定的行一律保留（宁可多留不误删）。
 */

// 命中任意一条即视为"警告块内的噪音行"，丢弃
const NOISE = [
  // 警告块的文件头：⚠ ./src/...:line:col （区别于有用的 "⚠ Warning: Next.js ignored..."）
  /^⚠ \.\//,
  // 警告正文
  /Warning: A Node\.js (module|API)/,
  // Learn more / Learn More（仅这两条 edge-runtime 链接）
  /^\s*Learn (More|more): https:\/\/nextjs\.org\/docs\/(messages\/node-module-in-edge-runtime|api-reference\/edge-runtime)/,
  // 解析中止提示
  /^Ecmascript file had an error/,
  // Import trace 块
  /^Import trace:/,
  /^\s*Edge Instrumentation:/,
  /^\s*\.\//,
  // 高亮代码片段（含 ANSI 转义 ESC 字节的行；正常请求/启动日志都是纯文本，不含 ESC）
  /\u001b/,
];

// 连续的多个空行压缩成至多 1 个（警告块之间会产生大片空行）
let lastBlank = false;

function isNoise(line) {
  return NOISE.some((re) => re.test(line));
}

function emit(line) {
  // 空行压缩：若上一行已是空行且本行也是空行，则跳过
  const isEmpty = line.trim() === "";
  if (isEmpty && lastBlank) return;
  lastBlank = isEmpty;
  process.stdout.write(line + "\n");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (isNoise(line)) continue;
    emit(line);
  }
});
process.stdin.on("end", () => {
  if (buf) {
    if (!isNoise(buf)) emit(buf);
  }
});
