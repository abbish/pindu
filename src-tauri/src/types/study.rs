use super::{Id, Timestamp};
use serde::{Deserialize, Serialize};

/// 学习计划
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlan {
    pub id: Id,
    pub name: String,
    pub description: String,
    pub status: String, // 管理状态：normal, draft, deleted (保留用于兼容)
    pub unified_status: Option<UnifiedStudyPlanStatus>, // 统一状态
    pub total_words: i32,
    pub mastery_level: i32,
    // AI规划相关字段
    pub intensity_level: Option<String>,
    pub study_period_days: Option<i32>,
    pub review_frequency: Option<i32>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub actual_start_date: Option<String>,      // 实际开始时间
    pub actual_end_date: Option<String>,        // 实际完成时间
    pub actual_terminated_date: Option<String>, // 实际终止时间
    pub ai_plan_data: Option<String>,
    pub deleted_at: Option<String>, // 软删除时间
    // 统计字段
    pub total_schedules: Option<i32>,
    pub completed_schedules: Option<i32>,
    pub overdue_schedules: Option<i32>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 带进度的学习计划
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlanWithProgress {
    pub id: Id,
    pub name: String,
    pub description: String,
    pub status: String, // 管理状态：normal, draft, deleted (保留用于兼容)
    #[deprecated(note = "Use unified_status instead")]
    pub lifecycle_status: String, // 生命周期状态：pending, active, completed (已废弃，保留用于兼容)
    pub unified_status: String, // 统一状态：Draft, Pending, Active, Paused, Completed, Terminated, Deleted
    pub total_words: i32,
    pub mastery_level: i32,
    // AI规划相关字段
    pub intensity_level: Option<String>,
    pub study_period_days: Option<i32>,
    pub review_frequency: Option<i32>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub actual_start_date: Option<String>,      // 实际开始时间
    pub actual_end_date: Option<String>,        // 实际完成时间
    pub actual_terminated_date: Option<String>, // 实际终止时间
    pub ai_plan_data: Option<String>,
    pub deleted_at: Option<String>, // 软删除时间
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub progress_percentage: f64,
}

/// 日程状态
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ScheduleStatus {
    NotStarted,  // 未开始
    InProgress,  // 进行中
    Completed,   // 已完成
    Overdue,     // 已逾期
}

/// 单词类型
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum WordType {
    New,      // 新单词
    Review,   // 复习单词
}

/// 学习计划生命周期状态
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum StudyPlanLifecycleStatus {
    Draft,      // 草稿状态
    Pending,    // 待开始（创建后的初始状态）
    Active,     // 进行中（用户手动开始后）
    Paused,     // 已暂停
    Completed,  // 已完成（学习完成）
    Terminated, // 已终止（用户手动终止）
    Deleted,    // 已删除
}

/// 创建学习计划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateStudyPlanRequest {
    pub name: String,
    pub description: String,
    pub word_ids: Vec<Id>,
    pub mastery_level: Option<i32>,
}

/// 学习统计
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyStatistics {
    pub total_words_learned: i32,
    pub average_accuracy: f64,
    pub streak_days: i32,
    pub completion_rate: f64,
    pub weekly_progress: Vec<i32>,
}

// ==================== 单词练习相关类型 ====================

/// 单词练习步骤枚举
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum WordPracticeStep {
    #[serde(rename = "1")]
    Step1 = 1, // 显示完整信息（单词+音标+中文+音节+拼读）
    #[serde(rename = "2")]
    Step2 = 2, // 隐藏英文原文（音标+中文+音节+拼读）
    #[serde(rename = "3")]
    Step3 = 3, // 仅中文+音节+拼读+发音
}


/// 练习单词信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PracticeWordInfo {
    #[serde(rename = "wordId")]
    pub word_id: i64,
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    #[serde(rename = "phonicsSegments")]
    pub phonics_segments: Option<String>,
}

