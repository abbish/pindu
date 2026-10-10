import { Id, Timestamp } from './common';
import type { WordExample } from './wordbook';
import type { PlanPassageInput } from './passage';

/// 学习计划
export interface StudyPlan {
  id: Id;
  name: string;
  description: string;
  status: StudyPlanStatus;                    // 管理状态：normal, draft, deleted (保留用于兼容)
  unified_status: UnifiedStudyPlanStatus;     // 统一状态字段
  total_words: number;
  mastery_level: number;
  // AI规划相关字段
  intensity_level?: IntensityLevel;
  study_period_days?: number;
  review_frequency?: number;
  start_date?: string;
  end_date?: string;
  actual_start_date?: string;                 // 实际开始时间
  actual_end_date?: string;                   // 实际完成时间
  actual_terminated_date?: string;            // 实际终止时间
  ai_plan_data?: string;
  /** 每天新词数（自适应复习计划；旧计划为 null） */
  daily_new_words?: number | null;
  deleted_at?: string;                        // 软删除时间
  created_at: Timestamp;
  updated_at: Timestamp;
}

/// 带进度的学习计划
export interface StudyPlanWithProgress extends StudyPlan {
  /** 练完的日程与完成的短文合起来的进度 0–100 */
  progress_percentage: number;
  /** 练习内容：只练单词 / 只练短文 / 两者都练 */
  practice_content: PracticeContent;
  /** 短文每几天一篇 */
  passage_interval_days: number;
  /** 计划里的短文任务数 / 已完成数 */
  total_passages: number;
  completed_passages: number;
}

/** 学习计划的练习内容 */
export type PracticeContent = 'words' | 'passages' | 'both';

/// 学习计划统一状态（新版本）
export type UnifiedStudyPlanStatus =
  | 'Draft'      // 草稿状态 - 刚创建，还未完成配置
  | 'Pending'    // 待开始 - 已配置完成，等待开始学习
  | 'Active'     // 进行中 - 正在学习
  | 'Paused'     // 已暂停
  | 'Completed'  // 已完成 - 学习计划正常完成
  | 'Terminated' // 已终止 - 提前结束学习计划
  | 'Deleted';   // 已删除 - 软删除状态

/// 学习计划管理状态（保留用于向后兼容）
export type StudyPlanStatus = 'normal' | 'draft' | 'deleted';

/// 学习强度等级
export type IntensityLevel = 'easy' | 'normal' | 'intensive';

/// 学习统计
export interface StudyStatistics {
  total_words_learned: number;
  average_accuracy: number;
  streak_days: number;
  completion_rate: number;
  weekly_progress: number[];
}

/// 某个本地日期的学习量（首页学习热力图；后端只返回有学习的日期）
export interface DailyLearningActivity {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  /** 当天练过的单词数（有首次作答记录的不同单词，含未完成会话） */
  practiced_words: number;
  /** 当天学会的单词数（已完成会话中三步首答全对） */
  mastered_words: number;
}

// ==================== 单词练习相关类型 ====================

/// 单词练习步骤枚举
export enum WordPracticeStep {
  STEP_1 = 1, // 显示完整信息（单词+音标+中文+音节+拼读）
  STEP_2 = 2, // 隐藏英文原文（音标+中文+音节+拼读）
  STEP_3 = 3  // 仅中文+音节+拼读+发音
}

/// 练习单词信息
export interface PracticeWordInfo {
  wordId: number;
  word: string;
  meaning: string;
  description?: string;
  ipa?: string;
  syllables?: string;
  phonicsSegments?: string;
  /** 例句（按顺序，第一句最简单） */
  examples?: WordExample[];
}

