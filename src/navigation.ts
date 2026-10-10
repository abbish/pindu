/**
 * 页面路由表（唯一 owner）。规范：frontend-code-standard.md §1
 *
 * 新增页面：在 RouteParams 加键 → App.tsx 加 case → 页面文件；tsc 会指出遗漏。
 */
import type { PracticeResult } from './types';
import type { PassageMode } from './types/passage';

/** 页面键 → 导航参数 */
export interface RouteParams {
  home: undefined;
  plans: undefined;
  'create-plan': undefined;
  /** tab：打开时选中的页签（从短文练习回来时为 passages） */
  'plan-detail': { planId: number; tab?: 'passages' };
  wordbooks: undefined;
  'wordbook-detail': { id: number };
  /** returnTo：退出练习回到哪里（默认计划详情） */
  'word-practice': { planId: number; scheduleId: number; sessionId?: string; returnTo?: PassagePracticeReturn };
  'practice-result': PracticeResult;
  passages: undefined;
  /** 新建短文：可预填来源词汇本 / 计划与必用词 */
  'create-passage': { bookIds?: number[]; planIds?: number[]; wordIds?: number[] } | undefined;
  /** 导入我的材料（粘贴 / 文件 → 原文不改的短文） */
  'import-passage': undefined;
  /** fromPlan：从计划的短文任务打开（面包屑与返回都回到这个计划） */
  /** fromPlan：从计划的短文任务打开；returnTo：读完 / 返回回到哪里（默认这个计划的短文页签） */
  /** clip：视频片段（面包屑与侧边栏在「视频库」下） */
  'passage-detail': { passageId: number; fromPlan?: PlanContext; returnTo?: PassagePracticeReturn; clip?: boolean };
  /**
   * 按题组练习（阅读 / 听力）。planId：从计划里的短文任务进入（完成后计入计划）；
   * returnTo：练完 / 退出回到哪里（默认短文详情）
   */
  'passage-practice': { setId: number; mode: PassageMode; planId?: number; returnTo?: PassagePracticeReturn };
  /** 视频库：tab 片段（默认）/ 原始视频；videoId 只看这个视频切出的片段 */
  videos: { tab?: 'clips' | 'sources'; videoId?: number } | undefined;
  /** 剪辑编辑器：预览、调整切分规划（整窗页面） */
  'video-editor': { videoId: number };
  /** 标签：这个标签下的全部素材（侧边栏「标签」分组） */
  tag: { tagId: number };
  calendar: undefined;
  settings: undefined;
}

export type PageKey = keyof RouteParams;

/** 短文练习结束后回到的页面 */
export type PassagePracticeReturn = 'plan-detail' | 'home' | 'calendar';

/** 顶部导航中的一级页面 */
export type TopLevelPage = 'home' | 'plans' | 'wordbooks' | 'passages' | 'videos' | 'tag' | 'calendar' | 'settings';

/** 从计划进入素材页面时带上的计划（面包屑显示「计划 › 计划名 › …」） */
export interface PlanContext {
  planId: number;
  planName: string;
}

/** 页面使用的导航函数：页面键与参数形状由 RouteParams 约束 */
export type NavigateFn = <K extends PageKey>(page: K, params?: RouteParams[K]) => void;

/** 当前路由（页面键与参数配对） */
export type Route = { [K in PageKey]: { page: K; params?: RouteParams[K] } }[PageKey];

/**
 * 专注模式页面：不进 AppShell（侧边栏 + 顶栏），页面自绘整窗框架（如单词练习）。
 * 其余页面都由 AppShell 包裹，页面只渲染内容区。
 */
export const FOCUS_PAGES: ReadonlySet<PageKey> = new Set<PageKey>(['word-practice', 'passage-practice', 'video-editor']);

/** 页面所属的一级导航（侧边栏高亮） */
export const TOP_LEVEL_OF: Record<PageKey, TopLevelPage> = {
  home: 'home',
  plans: 'plans',
  'create-plan': 'plans',
  'plan-detail': 'plans',
  wordbooks: 'wordbooks',
  'wordbook-detail': 'wordbooks',
  'word-practice': 'plans',
  'practice-result': 'plans',
  passages: 'passages',
  'create-passage': 'passages',
  'import-passage': 'passages',
  'passage-detail': 'passages',
  'passage-practice': 'passages',
  videos: 'videos',
  'video-editor': 'videos',
  tag: 'tag',
  calendar: 'calendar',
  settings: 'settings',
};

/** 页面默认标题（顶栏面包屑末项） */
export const PAGE_TITLE: Record<PageKey, string> = {
  home: '首页',
  plans: '计划',
  'create-plan': '创建计划',
  'plan-detail': '计划详情',
  wordbooks: '词汇本',
  'wordbook-detail': '词汇本详情',
  'word-practice': '单词练习',
  'practice-result': '练习结果',
  passages: '短文库',
  'create-passage': '新建短文',
  'import-passage': '导入短文',
  'passage-detail': '短文详情',
  'passage-practice': '短文练习',
  videos: '视频库',
  'video-editor': '剪辑编辑器',
  tag: '标签',
  calendar: '学习日历',
  settings: '设置',
};