/// 单词练习状态
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordPracticeState {
    #[serde(rename = "wordId")]
    pub word_id: i64,
    #[serde(rename = "planWordId")]
    pub plan_word_id: i64, // study_plan_schedule_words 表的 ID
    #[serde(rename = "wordInfo")]
    pub word_info: PracticeWordInfo, // 完整的单词信息
    #[serde(rename = "currentStep")]
    pub current_step: WordPracticeStep,
    #[serde(rename = "stepResults")]
    pub step_results: Vec<bool>, // 三个步骤的结果 [step1, step2, step3]
    #[serde(rename = "stepAttempts")]
    pub step_attempts: Vec<i32>, // 每个步骤的尝试次数
    #[serde(rename = "stepTimeSpent")]
    pub step_time_spent: Vec<i64>, // 每个步骤的用时（毫秒）
    pub completed: bool, // 三个步骤是否全部完成
    pub passed: bool,    // 三步全对才算通过
    #[serde(rename = "startTime")]
    pub start_time: String, // 开始时间
    #[serde(rename = "endTime")]
    pub end_time: Option<String>, // 结束时间
}

/// 练习会话
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PracticeSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "planId")]
    pub plan_id: i64,
    #[serde(rename = "planTitle")]
    pub plan_title: Option<String>, // 学习计划名称
    #[serde(rename = "scheduleId")]
    pub schedule_id: i64, // 关联的日程ID
    #[serde(rename = "scheduleDate")]
    pub schedule_date: String, // 日程日期
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    #[serde(rename = "totalTime")]
    pub total_time: i64, // 总时间（包含暂停，毫秒）
    #[serde(rename = "activeTime")]
    pub active_time: i64, // 实际练习时间（毫秒）
    #[serde(rename = "pauseCount")]
    pub pause_count: i32, // 暂停次数
    #[serde(rename = "wordStates")]
    pub word_states: Vec<WordPracticeState>,
    pub completed: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// 练习结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PracticeResult {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "planId")]
    pub plan_id: i64,
    #[serde(rename = "scheduleId")]
    pub schedule_id: i64,
    #[serde(rename = "scheduleDate")]
    pub schedule_date: String,
    #[serde(rename = "totalWords")]
    pub total_words: i32,
    #[serde(rename = "passedWords")]
    pub passed_words: i32, // 三步全对的单词数
    #[serde(rename = "totalSteps")]
    pub total_steps: i32, // 总步骤数（单词数 * 3）
    #[serde(rename = "correctSteps")]
    pub correct_steps: i32, // 正确步骤数
    #[serde(rename = "stepAccuracy")]
    pub step_accuracy: f64, // 步骤正确率
    #[serde(rename = "wordAccuracy")]
    pub word_accuracy: f64, // 单词通过率
    #[serde(rename = "totalTime")]
    pub total_time: i64, // 总时间（毫秒）
    #[serde(rename = "activeTime")]
    pub active_time: i64, // 实际练习时间（毫秒）
    #[serde(rename = "pauseCount")]
    pub pause_count: i32,
    #[serde(rename = "averageTimePerWord")]
    pub average_time_per_word: i64, // 平均每个单词用时（毫秒）
    #[serde(rename = "difficultWords")]
    pub difficult_words: Vec<WordPracticeState>, // 未通过的单词
    #[serde(rename = "passedWordsList")]
    pub passed_words_list: Vec<WordPracticeState>, // 通过的单词列表
    #[serde(rename = "completedAt")]
    pub completed_at: String,
}

/// 练习统计数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PracticeStatistics {
    #[serde(rename = "totalSessions")]
    pub total_sessions: i32, // 总练习会话数
    #[serde(rename = "completedSessions")]
    pub completed_sessions: i32, // 已完成会话数
    #[serde(rename = "averageAccuracy")]
    pub average_accuracy: f64, // 平均准确率
    #[serde(rename = "totalPracticeTime")]
    pub total_practice_time: i64, // 总练习时间（毫秒）
    #[serde(rename = "wordsLearned")]
    pub words_learned: i32, // 已学会的单词数
}

// ==================== AI规划相关类型 ====================

/// 学习计划规划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanScheduleRequest {
    pub name: String,
    pub description: String,
    pub intensity_level: String, // "easy", "normal", "intensive"
    pub study_period_days: i32,  // 7, 14, 28
    pub review_frequency: i32,   // 3-5
    pub start_date: String,      // YYYY-MM-DD
    pub wordbook_ids: Vec<Id>,   // 选择的单词本ID列表
    pub model_id: Option<i64>,   // AI模型ID
}

