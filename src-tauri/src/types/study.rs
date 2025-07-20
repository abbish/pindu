use serde::{Deserialize, Serialize};
use super::{Id, Timestamp};

/// 学习计划
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlan {
    pub id: Id,
    pub name: String,
    pub description: String,
    pub status: String,                    // 管理状态：normal, draft, deleted
    pub lifecycle_status: String,          // 生命周期状态：pending, active, completed
    pub total_words: i32,
    pub learned_words: i32,
    pub accuracy_rate: f64,
    pub mastery_level: i32,
    // AI规划相关字段
    pub intensity_level: Option<String>,
    pub study_period_days: Option<i32>,
    pub review_frequency: Option<i32>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub actual_start_date: Option<String>,     // 实际开始时间
    pub actual_end_date: Option<String>,       // 实际完成时间
    pub actual_terminated_date: Option<String>, // 实际终止时间
    pub ai_plan_data: Option<String>,
    pub deleted_at: Option<String>,        // 软删除时间
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 带进度的学习计划
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlanWithProgress {
    pub id: Id,
    pub name: String,
    pub description: String,
    pub status: String,                    // 管理状态：normal, draft, deleted (保留用于兼容)
    pub lifecycle_status: String,          // 生命周期状态：pending, active, completed (保留用于兼容)
    pub unified_status: String,            // 统一状态：Draft, Pending, Active, Paused, Completed, Terminated, Deleted
    pub total_words: i32,
    pub learned_words: i32,
    pub accuracy_rate: f64,
    pub mastery_level: i32,
    // AI规划相关字段
    pub intensity_level: Option<String>,
    pub study_period_days: Option<i32>,
    pub review_frequency: Option<i32>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub actual_start_date: Option<String>,     // 实际开始时间
    pub actual_end_date: Option<String>,       // 实际完成时间
    pub actual_terminated_date: Option<String>, // 实际终止时间
    pub ai_plan_data: Option<String>,
    pub deleted_at: Option<String>,        // 软删除时间
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub progress_percentage: f64,
}

/// 学习计划管理状态
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum StudyPlanStatus {
    Normal,   // 正常状态（可以开始学习）
    Draft,    // 草稿状态（可以编辑修改）
    Deleted,  // 已删除状态（软删除）
}

/// 学习计划生命周期状态
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum StudyPlanLifecycleStatus {
    Pending,    // 待开始（创建后的初始状态）
    Active,     // 进行中（用户手动开始后）
    Completed,  // 已完成（学习完成）
    Terminated, // 已终止（用户手动终止）
}

/// 学习强度等级
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum IntensityLevel {
    Easy,
    Normal,
    Intensive,
}

/// 创建学习计划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateStudyPlanRequest {
    pub name: String,
    pub description: String,
    pub word_ids: Vec<Id>,
    pub mastery_level: Option<i32>,
}

/// 更新学习计划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateStudyPlanRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status: Option<StudyPlanStatus>,
    pub lifecycle_status: Option<StudyPlanLifecycleStatus>,
    pub mastery_level: Option<i32>,
}

/// 学习计划查询参数
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanQuery {
    pub status: Option<StudyPlanStatus>,
    pub lifecycle_status: Option<StudyPlanLifecycleStatus>,
    pub keyword: Option<String>,
    pub include_deleted: Option<bool>,  // 是否包含已删除的计划
}

