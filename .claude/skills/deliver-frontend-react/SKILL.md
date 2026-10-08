---
name: deliver-frontend-react
description: "前端实现（React / TypeScript / Vite / shadcn/ui + Tailwind CSS v4）：修改 src/ 的 pages、components（含 components/ui 原语）、services、hooks、types、utils、styles 或 App.tsx 路由，或做 UI 统一 / shadcn 接入与迁移时使用，由 sdd-implement 调度，或用户明确要求前端实现时直接进入。负责页面、组件、状态、与 Tauri 命令的接线和交互反馈；纯跨层类型/命令一致性归 deliver-contract-and-data。Keywords: frontend, UI, page, component, React, shadcn, Tailwind, hook, 页面, 组件, 前端, 样式."
---

# Deliver Frontend React

本 Skill 是前端实现能力，不是顶层开发流程。它在 `src/` 这一面完成一个连贯批次。目录、路由机制和代码风格以 `CLAUDE.md` §5、§7.3 为准，本文只写实施要点。

## 参考基线

- 任何前端批次都先读 `references/frontend-code-standard.md`（路由类型、service 单例、拆分规则、日志/any、lint 棘轮、测试）。
- 涉及组件、样式、交互、图标，或做 shadcn 接入 / 迁移时读 `references/ui-system-standard.md`（先按其 §0 判断接入状态）。
- 新建或改版页面、设计流程 / 交互、决定组件怎么组合时读 `references/ui-interaction-patterns.md`：先找对应场景的 shadcn Block / Example，照其组合与布局实现，不自行发明交互。
- 新建或重构页面、调整布局时读 `references/page-layout-standard.md`。
- 新增/修改对 Tauri 命令的调用时读 `../deliver-contract-and-data/references/tauri-ipc-contract.md`。
- 解析、展示时间或使用“今天”时读 `../deliver-contract-and-data/references/time-and-timezone.md`：一律经 `src/utils/datetime.ts` 与 `useToday()`（ESLint 强制）。

## 输入

- 当前批次目标与 `plan.md` 中的交互 / contract / 验收要求
- 涉及的页面、组件、service、hook、类型文件

## 负责什么

- 在前端面完成一个连贯批次
- 明确 `page → component → hook → service → types` 的 owner
- 给出前端面最小必要验证建议

## 不负责什么

- 重新翻译 spec / plan
- 趁机改造整个页面体系，或引入路由库 / 状态库 / shadcn 以外的 UI 库
- 在功能批次里顺手迁移无关组件（迁移按页面另起批次）
- 直接吞掉 contract 层的问题（字段名对不上先回 contract owner）

## 实施规则

**路由与页面**
- 页面切换只走 `App.tsx` 的 `switch` + `onNavigate`，路由参数由 `src/navigation.ts` 的 `RouteParams` 定型（规范 §1）；新增页面 = `RouteParams` 加键 + App case + 页面文件。
- 页面结构：由 `AppShell`（侧边栏 + 顶栏面包屑）包裹，页面只渲染内容区：`PageHeader` + 主区（max-width 1400px）；专注模式页面列入 `FOCUS_PAGES`。见 `references/page-layout-standard.md`。

**数据与状态**
- 所有后端调用经 `src/services/*Service.ts` 的模块级单例（继承 `BaseService`）；页面/组件不直接 `invoke`，也不 `new XxxService()`。
- 调用结果必须判 `result.success`；失败走 Toast / 错误态，不 `try/catch` 吞掉，不把失败渲染成空列表。
- 状态只用 React Hooks（`useState`/`useEffect`/自定义 hooks）；可复用的异步拉取用 `useAsyncData`。
- 不用 `console.log/info/debug` 与 `any`（ESLint error，规范 §4–§5）。后端看不到的错误（自己接住的异常、降级）用 `apiClient.log` 写进应用日志，规范见 `docs/LOGGING.md`；普通操作不用记，后端已有。

