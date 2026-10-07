# 前端代码规范（RedLark）

`deliver-frontend-react` 的实施细则。组件 / 样式 / 交互见 `ui-system-standard.md`；页面布局见 `page-layout-standard.md`；IPC 规则见 `../../deliver-contract-and-data/references/tauri-ipc-contract.md`。

## 1. 路由：类型化页面表

- 路由表唯一 owner：`src/navigation.ts`，定义 `RouteParams`（页面键 → 参数类型）、`PageKey`、`NavigateFn`。
- 所有页面的 `onNavigate` prop 类型为 `NavigateFn`；`App.tsx` 的 `switch` 对 `PageKey` 穷举（`default` 分支用 `never` 断言）。
- 新增页面 = 在 `RouteParams` 加键 → `App.tsx` 加 case → 页面文件。tsc 会指出所有遗漏。
- 不再使用 `(page: string, params?: any)`；不保留别名页面键（历史上的 `study` / `study-completion`）。
- 背景：2026-10 发现 `onNavigate('report')`、`onNavigate('practice')` 指向不存在的页面，被 `default` 静默送回首页。

## 2. Service

- 每个 `src/services/*Service.ts` 导出**一个模块级单例**（`export const xxxService = new XxxService()`）；组件不得 `new XxxService()`（每次渲染创建实例，且使 `useEffect` 依赖不稳定）。
- 页面/组件不直接 `invoke`，例外仅限 `api/client.ts`。
- 命令名字符串直接写在 service 方法内；`src/api/endpoints.ts` 已删除，不再新增端点常量表。

## 3. 大文件与拆分

触发条件（满足任一）：页面 > 600 行；一个文件内含多个独立 tab / 面板；同一组件同时负责拉数、表单状态和多个弹窗。

拆分方式：
- **按 tab / 面板拆组件**：`pages/settings/AIModelSettings.tsx` 等，父页面只保留 tab 切换与布局。
- **数据逻辑进 hook**：`useXxx()` 返回 `{ data, loading, error, actions }`，页面只做渲染；hook 放在页面同目录或 `src/hooks/`。
- 拆分批次**只移动不改写**：JSX、状态、回调原样迁移，props 显式传递；行为变更另起批次。
- 拆分后的子组件直接写 Tailwind 类，公共片段提成组件而不是复制类名串。

## 4. 日志与类型

- `console.log` / `console.info` / `console.debug`：禁止（ESLint `no-console` 为 **error**，仅允许 `warn` / `error`；DevTools 接管 console 处用带理由的 `eslint-disable-next-line`）。调试用 DevTools 断点。
- `console.error` 只用于 catch 中无法交给 UI 的异常；能交给 UI 的走 Toast / 错误态。
- `any`：禁止（`@typescript-eslint/no-explicit-any` 为 **error**，2026-10-06 存量已清零）。无法表达的类型用 `unknown` + 收窄；读后端数据用与 Rust serde 一致的类型，**不要用 `as any` 绕过字段名不一致**。

## 5. Lint 棘轮

- 配置：`eslint.config.js`（flat config，typescript-eslint）。
- 基线：`.eslint-baseline.json` 记录各规则警告数；`node scripts/lint-ratchet.mjs` 在任何规则计数**增加**时失败，减少时提示 `--update` 收紧基线。
- error 级规则必须为 0；warning 级规则受棘轮约束（当前基线为空：所有 warning 均已清零）。
- 批次结束运行 `node scripts/lint-ratchet.mjs`；清理了警告就 `--update` 提交新基线。

## 6. 测试

- 运行器：Node 内置 `node --test`（零依赖），`npm test` 已指向它；`scripts/test-resolve-hook.mjs` 让测试可以导入项目里不带扩展名的模块。
- 测试文件：`src/**/*.test.ts`，与被测文件同目录。
- 测试文件被 `tsconfig.json` 排除（项目不装 `@types/node`），由 Node 剥离类型后直接运行；因此测试只做简单断言，被测代码本身仍受 tsc 检查。被测模块应是纯函数模块，不导入 `@tauri-apps/api`，模块内导入用相对路径（resolve hook 不解析 `@/` 别名）（例如错误解析放在 `api/errors.ts` 而不是 `api/client.ts`）。
- 适合测试：`utils/`、`types/study.ts` 的状态转换函数、`navigation.ts`、`api/client.ts` 的错误解析（纯函数部分）。
- 不在 node 测试中渲染 React 组件（无 DOM 环境）；组件行为靠 `tauri:dev` 走查。
