# UI 体系标准：shadcn/ui（RedLark）

`deliver-frontend-react` 的组件 / 样式 / 交互规范。2026-10-07 选定 **shadcn/ui（Radix 底层）+ Tailwind CSS v4** 为前端唯一 UI 体系；同日全部页面迁移完成，CSS Modules、`globals.css`、自写基础组件与 FontAwesome 已移除。页面骨架见 `page-layout-standard.md`；场景该用什么组合与布局见 `ui-interaction-patterns.md`。

## 0. 现状与 CLI 注意事项

- 已接入且迁移完成：按 §1–§5 执行。页面默认由 `AppShell`（侧边栏 + 顶栏面包屑）包裹，页面只渲染内容区；需要整窗专注框架的页面（单词练习）列入 `navigation.ts` 的 `FOCUS_PAGES`。
- 不得再新建 `.module.css`、全局 CSS 变量体系或自写基础组件；样式只写 Tailwind 类，全局样式只在 `src/styles/app.css`。
- shadcn CLI 已知问题：生成文件可能写成 `from "cn"` 并安装名为 `cn` 的无关包、或向 `app.css` 追加 `.dark {}` 块——生成后检查并改回 `@/lib/utils`、删掉 `.dark` 块。

## 1. 分层与目录

| 层 | 位置 | 规则 |
| --- | --- | --- |
| UI 原语 | `src/components/ui/<name>.tsx` | 只由 `npx shadcn@latest add <name>` 生成，文件名 kebab-case（shadcn 约定，是“一目录一组件 PascalCase”的唯一例外）。可改样式与变体，**不放业务逻辑、不调 service**。 |
| 工具 | `src/lib/utils.ts` | `cn()`（clsx + tailwind-merge），合并类名只用它。 |
| 业务组件 | `src/components/<Name>/<Name>.tsx` | 组合 `ui/` 原语 + 业务数据；named export、props 带 JSDoc。常用页面级组件：`PageHeader`、`MetricCard`、`EmptyState`、`SettingsLayout`。 |
| 页面 | `src/pages/<Xxx>Page.tsx` | 只组合业务组件与 `ui/` 原语，布局用 Tailwind。 |

- 导入一律用别名：`import { Button } from '@/components/ui/button'`、`import { cn } from '@/lib/utils'`。
- 需要新原语时**先查 shadcn 是否已有**（ui.shadcn.com/docs/components，AI 可读 `https://ui.shadcn.com/llms.txt`），有就 `add`，没有才在 `ui/` 里按 shadcn 写法（Radix primitive + `cva` + `cn`）自建。
- 不引入第二套组件库（MUI / Antd / Mantine / Chakra 等），也不直接从 `@radix-ui/*` 在业务组件里拼原语——先包进 `ui/`。

## 2. 样式规则（Tailwind）

- **只用语义 token 类**：`bg-background` `text-foreground` `bg-primary text-primary-foreground` `bg-muted` `text-muted-foreground` `border-border` `bg-card` `bg-destructive` `ring-ring`，以及 §3 中补充的业务 token（如 `bg-success`）。
- **禁止**：硬编码色值（`bg-[#4ECDC4]`、`text-[rgb(...)]`、`style={{ color: '#..' }}`）；Tailwind 原始色板（`bg-gray-50`、`text-blue-600`）——它们不跟随主题；`!important` / `!` 前缀覆盖原语样式（改原语的 variant 或传 `className`）。
- 间距、圆角、字号用 Tailwind 刻度（`p-4` `gap-2` `rounded-lg` `text-sm`）；任意值 `[...]` 只用于确实无刻度的尺寸（如 `max-w-[1400px]`），不用于颜色。
- 条件类名用 `cn(base, cond && 'x', className)`，不拼模板字符串。
- 响应式：Tailwind 默认是移动优先的 `min-width` 断点；本项目最小窗口 1200×800，桌面布局写成默认样式，窄屏适配用 `max-md:`（<768px）、`max-sm:`（<640px）。

## 3. 主题与 token