/// 单词练习状态
export interface WordPracticeState {
  wordId: number;
  planWordId: number;        // study_plan_schedule_words 表的 ID
  /** 复习词：只做第三步（不看答案，听音 + 中文独立拼写），按结果调整记忆等级 */
  isReview?: boolean;
  wordInfo: PracticeWordInfo; // 完整的单词信息
  currentStep: WordPracticeStep;
  stepResults: boolean[];    // 三个步骤的结果 [step1, step2, step3]
  stepAttempts: number[];    // 每个步骤的尝试次数
  stepTimeSpent: number[];   // 每个步骤的用时（毫秒）
  completed: boolean;        // 三个步骤是否全部完成
  passed: boolean;           // 三步全对才算通过
  /** 每步答错后重考的次数 */
  retryCounts?: number[];
  /** 每步首次答错、之后重考答对（查后改对） */
  fixedSteps?: boolean[];
  /** 当轮小测结果（没做为 null） */
  reviewCorrect?: boolean | null;
  startTime: string;         // 开始时间
  endTime?: string;          // 结束时间
}

/// 练习会话
export interface PracticeSession {
  sessionId: string;
  planId: number;
  planTitle?: string;        // 学习计划名称
  scheduleId: number;        // 关联的日程ID
  scheduleDate: string;      // 日程日期
  startTime: string;
  endTime?: string;
  totalTime: number;         // 总时间（包含暂停，毫秒）
  activeTime: number;        // 实际练习时间（毫秒）
  pauseCount: number;        // 暂停次数
  wordStates: WordPracticeState[];
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

/// 练习结果
export interface PracticeResult {
  sessionId: string;
  planId: number;
  scheduleId: number;
  scheduleDate: string;
  totalWords: number;
  passedWords: number;       // 三步全对的单词数
  totalSteps: number;        // 总步骤数（单词数 * 3）
  correctSteps: number;      // 正确步骤数
  stepAccuracy: number;      // 步骤正确率
  wordAccuracy: number;      // 单词通过率
  totalTime: number;         // 总时间（毫秒）
  activeTime: number;        // 实际练习时间（毫秒）
  pauseCount: number;
  averageTimePerWord: number; // 平均每个单词用时（毫秒）
  difficultWords: WordPracticeState[]; // 未通过的单词
  passedWordsList: WordPracticeState[]; // 通过的单词列表
  completedAt: string;
}

/// 开始练习会话请求
export interface StartPracticeSessionRequest {
  planId: number;
  scheduleId: number;
}

/// 提交步骤结果请求
export interface SubmitStepResultRequest {
  sessionId: string;
  wordId: number;
  planWordId: number;
  step: WordPracticeStep;
  userInput: string;
  isCorrect: boolean;
  timeSpent: number;         // 毫秒
  attempts: number;
  /** learn（每步首次作答）/ retry（纠正后重考）/ review（当轮小测）；不传视为 learn */
  kind?: 'learn' | 'retry' | 'review';
}

/// 暂停练习会话请求
export interface PausePracticeSessionRequest {
  sessionId: string;
}

/// 恢复练习会话请求
export interface ResumePracticeSessionRequest {
  sessionId: string;
}

/// 完成练习会话请求
export interface CompletePracticeSessionRequest {
  sessionId: string;
}

// ==================== AI规划相关类型 ====================

/// 学习计划规划请求
export interface StudyPlanScheduleRequest {
  name: string;
  description: string;
  /** 每天新学的词数（1–50）；周期与复习由系统按自适应间隔复习计算 */
  dailyNewWords: number;
  startDate: string; // YYYY-MM-DD
  wordbookIds: Id[]; // 选择的词汇本ID列表
  modelId?: number; // AI模型ID
  /** 是否用 AI 排学习顺序（默认 true）；false 时按词汇本原顺序立即排好 */
  useAi?: boolean;
}

/// AI规划结果的元数据
export interface StudyPlanMetadata {
  totalWords: number;
  studyPeriodDays: number;
  intensityLevel: IntensityLevel;
  reviewFrequency: number;
  planType: string;
  startDate: string;
  endDate: string;
  /** 每天新词数（自适应复习计划；旧规划没有） */
  dailyNewWords?: number | null;
}

/// 每日学习计划
export interface DailyStudyPlan {
  day: number;
  date: string;
  words: DailyStudyWord[];
}

/// 每日学习单词
export interface DailyStudyWord {
  wordId: string;
  word: string;
  wordbookId: string;
  isReview: boolean;
  reviewCount?: number;
  priority: 'high' | 'medium' | 'low';
  difficultyLevel: number;
  // 新增字段，与词汇本详情页面保持一致
  meaning?: string;
  partOfSpeech?: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.';
  ipa?: string;
  syllables?: string;
}

/// 学习计划单词（扁平化结构）
/** 对应 Rust `StudyPlanWord`（snake_case；仅 partOfSpeech 字段级 rename） */
export interface StudyPlanWord {
  // 基础单词信息
  id: number;
  word: string;
  meaning: string;
  partOfSpeech: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.';
  ipa: string;
  syllables: string;

