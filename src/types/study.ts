import { Id, Timestamp } from './common';

/// 学习计划
export interface StudyPlan {
  id: Id;
  name: string;
  description: string;
  status: StudyPlanStatus;                    // 管理状态：normal, draft, deleted
  lifecycle_status: StudyPlanLifecycleStatus; // 生命周期状态：pending, active, completed
  total_words: number;
  learned_words: number;
  accuracy_rate: number;
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
  deleted_at?: string;                        // 软删除时间
  created_at: Timestamp;
  updated_at: Timestamp;
}

/// 带进度的学习计划
export interface StudyPlanWithProgress extends StudyPlan {
  unified_status: UnifiedStudyPlanStatus;  // 统一状态字段
  progress_percentage: number;
}

/// 学习计划统一状态（新版本）
export type UnifiedStudyPlanStatus =
  | 'Draft'      // 草稿状态 - 刚创建，还未完成配置
  | 'Pending'    // 待开始 - 已配置完成，等待开始学习
  | 'Active'     // 进行中 - 正在学习
  | 'Paused'     // 已暂停 - 暂时停止学习
  | 'Completed'  // 已完成 - 学习计划正常完成
  | 'Terminated' // 已终止 - 提前结束学习计划
  | 'Deleted';   // 已删除 - 软删除状态

/// 旧的学习计划管理状态（保留用于向后兼容）
export type LegacyStudyPlanStatus = 'normal' | 'draft' | 'deleted';

/// 旧的学习计划生命周期状态（保留用于向后兼容）
export type LegacyStudyPlanLifecycleStatus = 'pending' | 'active' | 'completed' | 'terminated';

/// 为了向后兼容，保留原有的类型别名
export type StudyPlanStatus = LegacyStudyPlanStatus;
export type StudyPlanLifecycleStatus = LegacyStudyPlanLifecycleStatus;

/// 学习强度等级
export type IntensityLevel = 'easy' | 'normal' | 'intensive';

/// 创建学习计划请求
export interface CreateStudyPlanRequest {
  name: string;
  description: string;
  word_ids: Id[];
  mastery_level?: number;
}

/// 更新学习计划请求
export interface UpdateStudyPlanRequest {
  name?: string;
  description?: string;
  status?: StudyPlanStatus;
  lifecycle_status?: StudyPlanLifecycleStatus;
  mastery_level?: number;
}

/// 学习计划查询参数
export interface StudyPlanQuery {
  status?: StudyPlanStatus;
  lifecycle_status?: StudyPlanLifecycleStatus;
  keyword?: string;
  include_deleted?: boolean;  // 是否包含已删除的计划
}

/// 学习会话
export interface StudySession {
  id: Id;
  plan_id: Id;
  started_at: Timestamp;
  finished_at?: Timestamp;
  words_studied: number;
  correct_answers: number;
  total_time_seconds: number;
}

/// 学习统计
export interface StudyStatistics {
  total_words_learned: number;
  average_accuracy: number;
  streak_days: number;
  completion_rate: number;
  weekly_progress: number[];
}

/// 学习进度
export interface StudyProgress {
  word_id: Id;
  plan_id: Id;
  learned: boolean;
  correct_count: number;
  total_attempts: number;
  mastery_score: number;
  last_studied?: Timestamp;
  next_review?: Timestamp;
}

/// 提交答案请求
export interface SubmitAnswerRequest {
  session_id: Id;
  word_id: Id;
  user_answer: string;
  is_correct: boolean;
  time_spent: number;
}

/// 结束学习会话请求
export interface EndSessionRequest {
  session_id: Id;
  words_studied: number;
  correct_answers: number;
  total_time: number;
}

// ==================== AI规划相关类型 ====================

/// 学习计划规划请求
export interface StudyPlanScheduleRequest {
  name: string;
  description: string;
  intensityLevel: IntensityLevel;
  studyPeriodDays: number; // 7, 14, 28
  reviewFrequency: number; // 3-5
  startDate: string; // YYYY-MM-DD
  wordbookIds: Id[]; // 选择的单词本ID列表
  modelId?: number; // AI模型ID
}

