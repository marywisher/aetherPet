# Step 3 · 自证测试报告（链路专项）

> 审计时间：2026-09-12
> 目标：为本次修复中最复杂/最关键的新逻辑（`runSyncOnce` 并发去重 + 失败静默 + 透传）生成并运行单元测试

## 3a. 识别核心函数

| 候选 | 复杂度 | 理由 |
|------|--------|------|
| `runSyncOnce()`（`src/lib/sync-client.ts`） | 中 | 模块级 in-flight 状态机（去重/清空）、fetch 网络层、响应解析、失败静默——修复链路的核心 |
| 首页 load() 的 dailyGrant 三分支消费 | 中 | UI 状态机；因无组件测试基建，以代码推演（Step 2）兜底 |

## 3b. 测试文件与用例

`tests/unit/lib/sync-client.test.ts`（新增）

| # | 用例 | 类型 | 验证点 |
|---|------|------|--------|
| 1 | 成功且 granted 时透传 dailyGrant | 正常路径 | 2xx + dailyGrant 字段 → 原样返回；URL/选项正确 |
| 2 | 非 2xx（401）→ null 静默 | 异常路径 | 不抛异常,返回 null |
| 3 | 网络异常 → null 静默 | 异常路径 | reject → null |
| 4 | 响应缺 dailyGrant 字段 → `{ dailyGrant: null }` | 边界条件 | 缺字段不崩 |
| 5 | 并发调用只发一次请求 | 状态并发 | in-flight 去重:两次调用 1 次 fetch |
| 6 | 完成后可再次发起 | 状态恢复 | finally 清空 in-flight:两次串行 2 次 fetch |

实现要点：每个用例 `vi.resetModules()` + 动态 `import()` 重新加载模块，隔离模块级 in-flight 状态；`vi.stubGlobal("fetch", …)` 模拟网络层，`afterEach` 还原。

## 3c. 运行结果

```
Test Files  1 passed (1)
      Tests  6 passed (6)
```

全量回归：**524 passed | 8 skipped（532）**；`tsc --noEmit` 0 错误；`npm run build` 成功。

## 3d. 未覆盖说明

- 页面级 UI 渲染（欢迎卡显示/隐藏、开发工具区隐藏）：项目暂无 jsdom/testing-library 基建；以 Step 2 代码推演 + 生产构建 + 用户浏览器验收兜底
- sync 服务端行为（grantDailyItem 等）：既有领域层单测 + 真库集成测试已覆盖，不在本次新增范围

## 结论

新逻辑自证通过：并发去重、失败静默、透传语义全部有测试断言；无弱断言用例。可交付。