  // 学习计划特有字段
  plan_id: number;
  schedule_id: number;
  scheduled_date: string;
  is_review: boolean;
  review_count?: number | null;
  priority: 'high' | 'medium' | 'low';
  difficulty_level: number;

  // 进度字段
  completed: boolean;
  completed_at?: string | null;
  study_time_minutes: number;
  correct_attempts: number;
  total_attempts: number;

  // 关联信息
  wordbook_id: number;
  /** study_plan_schedule_words 表的 ID */
  plan_word_id: number;

  // 记忆状态（自适应复习，D20）
  /** 记忆等级：0 未学，1–5（≥4 为掌握） */
  memory_box: number;
  /** 下次复习日期（本地 YYYY-MM-DD） */
  next_review_date?: string | null;
  /** 上次练习日期（本地 YYYY-MM-DD） */
  last_practiced_date?: string | null;
  /** 复习答错次数 */
  lapses: number;
  /** 复习次数 */
  reviews: number;
  /** 安排学新词的日期（本地 YYYY-MM-DD） */
  learn_date?: string | null;
}

/** 计划就地调整的结果（对应 Rust `PlanPaceResult`，camelCase） */
export interface PlanPaceResult {
  /** 还没学的新词数（含本次追加的） */
  remainingNewWords: number;
  /** 这些新词要学的天数 */
  learningDays: number;
  /** 计划结束日期 */
  endDate: string | null;
  /** 本次追加的单词数 */
  addedWords: number;
}

/// AI规划完整结果
export interface StudyPlanAIResult {
  planMetadata: StudyPlanMetadata;
  dailyPlans: DailyStudyPlan[];
}

/// 日历中计划的生命周期状态（对应 Rust `StudyPlanLifecycleStatus`，serde lowercase）
export type CalendarPlanStatus =
  | 'draft' | 'pending' | 'active' | 'paused' | 'completed' | 'terminated' | 'deleted';

/// 日历日期数据（对应 Rust `CalendarDayData`，无 rename_all，字段为 snake_case）
export interface CalendarDayData {
  date: string;
  is_today: boolean;
  is_in_plan: boolean;
  status: 'not-started' | 'in-progress' | 'completed' | 'overdue';
  new_words_count: number;
  review_words_count: number;
  total_words_count: number;
  completed_words_count: number;
  progress_percentage: number;
  study_time_minutes?: number | null;
  study_plans?: CalendarStudyPlan[] | null;
  study_sessions?: CalendarStudySession[] | null;
  /** 当天的短文任务数 / 其中已完成的 */
  passage_tasks: number;
  passage_completed: number;
  /** 当天的短文任务明细 */
  passages: CalendarPassageTask[];
}

/// 日历某天的一项短文任务（对应 Rust `CalendarPassageTask`）
export interface CalendarPassageTask {
  plan_id: number;
  plan_name: string;
  passage_id: number;
  title: string;
  /** 题组；为空表示只朗读 */
  set_id: number | null;
  mode: 'reading' | 'listening';
  /** 视频切片（只读任务即「看视频跟读」） */
  is_video: boolean;
  completed: boolean;
  /** 所属计划的状态（与 CalendarStudyPlan.unified_status 同一种小写取值）；只有进行中 / 待开始的计划能练 */
  unified_status: CalendarPlanStatus;
}

/// 日历中的学习计划信息（对应 Rust `CalendarStudyPlan`）
export interface CalendarStudyPlan {
  plan_id: number;
  plan_name: string;
  /** 当天这个计划的日程（可直接据此进入练习） */
  schedule_id: number;
  unified_status: CalendarPlanStatus;
  /** 这个日程已练完 */
  practiced: boolean;
  /** 有练了一半的练习 */
  in_progress: boolean;
  new_words_count: number;
  review_words_count: number;
  total_words_count: number;
  /** 已掌握（当次通过）的单词数 */
  completed_words_count: number;
}

/// 日历中的学习记录信息（对应 Rust `CalendarStudySession`）
export interface CalendarStudySession {
  session_id: string;
  plan_id: number;
  plan_name: string;
  words_studied: number;
  study_time_minutes: number;
  accuracy_rate: number;
  completed_at: string;
}

/// 日历月度数据请求
export interface CalendarMonthRequest {
  year: number;
  month: number; // 1-12
  includeOtherMonths?: boolean; // 是否包含其他月份的日期
}

/// 日历月度数据响应（对应 Rust `CalendarMonthResponse`）
export interface CalendarMonthResponse {
  year: number;
  month: number;
  days: CalendarDayData[];
  monthly_stats: CalendarMonthlyStats;
}

/// 日历月度统计（对应 Rust `CalendarMonthlyStats`，只统计当月日期）
export interface CalendarMonthlyStats {
  total_days: number;
  study_days: number;
  completed_days: number;
  total_words_learned: number;
  total_study_minutes: number;
  average_accuracy: number;
  streak_days: number;
  active_plans_count: number;
}

/// 学习计划统计数据
/** 对应 Rust `StudyPlanStatistics`（无 rename_all，字段为 snake_case） */
export interface StudyPlanStatistics {
  // 时间相关
  average_daily_study_minutes: number;
  time_progress_percentage: number;    // 时间进度 (已过天数/总天数)
  actual_progress_percentage: number;  // 实际完成进度 (已完成单词/总单词)