**类型**
- 字段名以 Rust serde 实际输出为准（默认 snake_case；`types/tts.rs` 等有 `rename_all = "camelCase"`）；不自己“顺手”改成 camelCase。
- 不用 `any` 规避类型不匹配；对不上说明 contract 有问题，回 `deliver-contract-and-data`。

**组件与样式**（细则 `references/ui-system-standard.md`）
- UI 体系唯一选择是 shadcn/ui + Tailwind v4：原语在 `src/components/ui/`（`npx shadcn@latest add` 生成），业务组件组合原语，类名合并用 `cn()`，导入用 `@/` 别名。
- 样式只写 Tailwind 类；全局样式只在 `src/styles/app.css`；不新建 `.module.css` 或全局 CSS 变量体系。
- 颜色只用语义 token 类（`bg-primary`、`text-muted-foreground` …）；禁止硬编码色值、Tailwind 原始色板、`!important` 覆盖。主题仍由 `useTheme` 写 `data-theme`，`dark:` 经 `@custom-variant` 跟随。
- 交互统一：按钮 `Button`、弹窗 `Dialog`、危险确认 `AlertDialog`、反馈 `useToast()`（底层 sonner）、表单 `Form`（react-hook-form + zod）、菜单 `DropdownMenu`、图标 `lucide-react`；不写原生 `button/input/select/textarea`，不自写遮罩层。
- 设置类页面用 `components/SettingsLayout`（SettingsPanel / SettingsSection / SettingsRow）。
- 最小窗口 1200×800 必须不溢出；窄屏适配用 `max-md:` / `max-sm:`。

**交互模式**（细则 `references/ui-interaction-patterns.md`）
- 模式来源按优先级：shadcn Blocks / Examples / 组件文档示例 → WAI-ARIA 行为规范 → 桌面平台惯例；都没有才自定义，并在批次说明中写明查过的来源与偏离理由。
- RedLark 是桌面 app：网页向的 Block / Example 按 `ui-interaction-patterns.md` §5 改成桌面形态（外壳铺满窗口只滚内容区、不用 `<a href>` 跳转、默认指针、界面文字不可选、平台快捷键、右键菜单、界面状态持久）。
- 页面由多个场景组成时逐个对应模式表（列表 + 筛选 + 批量 + 侧栏详情…），不混出新形态；浮层按“Dialog / AlertDialog / Sheet / Popover / DropdownMenu / Tooltip”选择表使用，不嵌套 Dialog。

**状态显示**
- 学习计划状态的文案、颜色、可用操作统一用 `src/types/study.ts` 的 `getStatusDisplay` / `getAvailableActions` / `canTransitionTo`，不在页面里重新 switch。

## 默认执行方式

1. 确认当前批次只覆盖哪个页面 / 组件 / 状态面。
2. 自下而上：types → service → hook/component → page → App.tsx。
3. 记录联动面：调用的命令与参数 / 类型 / 交互三态。
4. 把最窄验证建议交给 `sdd-verify`：`npm run type-check`、`node scripts/lint-ratchet.mjs`、`python3 scripts/check-css-vars.py`、相关 `npm test` + `tauri:dev` 走查项（UI 改动需亮 / 暗两种主题）。

## 完成条件

- 当前前端批次已完成；除 shadcn 接入批次外未引入新的全局依赖
- 新增 / 迁移的 UI 符合 `ui-system-standard.md`（无硬编码色、无原生控件、亮 / 暗主题走查过），交互与布局能指出所采用的模式（`ui-interaction-patterns.md` 场景行或 shadcn Block / Example），偏离已记录理由
- 改版 / 重做批次有改版前的功能清单，且逐条核对过（`ui-system-standard.md` §6）；没有未经用户同意的功能删减；遵循桌面应用约定（`ui-interaction-patterns.md` §5）
- 页面、状态和命令联动面已说明
- 前端验证入口清楚