/// 学习会话
#[derive(Debug, Serialize, Deserialize)]
pub struct StudySession {
    pub id: Id,
    pub plan_id: Id,
    pub started_at: Timestamp,
    pub finished_at: Option<Timestamp>,
    pub words_studied: i32,
    pub correct_answers: i32,
    pub total_time_seconds: i32,
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

/// 学习进度
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyProgress {
    pub word_id: Id,
    pub plan_id: Id,
    pub learned: bool,
    pub correct_count: i32,
    pub total_attempts: i32,
    pub mastery_score: f64,
    pub last_studied: Option<Timestamp>,
    pub next_review: Option<Timestamp>,
}

/// 提交答案请求
#[derive(Debug, Serialize, Deserialize)]
pub struct SubmitAnswerRequest {
    pub session_id: Id,
    pub word_id: Id,
    pub user_answer: String,
    pub is_correct: bool,
    pub time_spent: i32,
}

/// 结束学习会话请求
#[derive(Debug, Serialize, Deserialize)]
pub struct EndSessionRequest {
    pub session_id: Id,
    pub words_studied: i32,
    pub correct_answers: i32,
    pub total_time: i32,
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
    pub day_number: i32,
    pub schedule_date: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 学习计划日程单词
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanScheduleWord {
    pub id: Id,
    pub schedule_id: Id,
    pub word_id: Id,
    pub wordbook_id: Id,
    pub is_review: bool,
    pub review_count: Option<i32>,
    pub priority: String,
    pub difficulty_level: i32,
    pub created_at: Timestamp,
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

/// 学习计划统计数据
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanStatistics {
    // 时间相关
    pub average_daily_study_minutes: i64,
    pub time_progress_percentage: f64,    // 时间进度 (已过天数/总天数)
    pub actual_progress_percentage: f64,  // 实际完成进度 (已完成单词/总单词)

    // 学习效果
    pub average_accuracy_rate: f64,       // 平均练习正确率
    pub overdue_ratio: f64,              // 逾期比率 (逾期天数/总天数)

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
    pub from_lifecycle_status: Option<String>,
    pub to_lifecycle_status: String,
    pub changed_at: Timestamp,
    pub reason: Option<String>,
}

/// 状态转换请求
#[derive(Debug, Serialize, Deserialize)]
pub struct StatusTransitionRequest {
    pub plan_id: Id,
    pub reason: Option<String>,
}

/// 状态转换响应
#[derive(Debug, Serialize, Deserialize)]
pub struct StatusTransitionResponse {
    pub success: bool,
    pub new_status: String,
    pub new_lifecycle_status: String,
    pub message: String,
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

impl UnifiedStudyPlanStatus {
    /// 检查状态转换是否合法
    pub fn can_transition_to(&self, target: &UnifiedStudyPlanStatus) -> bool {
        use UnifiedStudyPlanStatus::*;
        match (self, target) {
            // 从草稿状态可以转换到
            (Draft, Pending) | (Draft, Deleted) => true,

            // 从待开始状态可以转换到
            (Pending, Active) | (Pending, Draft) | (Pending, Deleted) => true,

            // 从进行中状态可以转换到
            (Active, Paused) | (Active, Completed) | (Active, Terminated) | (Active, Draft) => true,

            // 从暂停状态可以转换到
            (Paused, Active) | (Paused, Terminated) | (Paused, Draft) => true,

            // 从完成/终止状态可以转换到
            (Completed, Draft) | (Terminated, Draft) => true,

            // 任何状态都可以删除
            (_, Deleted) => true,

            // 其他转换都不允许
            _ => false,
        }
    }

    /// 获取状态的显示信息
    pub fn display_info(&self) -> (&'static str, &'static str) {
        match self {
            UnifiedStudyPlanStatus::Draft => ("草稿", "gray"),
            UnifiedStudyPlanStatus::Pending => ("待开始", "blue"),
            UnifiedStudyPlanStatus::Active => ("进行中", "green"),
            UnifiedStudyPlanStatus::Paused => ("已暂停", "orange"),
            UnifiedStudyPlanStatus::Completed => ("已完成", "green"),
            UnifiedStudyPlanStatus::Terminated => ("已终止", "red"),
            UnifiedStudyPlanStatus::Deleted => ("已删除", "gray"),
        }
    }

    /// 从字符串转换
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Draft" => Some(UnifiedStudyPlanStatus::Draft),
            "Pending" => Some(UnifiedStudyPlanStatus::Pending),
            "Active" => Some(UnifiedStudyPlanStatus::Active),
            "Paused" => Some(UnifiedStudyPlanStatus::Paused),
            "Completed" => Some(UnifiedStudyPlanStatus::Completed),
            "Terminated" => Some(UnifiedStudyPlanStatus::Terminated),
            "Deleted" => Some(UnifiedStudyPlanStatus::Deleted),
            _ => None,
        }
    }

    /// 转换为字符串
    pub fn to_string(&self) -> &'static str {
        match self {
            UnifiedStudyPlanStatus::Draft => "Draft",
            UnifiedStudyPlanStatus::Pending => "Pending",
            UnifiedStudyPlanStatus::Active => "Active",
            UnifiedStudyPlanStatus::Paused => "Paused",
            UnifiedStudyPlanStatus::Completed => "Completed",
            UnifiedStudyPlanStatus::Terminated => "Terminated",
            UnifiedStudyPlanStatus::Deleted => "Deleted",
        }
    }
}

/// 从旧的双状态系统转换到新的统一状态
pub fn convert_legacy_status(status: &str, lifecycle_status: &str) -> UnifiedStudyPlanStatus {
    match (status, lifecycle_status) {
        ("deleted", _) => UnifiedStudyPlanStatus::Deleted,
        ("draft", _) => UnifiedStudyPlanStatus::Draft,
        ("normal", "pending") => UnifiedStudyPlanStatus::Pending,
        ("normal", "active") => UnifiedStudyPlanStatus::Active,
        ("normal", "completed") => UnifiedStudyPlanStatus::Completed,
        ("normal", "terminated") => UnifiedStudyPlanStatus::Terminated,
        _ => UnifiedStudyPlanStatus::Draft, // 默认为草稿状态
    }
}

/// 统一状态转换请求
#[derive(Debug, Serialize, Deserialize)]
pub struct UnifiedStatusTransitionRequest {
    pub plan_id: Id,
    pub target_status: UnifiedStudyPlanStatus,
    pub reason: Option<String>,
}

/// 统一状态转换响应
#[derive(Debug, Serialize, Deserialize)]
pub struct UnifiedStatusTransitionResponse {
    pub success: bool,
    pub new_status: UnifiedStudyPlanStatus,
    pub message: String,
}