  // 学习效果
  average_accuracy_rate: number;       // 平均练习正确率
  overdue_ratio: number;               // 逾期比率 (逾期天数/总天数)
  streak_days: number;                 // 该计划的连续练习天数

  // 详细数据
  total_days: number;
  completed_days: number;
  overdue_days: number;
  total_words: number;
  /** 已掌握的单词数（记忆等级 ≥ 4） */
  completed_words: number;
  /** 已学的单词数（完成过一次含该词的练习） */
  learned_words: number;
  total_study_minutes: number;
}

/// 创建带AI规划的学习计划请求
export interface CreateStudyPlanWithScheduleRequest {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  /** 日程 JSON 字符串（StudyPlanAIResult）；周期等元数据由后端从这里读取；只练短文时传空字符串 */
  aiPlanData: string;
  wordbookIds: Id[];
  status?: StudyPlanStatus; // "draft" 或 "active"
  /** 练习内容（默认 words） */
  practiceContent?: PracticeContent;
  /** 计划里的短文（顺序即排期顺序）；只练单词时为空 */
  passages?: PlanPassageInput[];
  /** 短文每几天一篇（默认 2） */
  passageIntervalDays?: number;
}

/** 计划日程摘要（get_study_plan_schedules；今天到期的复习已动态放进今天的日程） */
export interface PlanScheduleSummary {
  id: Id;
  /** 本地日历日期 YYYY-MM-DD */
  schedule_date: string;
  /** 第几天 */
  day: number;
  /** 日程单词数（新学 + 复习） */
  word_count: number;
  new_words_count: number;
  review_words_count: number;
  /** 当次通过的单词数 */
  completed_words_count: number;
  /** 日程已练完 */
  completed: boolean;
  /** 当天的单词（新学在前的顺序由后端决定：复习在前、新学在后） */
  words?: PlanScheduleWord[];
}

/// 日程里的一个单词（get_study_plan_schedules 的 words）
export interface PlanScheduleWord {
  word_id: number;
  word: string;
  meaning: string;
  /** 复习词（按记忆等级到期加入） */
  is_review: boolean;
}

/// 计划状态的显示元数据（唯一 owner：文案 + 徽章配色）
export const PLAN_STATUS: Record<UnifiedStudyPlanStatus, { label: string; badgeClass: string }> = {
  Draft: { label: '草稿', badgeClass: 'bg-secondary text-secondary-foreground' },
  Pending: { label: '待开始', badgeClass: 'border-border text-foreground' },
  Active: { label: '进行中', badgeClass: 'bg-accent text-accent-foreground' },
  Paused: { label: '已暂停', badgeClass: 'bg-warning-soft text-warning' },
  Completed: { label: '已完成', badgeClass: 'bg-success-soft text-success' },
  Terminated: { label: '已终止', badgeClass: 'bg-destructive/10 text-destructive' },
  Deleted: { label: '已删除', badgeClass: 'bg-secondary text-muted-foreground' },
};

/// 获取状态显示文案
export const getStatusDisplay = (status: UnifiedStudyPlanStatus): { text: string } => ({ text: PLAN_STATUS[status].label });

/// 可用操作类型
export type StudyPlanAction =
  | 'edit'           // 编辑
  | 'publish'        // 发布
  | 'start'          // 开始
  | 'pause'          // 暂停
  | 'resume'         // 继续（结束暂停）
  | 'complete'       // 完成
  | 'terminate'      // 终止
  | 'restart'        // 重新开始
  | 'delete'         // 删除
  | 'restore'        // 恢复
  | 'permanentDelete'; // 永久删除

/// 获取可用操作
export const getAvailableActions = (status: UnifiedStudyPlanStatus): StudyPlanAction[] => {
  switch (status) {
    // 不再有“编辑 → 草稿 → 发布”：名称、节奏、词汇本在详情页「设置」里就地修改（authoring-flows-redesign B5）
    case 'Draft':
      return ['publish', 'delete'];
    case 'Pending':
      // 不再单独“开始学习”：第一次练习时自动开始（日程从当天排起）
      return ['delete'];
    case 'Active':
      return ['pause', 'complete', 'terminate', 'delete'];
    case 'Paused':
      return ['resume', 'complete', 'terminate', 'delete'];
    case 'Completed':
    case 'Terminated':
      return ['restart', 'delete'];
    default:
      // 删除是物理删除，不存在“已删除”计划
      return [];
  }
};

/** 对应 Rust `TodayStudySchedule`（无 rename_all，字段为 snake_case） */
/// 今日学习日程
export interface TodayStudySchedule {
  plan_id: Id;
  plan_name: string;
  schedule_id: Id;
  schedule_date: string;
  new_words_count: number;
  review_words_count: number;
  total_words_count: number;
  completed_words_count: number;
  progress_percentage: number;
  /** completed 练完 / in-progress 练了一半 / overdue 过期待补 / not-started 未开始 */
  status: 'completed' | 'in-progress' | 'overdue' | 'not-started';
  can_start_practice: boolean;
  /** 过期待补：这个计划没练的过期日程数（含本条）；今天的日程为 0 */
  overdue_count: number;
}

/// 数据库表统计信息
export interface DatabaseTableStats {
  table_name: string;
  display_name: string;
  record_count: number;
  table_type: 'config' | 'user_data';
  description: string;
}

/// 数据库概览信息
export interface DatabaseOverview {
  total_tables: number;
  total_records: number;
  tables: DatabaseTableStats[];
}

/// 重置操作结果
export interface ResetResult {
  success: boolean;
  message: string;
  deleted_records: number;
  affected_tables: string[];
}

/// 某个记忆等级的单词数（对应 Rust `MemoryBoxCount`）
export interface MemoryBoxCount {
  /** 记忆等级 1–5（复习间隔 1 / 3 / 7 / 14 / 30 天） */
  box_level: number;
  count: number;
}

/// 计划的记忆概况（对应 Rust `PlanMemoryOverview`，自适应复习 D20）
export interface PlanMemoryOverview {
  plan_id: number;
  /** 计划单词总数 */
  total: number;
  /** 还没学的 */
  not_started: number;
  /** 已学过（等级 ≥ 1） */
  learned: number;
  /** 已掌握（等级 ≥ 4：间隔 7 天后仍写对） */
  mastered: number;
  /** 今天待复习（含之前到期未练） */
  due_today: number;
  /** 下一次有复习到期的本地日期 YYYY-MM-DD；没有待复习时为 null */
  next_due_date: string | null;
  /** 等级 1–5 各自的单词数（固定 5 项，升序） */
  box_counts: MemoryBoxCount[];
}

