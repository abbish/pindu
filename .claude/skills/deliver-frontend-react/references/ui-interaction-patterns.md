# 交互模式与布局（RedLark）

`deliver-frontend-react` 设计页面、流程、组件组合时的模式库。原则：**采用已有模式，不自己发明**。组件本身的用法见 `ui-system-standard.md`，页面骨架见 `page-layout-standard.md`。

## 1. 模式来源优先级

1. **shadcn 官方**：Blocks（ui.shadcn.com/blocks，可 `npx shadcn@latest add <block>` 直接装）、Examples（Dashboard / Tasks / Forms / Mail / Cards 等）、各组件文档的 Examples 段。AI 读 `https://ui.shadcn.com/llms.txt` 定位；已配置 shadcn MCP 时优先用它查询。
2. **交互行为规范**：WAI-ARIA Authoring Practices（键盘与焦点）——Radix 原语已实现，不要覆盖。
3. **桌面平台惯例**：Apple HIG / Microsoft Fluent 的桌面约定（窗口内导航、快捷键、确认与撤销）。
4. 以上都没有对应模式时才自定义，且必须在 `plan.md` 或批次说明里写明：场景、查过哪些来源、为什么不适用、自定义方案。

“参考”指照搬结构、组件组合与交互，只替换数据和文案；不是“看过后换个样子重写”。

## 2. 工作方式

1. 用一句话写清页面任务（`page-layout-standard.md`），然后在 §3 中找到对应场景行。
2. 打开该行指向的 shadcn Block / Example / 文档，按它的组件组合与布局实现。
3. 一个页面由多个场景组成时（如“列表 + 筛选 + 批量操作 + 侧栏详情”），逐个对应，不混出新形态。
4. 找不到对应行 → 按 §1 第 4 条记录偏离；若该场景会反复出现，补进 §3（走 `harness-governance`）。

## 3. 场景 → 模式

### 导航与外壳

| 场景 | 模式 | 参考 |
| --- | --- | --- |
| 一级导航（首页 / 计划 / 单词本 / 日历 / 设置） | `AppShell`：shadcn Sidebar（可折叠为图标栏）+ 顶栏面包屑；设置入口在侧栏底部 | Blocks › Sidebar |
| 层级位置 | `Breadcrumb`，仅二级及以下页面 | Breadcrumb |
| 页面内分区（≤5 个平级区块） | `Tabs`；更多或需要深链时用左侧竖向导航 | Tabs；Examples › Forms |
| 沉浸式练习页 | 隐藏一级导航，只留退出 / 暂停；顶部 `Progress`；主区居中大字号；快捷键用 `Kbd` 提示 | 行业惯例（Duolingo / Anki 类） |

### 集合与数据

| 场景 | 模式 | 参考 |
| --- | --- | --- |
| 对象带封面/摘要、数量少（单词本、学习计划） | `Card` 网格，卡片整体可点进入详情，次要操作放卡片右上 `DropdownMenu` | Examples › Cards |
| 多字段、需排序 / 多选 / 批量（单词列表） | Data Table（TanStack Table）：工具栏（搜索 + 分面筛选 + 视图选项）→ 表格（列头排序、复选框列、行尾 `⋯` 菜单）→ 分页；选中行后出现批量操作栏 | Examples › Tasks；Data Table 指南 |
| 筛选 | 搜索 `Input` + 分面筛选（`Popover` + `Command` 多选，带计数与“清除”） | Tasks › faceted filter |
| 查看详情不离开列表 | 右侧 `Sheet` | Sheet |
| 快速查找 / 跳转 | `Command`（⌘K / Ctrl+K） | Command |

### 详情

| 场景 | 模式 | 参考 |
| --- | --- | --- |
| 对象详情页头部 | 标题 + 状态 `Badge` + 右侧主操作 `Button`；次要与危险操作收进 `DropdownMenu`（危险项放最后、红色、分隔线隔开） | Examples › Dashboard / Tasks |
| 关键指标 | 一行 `Card` 指标（标题、数值、变化说明） | Blocks › dashboard |
| 趋势 / 分布 | shadcn Charts（Recharts） | Charts |

### 创建与编辑

