# UI 体系迁移到 shadcn/ui

## 目标
前端统一迁移到 shadcn/ui（Radix）+ Tailwind CSS v4，组件、交互模式、页面布局标准化，便于 AI 生成与维护。

## 范围
- 接入：React 19 → Tailwind v4 + shadcn + 主题 token（`ui-system-standard.md` §6）
- 应用外壳：侧边栏 + 顶栏 + 专注模式（练习页）
- 按页面迁移全部 13 个路由页与设置各分区；最后收口（ESLint gate、删除旧基础组件 / FontAwesome / 旧 CSS 变量）

## 成功标准
- 每个迁移批次功能对等：以 `feature-inventory.md` 为改版前基线逐条核对，无未经同意的功能删减
- 交互与布局能对应到 `ui-interaction-patterns.md` 的场景行或 shadcn Block / Example；遵循 §5 桌面应用约定
- 亮 / 暗两种主题、1200×800 最小窗口走查通过；`npm run verify` 全绿

## 用户决定（2026-10-07）
- 选定 shadcn/ui 为唯一 UI 体系
- 交互模式采用 shadcn 已有设计或行业最佳实践，不自行发明
- 按桌面 app 设计，不按网页
- 迁移不能丢失已有功能
- 外壳方向：侧边栏方案的原型已出（https://claude.ai/artifact/YcUgjy3q8JP2nxJCKBfEQs），待用户确认

## 约束
- 2026-10-07 起另有进程在并行重构前端组件 / 样式：动代码前先确认其进度，避免冲突
- 规范 owner：`.claude/skills/deliver-frontend-react/references/ui-system-standard.md`、`ui-interaction-patterns.md`、`page-layout-standard.md`