/// 学习计划规划参数（传递给AI的参数）
export interface StudyPlanAIParams {
  intensityLevel: IntensityLevel;
  totalWords: number;
  periodDays: number;
  reviewFrequency: number;
  startDate: string;
  wordList: StudyWordInfo[];
}

/// 传递给AI的单词信息
export interface StudyWordInfo {
  word: string;
  wordId: string;
  wordbookId: string;
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
  // 新增字段，与单词本详情页面保持一致
  meaning?: string;
  partOfSpeech?: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.';
  ipa?: string;
  syllables?: string;
}

/// 学习计划单词（扁平化结构）
export interface StudyPlanWord {
  // 基础单词信息
  id: number;
  word: string;
  meaning: string;
  partOfSpeech: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.';
  ipa: string;
  syllables: string;

  // 学习计划特有字段
  planId: number;
  scheduleId: number;
  scheduledDate: string;
  isReview: boolean;
  reviewCount?: number;
  priority: 'high' | 'medium' | 'low';
  difficultyLevel: number;

  // 进度字段
  completed: boolean;
  completedAt?: string;
  studyTimeMinutes: number;
  correctAttempts: number;
  totalAttempts: number;

  // 关联信息
  wordbookId: number;
  planWordId: number; // study_plan_schedule_words 表的 ID
}

/// AI规划完整结果
export interface StudyPlanAIResult {
  planMetadata: StudyPlanMetadata;
  dailyPlans: DailyStudyPlan[];
}

/// 学习计划单词列表（扁平化）
export interface StudyPlanWordList {
  words: StudyPlanWord[];
  totalCount: number;
  newWordsCount: number;
  reviewWordsCount: number;
}

/// 日历日期数据
export interface CalendarDayData {
  date: string;
  isToday: boolean;
  isInPlan: boolean;
  status: 'not-started' | 'in-progress' | 'completed' | 'overdue';
  newWordsCount: number;
  reviewWordsCount: number;
  totalWordsCount: number;
  completedWordsCount: number;
  progressPercentage: number;
  studyTimeMinutes?: number;
}

/// 学习计划统计数据
export interface StudyPlanStatistics {
  // 时间相关
  averageDailyStudyMinutes: number;
  timeProgressPercentage: number;    // 时间进度 (已过天数/总天数)
  actualProgressPercentage: number;  // 实际完成进度 (已完成单词/总单词)

  // 学习效果
  averageAccuracyRate: number;       // 平均练习正确率
  overdueRatio: number;              // 逾期比率 (逾期天数/总天数)

  // 详细数据
  totalDays: number;
  completedDays: number;
  overdueDays: number;
  totalWords: number;
  completedWords: number;
  totalStudyMinutes: number;
}

/// 学习记录
export interface StudySession {
  id: number;
  planId: number;
  studyDate: string;
  wordsStudied: number;
  wordsCompleted: number;
  studyTimeMinutes: number;
  accuracyRate: number;
  createdAt: string;
  updatedAt: string;
}

/// 创建带AI规划的学习计划请求
export interface CreateStudyPlanWithScheduleRequest {
  name: string;
  description: string;
  intensityLevel: IntensityLevel;
  studyPeriodDays: number;
  reviewFrequency: number;
  startDate: string;
  endDate: string;
  aiPlanData: string; // JSON字符串
  wordbookIds: Id[];
  status?: StudyPlanStatus; // "draft" 或 "active"
}

