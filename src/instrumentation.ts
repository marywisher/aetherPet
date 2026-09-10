/**
 * 文件名称：instrumentation.ts
 * 功能描述：Next.js 启动钩子（Node.js runtime）
 * 所属模块：lib
 * 说明：
 *   - Next.js 14+ 官方推荐的启动初始化入口
 *   - 只在服务端触发（next dev / next start）
 *   - 只做异步初始化，不阻塞请求
 */

import { startup } from "@/lib/startup";

export async function register(): Promise<void> {
  // 只在 Node.js runtime 执行（非 Edge）
  if (typeof window !== "undefined") return;
  // 静默执行，不阻塞 register 返回
  void startup();
}

export const config = {
  runtime: "nodejs",
};
