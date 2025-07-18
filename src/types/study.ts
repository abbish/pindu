import { Id, Timestamp } from './common';

/// 学习计划
export interface StudyPlan {
  id: Id;
  name: string;
  description: string;
  status: StudyPlanStatus;
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
  ai_plan_data?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/// 带进度的学习计划
export interface StudyPlanWithProgress extends StudyPlan {
  progress_percentage: number;
}

/// 学习计划状态
export type StudyPlanStatus = 'active' | 'paused' | 'completed' | 'draft';

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
  mastery_level?: number;
}

/// 学习计划查询参数
export interface StudyPlanQuery {
  status?: StudyPlanStatus;
  keyword?: string;
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