/// 学习计划日程
export interface StudyPlanSchedule {
  id: Id;
  planId: Id;
  dayNumber: number;
  scheduleDate: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/// 学习计划日程单词
export interface StudyPlanScheduleWord {
  id: Id;
  scheduleId: Id;
  wordId: Id;
  wordbookId: Id;
  isReview: boolean;
  reviewCount?: number;
  priority: 'high' | 'medium' | 'low';
  difficultyLevel: number;
  createdAt: Timestamp;
}

// ==================== 状态管理相关类型 ====================

/// 学习计划状态变更历史
export interface StudyPlanStatusHistory {
  id: Id;
  planId: Id;
  fromStatus?: string;
  toStatus: string;
  fromLifecycleStatus?: string;
  toLifecycleStatus: string;
  changedAt: Timestamp;
  reason?: string;
}

/// 状态转换请求
export interface StatusTransitionRequest {
  planId: Id;
  reason?: string;
}

/// 状态转换响应
export interface StatusTransitionResponse {
  success: boolean;
  newStatus: string;
  newLifecycleStatus: string;
  message: string;
}

// ==================== 统一状态管理工具函数 ====================

/// 状态显示信息
export interface StatusDisplayInfo {
  text: string;
  color: string;
  icon: string;
}

/// 获取状态显示信息
export const getStatusDisplay = (status: UnifiedStudyPlanStatus): StatusDisplayInfo => {
  switch (status) {
    case 'Draft': return { text: '草稿', color: 'gray', icon: 'edit' };
    case 'Pending': return { text: '待开始', color: 'blue', icon: 'clock' };
    case 'Active': return { text: '进行中', color: 'green', icon: 'play' };
    case 'Paused': return { text: '已暂停', color: 'orange', icon: 'pause' };
    case 'Completed': return { text: '已完成', color: 'green', icon: 'check' };
    case 'Terminated': return { text: '已终止', color: 'red', icon: 'stop' };
    case 'Deleted': return { text: '已删除', color: 'gray', icon: 'trash' };
  }
};

/// 可用操作类型
export type StudyPlanAction =
  | 'edit'           // 编辑
  | 'publish'        // 发布
  | 'start'          // 开始
  | 'pause'          // 暂停
  | 'resume'         // 恢复
  | 'complete'       // 完成
  | 'terminate'      // 终止
  | 'restart'        // 重新开始
  | 'delete'         // 删除
  | 'restore'        // 恢复
  | 'permanentDelete'; // 永久删除

/// 获取可用操作
export const getAvailableActions = (status: UnifiedStudyPlanStatus): StudyPlanAction[] => {
  switch (status) {
    case 'Draft':
      return ['edit', 'publish', 'delete'];
    case 'Pending':
      return ['start', 'edit', 'delete'];
    case 'Active':
      return ['pause', 'complete', 'terminate', 'edit'];
    case 'Paused':
      return ['resume', 'terminate', 'edit'];
    case 'Completed':
    case 'Terminated':
      return ['restart', 'delete'];
    case 'Deleted':
      return ['restore', 'permanentDelete'];
    default:
      return [];
  }
};

/// 检查状态转换是否合法
export const canTransitionTo = (from: UnifiedStudyPlanStatus, to: UnifiedStudyPlanStatus): boolean => {
  switch (from) {
    case 'Draft':
      return ['Pending', 'Deleted'].includes(to);
    case 'Pending':
      return ['Active', 'Draft', 'Deleted'].includes(to);
    case 'Active':
      return ['Paused', 'Completed', 'Terminated', 'Draft'].includes(to);
    case 'Paused':
      return ['Active', 'Terminated', 'Draft'].includes(to);
    case 'Completed':
    case 'Terminated':
      return ['Draft'].includes(to);
    case 'Deleted':
      return false; // 删除状态不能转换到其他状态，需要恢复操作
    default:
      return false;
  }
};

/// 从旧的双状态系统转换到新的统一状态
export const convertLegacyStatus = (
  status: LegacyStudyPlanStatus,
  lifecycleStatus: LegacyStudyPlanLifecycleStatus
): UnifiedStudyPlanStatus => {
  if (status === 'deleted') return 'Deleted';
  if (status === 'draft') return 'Draft';

  // status === 'normal'
  switch (lifecycleStatus) {
    case 'pending': return 'Pending';
    case 'active': return 'Active';
    case 'completed': return 'Completed';
    case 'terminated': return 'Terminated';
    default: return 'Draft';
  }
};

/// 统一状态转换请求
export interface UnifiedStatusTransitionRequest {
  planId: Id;
  targetStatus: UnifiedStudyPlanStatus;
  reason?: string;
}

/// 统一状态转换响应
export interface UnifiedStatusTransitionResponse {
  success: boolean;
  newStatus: UnifiedStudyPlanStatus;
  message: string;
}

/// 状态显示配置
export interface StatusDisplayConfig {
  label: string;
  color: 'green' | 'blue' | 'orange' | 'red' | 'gray';
  icon: string;
}

/// 状态过滤选项
export interface StatusFilterOption {
  value: string;
  label: string;
  count?: number;
}