- 主题 owner 仍是 `useTheme`：写 `document.documentElement[data-theme=light|dark]` + localStorage。**不改用 `.dark` 类，不引入 next-themes。**
- Tailwind 入口 CSS 是 `src/styles/app.css`（唯一全局样式文件），其中声明：
  ```css
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
  ```
  使 `dark:` 与 shadcn 原语跟随 `data-theme`。
- shadcn token（`--background` `--foreground` `--primary` `--radius` …）在 `:root` 与 `[data-theme='dark']` 各定义一次，取值**沿用现有品牌色**（主色 `#4ECDC4` 系、儿童学习风格），并经 `@theme inline { --color-primary: var(--primary); … }` 暴露给 Tailwind。
- 业务语义色（成功 / 警告 / 学习状态等）作为新 token 加在同一处（如 `--success` → `--color-success`），不要在组件里挑原始色板。
- `python3 scripts/check-css-vars.py` 检查 `var(--x)` 都有定义（含 `style={{}}` 中的引用）。

## 4. 交互规范（统一行为）

| 场景 | 用法 | 不再使用 |
| --- | --- | --- |
| 按钮 | `Button`（variant：default / secondary / outline / ghost / destructive / link；size：sm / default / lg / icon）；加载中 `disabled` + 旋转图标 | 原生 `<button>`（列表行 / 导航项等需要整行可点时除外，须带 focus-visible 样式） |
| 弹窗 / 表单弹窗 | `Dialog` | 自写遮罩层 |
| 危险操作确认 | `AlertDialog`（确认按钮 `variant="destructive"`） | `window.confirm` |
| 操作结果反馈 | `useToast()`（`components/Toast/ToastContainer`，底层是 shadcn sonner）：`showSuccess / showError(title, result.error)`；返回值引用稳定，可放进依赖数组 | `alert()`、自写浮层 |
| 输入 | `Input` `Textarea` `Select` `Checkbox` `Switch` `RadioGroup` `ToggleGroup`（分段选择）`Slider` + `Label` | 原生 `input/select/textarea` |
| 表单（≥3 字段或有校验） | shadcn `Form`（react-hook-form + zod），错误显示在字段下 | 手写 `useState` 逐字段校验 |
| 菜单 / 更多操作 | `DropdownMenu` | 自写绝对定位菜单 |
| 提示 | `Tooltip`（图标按钮必须有 tooltip 或 `aria-label`） | `title` 属性当说明 |
| 选项卡 | `Tabs` | 自写 tab 状态 + 样式 |
| 状态标签 | `Badge`（学习计划状态的文案/颜色仍取 `getStatusDisplay`） | 自带配色的标签组件 |
| 加载 | 列表/卡片区用 `Skeleton`；整块阻塞用 spinner | 加载时清空页面结构 |
| 侧栏面板 | `Sheet` | 自写滑出层 |

- 键盘与焦点由 Radix 负责：不要给原语再包 `onKeyDown` 去模拟 Esc / Tab；`asChild` 组合时子元素必须能接收 ref。
- 三态同构、错误态显示 `result.error` 的规则不变（`page-layout-standard.md`）。

## 5. 图标

- 只用 `lucide-react`（shadcn 默认图标库，原语内部也用它）：`<Trash2 className="size-4" />`；需要以 prop 传图标时类型用 `LucideIcon`。不引入第二套图标库。

## 6. 功能对等（改版 / 重做时的硬约束）

换外观、换布局、重做交互时不得丢功能。动手前从代码盘点该页面 / 组件的功能清单（全部操作、弹窗与表单字段、筛选 / 排序 / 分页、快捷键、加载 / 空 / 错误态、进度与轮询、音频、跳转及参数），写进批次说明；完成后逐条在 `tauri:dev` 中核对。合并、删除或改变任何一项功能都要用户明确同意并记录在 work item。2026-10 迁移期的清单见 `.claude/work/ui-shadcn-migration/feature-inventory.md`。

- 每批“只改样式与控件，不改业务行为”，行为变更另起批次。
- 收口 gate（待做）：在 `eslint.config.js` 为 `src/components/ui/**` 以外的 `.tsx` 加禁止原生 `input / select / textarea` 的规则，`node scripts/lint-ratchet.mjs --update` 记下基线，此后只减不增。