| 场景 | 模式 | 参考 |
| --- | --- | --- |
| ≤5 个字段、单一对象 | `Dialog` 表单：标题 + 描述 → 字段 → 底部右对齐“取消（outline）/ 主操作” | Dialog 文档示例 |
| 字段多、需预览或步骤（创建学习计划、导入单词本） | 独立页面；多步时顶部步骤指示 + 每步“上一步 / 下一步”，最后一步预览再提交 | Blocks（多步表单）/ 行业向导模式 |
| 表单字段 | 标签在上、说明在下、错误在字段下方；提交时校验并聚焦首个错误；提交中按钮 `disabled` + 旋转图标；不因“未填完”预先禁用提交 | Form / Field 文档 |
| 设置页 | 桌面设置窗口模式（macOS 系统设置 / Claude 桌面版）：左栏 标题 + 搜索 + 分组导航，右栏面板 = 分组标题 + 圆角卡片 + 设置行（左名称与说明、右控件）；子对象下钻（行尾 `›`，面板顶部「‹ 返回」）而不是嵌套双栏；开关 / 主题等即时生效，表单类显式保存；危险操作单独成组描红。组件：`components/SettingsLayout`（SettingsPanel / SettingsSection / SettingsRow） | Examples › Forms（settings）；macOS HIG Settings |
| 列表项配置（AI 提供商、模型） | 每项一张 `Card`/行：名称、状态 `Badge`、操作按钮；新增与编辑走 `Dialog` | Examples › Cards / Forms |

### 反馈与状态

| 场景 | 模式 | 参考 |
| --- | --- | --- |
| 异步操作结果 | `useToast().showSuccess` / `showError("无法…", result.error)`；可撤销操作用带“撤销”按钮的 toast，不再弹确认；写法见 §6 | Sonner |
| 不可撤销的破坏操作 | `AlertDialog`：标题写具体后果，确认按钮用具体动词（“删除单词本”）+ `destructive` | Alert Dialog |
| 页面级错误 / 警示 | 主区内 `PageError`（Alert + 重试 / 返回），不用 toast | Alert |
| 表单校验错误 | 字段下方内联；提交失败用 `InlineError` 留在弹窗 / 表单里，不用 toast | Form |
| 首次加载 | 与最终布局同形的 `Skeleton` | Skeleton |
| 空数据 | Empty 状态：图标 + 标题 + 一句说明 + 主操作按钮 | Empty |
| 长任务（AI 分析、计划生成） | 内联 `Card`：`Progress` + 当前步骤文案 + “取消”；不锁住整个应用，离开页面后回来能看到进度 | Progress |
| 图标按钮 | 必须有 `Tooltip` 或 `aria-label` | Tooltip |

### 浮层选择

| 需要 | 用 |
| --- | --- |
| 必须处理才能继续的任务 / 表单 | `Dialog` |
| 确认破坏操作 | `AlertDialog` |
| 上下文详情、可边看边操作列表 | `Sheet` |
| 小型选择、附加选项（不含长表单） | `Popover` |
| 一组操作 | `DropdownMenu`（右键场景用 `ContextMenu`） |
| 纯说明 | `Tooltip`（不放可交互内容） |

浮层内不再嵌套 Dialog；需要第二层时改为页面或 Sheet。

## 4. 通用约定

- 每屏只有一个主按钮（`default` variant）；其余用 `outline` / `ghost`；破坏操作用 `destructive`。
- 可见操作 ≤2 个，其余收进 `⋯` `DropdownMenu`。
- 按钮文案用动词（“创建计划”而非“确定”）；取消永远在主操作左侧。
- 快捷键：Esc 关闭浮层（Radix 自带）、Enter 提交表单；练习页的作答 / 播放发音快捷键在界面用 `Kbd` 标出。
- 1200×800 最小窗口下主区不出现横向滚动；表格过宽时隐藏次要列（列显示选项），不缩小字号。

## 5. 桌面应用约定（RedLark 是 Tauri 桌面 app，不是网页）

shadcn 的 Blocks / Examples 多为网页场景，采用时按下列约定改成桌面形态：