/// 学习计划规划参数（传递给AI的参数）
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanAIParams {
    pub intensity_level: String,
    pub total_words: i32,
    pub period_days: i32,
    pub review_frequency: i32,
    pub start_date: String,
    pub word_list: Vec<StudyWordInfo>,
}

/// 传递给AI的单词信息
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyWordInfo {
    pub word: String,
    pub word_id: String,
    pub wordbook_id: String,
}

/// AI规划结果的元数据
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanMetadata {
    #[serde(rename = "totalWords")]
    pub total_words: i32,
    #[serde(rename = "studyPeriodDays")]
    pub study_period_days: i32,
    #[serde(rename = "intensityLevel")]
    pub intensity_level: String,
    #[serde(rename = "reviewFrequency")]
    pub review_frequency: i32,
    #[serde(rename = "planType")]
    pub plan_type: String,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
}

/// 每日学习计划
#[derive(Debug, Serialize, Deserialize)]
pub struct DailyStudyPlan {
    pub day: i32,
    pub date: String,
    pub words: Vec<DailyStudyWord>,
}

/// 每日学习单词
#[derive(Debug, Serialize, Deserialize)]
pub struct DailyStudyWord {
    #[serde(rename = "wordId")]
    pub word_id: String,
    pub word: String,
    #[serde(rename = "wordbookId")]
    pub wordbook_id: String,
    #[serde(rename = "isReview")]
    pub is_review: bool,
    #[serde(rename = "reviewCount")]
    pub review_count: Option<i32>,
    pub priority: String,
    #[serde(rename = "difficultyLevel")]
    pub difficulty_level: i32,
}

/// AI规划完整结果
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanAIResult {
    #[serde(rename = "planMetadata")]
    pub plan_metadata: StudyPlanMetadata,
    #[serde(rename = "dailyPlans")]
    pub daily_plans: Vec<DailyStudyPlan>,
}

/// 创建带AI规划的学习计划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateStudyPlanWithScheduleRequest {
    pub name: String,
    pub description: String,
    pub intensity_level: String,
    pub study_period_days: i32,
    pub review_frequency: i32,
    pub start_date: String,
    pub end_date: String,
    pub ai_plan_data: String, // JSON字符串
    pub wordbook_ids: Vec<Id>,
    pub status: Option<String>, // "draft" 或 "active"
}

/// 学习计划日程
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanSchedule {
    pub id: Id,
    pub plan_id: Id,
    pub day: i32,  // 注意: 数据库字段名是 'day_number'
    pub schedule_date: String,
    pub new_words_count: i32,
    pub review_words_count: i32,
    pub total_words_count: i32,
    pub completed_words_count: i32,
    // 注意: 以下字段在数据库中不存在，需要计算或从其他地方获取
    pub progress_percentage: Option<i64>,
    pub study_time_minutes: Option<i64>,
    pub status: Option<ScheduleStatus>,
    pub completed: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 学习计划单词（扁平化结构）
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanWord {
    // 基础单词信息
    pub id: Id,
    pub word: String,
    pub meaning: String,
    #[serde(rename = "partOfSpeech")]
    pub part_of_speech: String,
    pub ipa: String,
    pub syllables: String,

    // 学习计划特有字段
    pub plan_id: Id,
    pub schedule_id: Id,
    pub scheduled_date: String,
    pub is_review: bool,
    pub review_count: Option<i32>,
    pub priority: String,
    pub difficulty_level: i32,

    // 进度字段
    pub completed: bool,
    pub completed_at: Option<String>,
    pub study_time_minutes: i64,
    pub correct_attempts: i64,
    pub total_attempts: i64,

    // 关联信息
    pub wordbook_id: Id,
    pub plan_word_id: Id, // study_plan_schedule_words 表的 ID
}

// ==================== 日历相关类型 ====================

/// 日历日期数据
#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarDayData {
    pub date: String,
    pub is_today: bool,
    pub is_in_plan: bool,
    pub status: String, // 'not-started' | 'in-progress' | 'completed' | 'overdue'
    pub new_words_count: i32,
    pub review_words_count: i32,
    pub total_words_count: i32,
    pub completed_words_count: i32,
    pub progress_percentage: f64,
    pub study_time_minutes: Option<i32>,
    pub study_plans: Option<Vec<CalendarStudyPlan>>,
    pub study_sessions: Option<Vec<CalendarStudySession>>,
}

