# 页面布局标准（RedLark）

## 结构

页面由 `AppShell` 包裹（侧边栏 + 顶栏面包屑；子页面的父级由 `TOP_LEVEL_OF` 推出，末项标题默认取 `PAGE_TITLE`，动态标题用 `usePageTitle()`），页面只渲染内容区，不再自带导航与面包屑：

```tsx
<div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
  <PageHeader title="标题" description="一句说明" actions={<Button>主操作</Button>} />
  {/* 主区：通常是 Card / 列表 */}
  {/* 辅助区（统计 / 筛选 / 侧栏）*/}
</div>
```

- 需要自己管理滚动的双栏页面（如设置页：左栏导航 + 右栏面板）用 `flex h-full min-h-0`，各栏 `overflow-y-auto`。
- 专注模式页面（`FOCUS_PAGES`，如单词练习）不进 AppShell，页面自绘整窗框架（退出 / 进度 / 计时）。

## 先写页面任务，再写组件

新页面先用一句话写清：用户来这页完成什么；主区是什么；辅助区是什么；主操作是什么；谁拥有滚动。再按 `ui-interaction-patterns.md` §3 为每个区域找到对应模式，然后拆组件。不要从组件清单或 Grid 开始。

## 三态同构

初次 loading、空数据、`success === false` 的错误态保持同一信息结构（标题、面包屑、操作区都在），只替换主区内容。错误态显示 `result.error` 文案与重试入口，不静默成空态。

## 导航参数

`onNavigate('plan-detail', { planId })` 这类参数是页面间 contract，形状由 `src/navigation.ts` 的 `RouteParams` 定型（唯一 owner，不在此复制参数表）；改参数要同时改发出方、`App.tsx` 的 case 与接收页面，tsc 会指出遗漏。