- **窗口即应用**：外壳铺满窗口（`h-screen`，`overflow-hidden`），侧栏与顶栏固定，只有内容区滚动；不出现整页滚动、页脚、“返回顶部”。窗口使用系统原生标题栏（`tauri.conf.json` 未关闭 decorations），不在页面内再画标题栏。
- **不用网页语义**：页面间跳转一律走 `onNavigate` + `Button` / 导航项，不用 `<a href>`、不出现带下划线的超链接样式；外部链接经 `@tauri-apps/plugin-opener` 用系统浏览器打开。
- **指针与选择**：按钮、导航项、菜单项保持默认箭头指针（`cursor-default`），只有真正的链接文本用手形；外壳、导航、按钮、标签等界面文字 `select-none`，单词、例句、讲解、日志等内容可选中复制。
- **密度**：按桌面密度设计（控件高 32–36px、正文 14px），不为触屏放大点击区，也不做手机断点布局；最小窗口 1200×800。
- **快捷键**：修饰键按平台显示（macOS `⌘`，Windows / Linux `Ctrl`）；不占用系统 / WebView 保留键（`⌘/Ctrl + P/R/W/Q/C/V/X/Z/A`）；全局快捷键集中在外壳注册，页面内快捷键只在该页挂载时生效，并在界面用 `Kbd` 提示。
- **右键菜单**：列表行、卡片的 `⋯` 菜单同时挂 `ContextMenu`（同一组操作）；空白处不弹浏览器默认菜单。
- **状态保持**：侧栏折叠、设置页分区、列表筛选与排序等界面偏好在重启后保持（localStorage 即可），切换页面再回来时保持滚动位置与筛选条件。
- **长任务与离开**：AI 分析、计划生成等进行中离开页面不中断，回到页面能看到进度；练习进行中关闭窗口或切走前要保存进度（现有 `save_practice_progress`）。

## 6. 提示与报错（全应用一致）

### 6.1 选哪种反馈

| 情况 | 用 | 说明 |
| --- | --- | --- |
| 用户点了按钮、结果不在眼前（保存、删除、追加、清理） | toast | 结果已经直接显示在界面上的（切开关、选下拉、跳到结果页）**不弹成功提示** |
| 选了就生效的设置项 | 不提示成功；失败 toast | 控件状态本身就是反馈 |
| 弹窗 / 表单内提交失败 | `InlineError`（`@/components/InlineError`），弹窗保持打开 | 不另外再弹 toast |
| 页面加载失败、对象不存在 | `PageError`（`@/components/PageError`）+ 重试 / 返回 | 次要数据（统计、计数）加载失败可以静默 |
| 后台、连续触发的失败（自动朗读） | toast 带固定 `id` | 同类提示只留一条，不刷屏 |
| 有后果的操作 | `AlertDialog` 先确认 | 没有后果的操作（开始、发布）直接执行 |
| 可撤销的删除 | 直接执行 + 带“撤销”的 toast | 不再确认 |

### 6.2 文案

- **成功标题**：“已 + 动作 + 对象”，如“已删除 3 个单词”“已创建「四年级上册」”；不写“成功”、不加感叹号、不写“恭喜”。描述只在有后续影响时补一句（“继续学习时，日程会按暂停的天数顺延”）。
- **失败标题**：“无法 + 动作 + 对象”，如“无法删除单词”“无法加载日历”；不用“错误”“操作失败”“系统错误”这类不说明发生了什么的标题。描述放原因：直接用 `result.error`，不再拼兜底文案（`result.error || 'xx失败'` 是旧写法）。
- **内联错误**：`<InlineError title="无法保存单词">{result.error}</InlineError>`，显示为“无法保存单词：原因”。
- **确认框**：标题是问句、写清对象（“删除这个计划？”“移除「OpenRouter」？”）；描述只讲后果，不写“确定吗？”；确认按钮写动作（“删除计划”“移除”），破坏性用 `destructive`；取消永远是“取消”。
- 标点：中文全角，书名号用「」，标题不加句号；数字与中文之间留空格（“已删除 3 个单词”）。

### 6.3 错误原因从哪来

- 服务层失败时 `result.error` 已经是给用户看的话：`TauriApiClient.invoke` 经 `api/errors.ts::toUserMessage` 去掉“验证错误:”等类别前缀，把数据库 / 内部错误换成可操作的说法，把 AI / 语音服务的常见失败（密钥、额度、超时、网络、模型名）换成处理办法；原始信息在 `result.detail` 与日志里。
- 后端返回给用户的 `AppError` 信息写中文、说清楚怎么办（“还没有设置默认 AI 模型，请到「设置 → AI 模型」添加模型并设为默认”）；原始的英文 / sqlx 信息只放在冒号后面，前端会去掉。
- 新增需要特别说法的错误类型时，改 `toUserMessage` 并补 `api/errors.test.ts`，不要在调用点各自判断错误文本。
