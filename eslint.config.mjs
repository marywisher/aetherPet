import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 测试代码豁免：mock 工厂/断言常需 any 边缘类型（如 vi.fn((...a: any[]) => ...)），
  // 无生产风险；生产代码 src/ 保持严格 no-explicit-any。
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 覆盖率产物（已 gitignore）
    "coverage/**",
  ]),
]);

export default eslintConfig;
