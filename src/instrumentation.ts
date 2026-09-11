/**
 * 文件名称：instrumentation.ts
 * 功能描述：Next.js 启动钩子（仅 Node.js runtime 生效）
 * 所属模块：lib
 * 说明：
 *   - Next.js 14+ 官方推荐的启动初始化入口
 *   - instrumentation.ts 会被同时编译为 Node.js 与 Edge 两个版本，
 *     因此**必须**用 process.env.NEXT_RUNTIME 做条件 + 动态 import：
 *     静态 import 会把 startup → migration runner（fs / process.cwd / mysql2）
 *     整条链拖进 Edge bundle，触发
 *     "A Node.js API is used (process.cwd ...) which is not supported in the Edge Runtime"。
 *   - 参考：docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 *     § Specifying the runtime
 *   - 只做异步初始化，不阻塞 register 返回
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 动态 import：仅在 Node.js runtime 才会真正加载依赖 Node API 的模块
    const { startup } = await import("@/lib/startup");
    // 静默执行，不阻塞 register 返回
    void startup();
  }
}