/// 日历中的学习计划信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarStudyPlan {
    pub plan_id: i64,
    pub plan_name: String,
    pub schedule_id: i64,
    pub unified_status: StudyPlanLifecycleStatus,
}

/// 日历中的学习记录信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarStudySession {
    pub session_id: String,
    pub plan_id: i64,
    pub plan_name: String,
    pub words_studied: i64,
    pub study_time_minutes: i64,
    pub accuracy_rate: f64,
    pub completed_at: String,
}

/// 日历月度数据响应
#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarMonthResponse {
    pub year: i32,
    pub month: i32,
    pub days: Vec<CalendarDayData>,
    pub monthly_stats: CalendarMonthlyStats,
}

/// 日历月度统计
#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarMonthlyStats {
    pub total_days: i32,
    pub study_days: i32,
    pub completed_days: i32,
    pub total_words_learned: i32,
    pub total_study_minutes: i32,
    pub average_accuracy: f64,
    pub streak_days: i32,
    pub active_plans_count: i32,
}

/// 学习计划统计数据
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanStatistics {
    // 时间相关
    pub average_daily_study_minutes: i64,
    pub time_progress_percentage: f64, // 时间进度 (已过天数/总天数)
    pub actual_progress_percentage: f64, // 实际完成进度 (已完成单词/总单词)

    // 学习效果
    pub average_accuracy_rate: f64, // 平均练习正确率
    pub overdue_ratio: f64,         // 逾期比率 (逾期天数/总天数)
    pub streak_days: i32,           // 该计划的连续练习天数

    // 详细数据
    pub total_days: i64,
    pub completed_days: i64,
    pub overdue_days: i64,
    pub total_words: i64,
    pub completed_words: i64,
    pub total_study_minutes: i64,
}

// ==================== 状态管理相关类型 ====================

/// 学习计划状态变更历史
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanStatusHistory {
    pub id: Id,
    pub plan_id: Id,
    pub from_status: Option<String>,
    pub to_status: String,
    #[deprecated(note = "Use from_status and to_status instead")]
    pub from_lifecycle_status: Option<String>,
    #[deprecated(note = "Use to_status instead")]
    pub to_lifecycle_status: String,
    pub changed_at: Timestamp,
    pub reason: Option<String>,
}

// ==================== 统一状态管理 ====================

/// 学习计划统一状态（新版本）
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum UnifiedStudyPlanStatus {
    /// 草稿状态 - 刚创建，还未完成配置
    #[serde(rename = "Draft")]
    Draft,
    /// 待开始 - 已配置完成，等待开始学习
    #[serde(rename = "Pending")]
    Pending,
    /// 进行中 - 正在学习
    #[serde(rename = "Active")]
    Active,
    /// 已暂停 - 暂时停止学习
    #[serde(rename = "Paused")]
    Paused,
    /// 已完成 - 学习计划正常完成
    #[serde(rename = "Completed")]
    Completed,
    /// 已终止 - 提前结束学习计划
    #[serde(rename = "Terminated")]
    Terminated,
    /// 已删除 - 软删除状态
    #[serde(rename = "Deleted")]
    Deleted,
}



/// 今日学习日程
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodayStudySchedule {
    pub plan_id: Id,
    pub plan_name: String,
    pub schedule_id: Id,
    pub schedule_date: String,
    pub new_words_count: i32,
    pub review_words_count: i32,
    pub total_words_count: i32,
    pub completed_words_count: i32,
    pub progress_percentage: i32,
    pub status: String, // completed, in-progress, not-started
    pub can_start_practice: bool,
}

/// 数据库表统计信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseTableStats {
    pub table_name: String,
    pub display_name: String,
    pub record_count: i64,
    pub table_type: String, // "config" | "user_data"
    pub description: String,
}

/// 数据库概览信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseOverview {
    pub total_tables: i32,
    pub total_records: i64,
    pub tables: Vec<DatabaseTableStats>,
}

/// 重置操作结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResetResult {
    pub success: bool,
    pub message: String,
    pub deleted_records: i64,
    pub affected_tables: Vec<String>,
}
