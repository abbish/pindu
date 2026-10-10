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
    /// 每天新词数（自适应复习计划；旧计划为 null）
    #[serde(default)]
    pub daily_new_words: Option<i32>,
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
    pub status: String,         // 管理状态：normal, draft, deleted (保留用于兼容)
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
    /// 每天新词数（自适应复习计划；旧计划为 null）
    #[serde(default)]
    pub daily_new_words: Option<i32>,
    pub deleted_at: Option<String>, // 软删除时间
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub progress_percentage: f64,
    /// 练习内容：words / passages / both
    #[serde(default = "default_practice_content")]
    pub practice_content: String,
    /// 短文每几天一篇
    #[serde(default = "default_passage_interval")]
    pub passage_interval_days: i64,
    /// 计划里的短文任务数 / 已完成数
    #[serde(default)]
    pub total_passages: i64,
    #[serde(default)]
    pub completed_passages: i64,
}

fn default_practice_content() -> String {
    "words".into()
}

fn default_passage_interval() -> i64 {
    2
}

/// 日程状态
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ScheduleStatus {
    NotStarted, // 未开始
    InProgress, // 进行中
    Completed,  // 已完成
    Overdue,    // 已逾期
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

/// 学习统计
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyStatistics {
    pub total_words_learned: i32,
    pub average_accuracy: f64,
    pub streak_days: i32,
    pub completion_rate: f64,
    pub weekly_progress: Vec<i32>,
}

/// 某个本地日期的学习量（首页学习热力图；只返回有学习的日期）
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct DailyLearningActivity {
    /// 本地日期 `YYYY-MM-DD`
    pub date: String,
    /// 当天练过的单词数：有首次作答（kind = learn）记录的不同单词，含未完成会话
    pub practiced_words: i32,
    /// 当天学会的单词数：当天结束的已完成会话中三步首答全对（口径同 practice_metrics）
    pub mastered_words: i32,
}

// ==================== 单词练习相关类型 ====================

/// 单词练习步骤枚举
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WordPracticeStep {
    Step1 = 1, // 显示完整信息（单词+音标+中文+音节+拼读）
    Step2 = 2, // 隐藏英文原文（音标+中文+音节+拼读）
    Step3 = 3, // 仅中文+音节+拼读+发音
}

/// 序列化为数字 1 / 2 / 3（与前端的数字步骤一致）
impl Serialize for WordPracticeStep {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u8(*self as u8)
    }
}

impl<'de> Deserialize<'de> for WordPracticeStep {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match u8::deserialize(deserializer)? {
            1 => Ok(WordPracticeStep::Step1),
            2 => Ok(WordPracticeStep::Step2),
            3 => Ok(WordPracticeStep::Step3),
            n => Err(serde::de::Error::custom(format!(
                "练习步骤只能是 1–3，收到 {}",
                n
            ))),
        }
    }
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
    /// 例句（按顺序，第一句最简单；可朗读）
    #[serde(default)]
    pub examples: Vec<crate::types::wordbook::WordExample>,
}

/// 单词练习状态
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordPracticeState {
    #[serde(rename = "wordId")]
    pub word_id: i64,
    #[serde(rename = "planWordId")]
    pub plan_word_id: i64, // study_plan_schedule_words 表的 ID
    /// 复习词：只做第三步（听音 + 中文，独立拼写），检验长期记忆（自适应复习，D20）
    #[serde(rename = "isReview", default)]
    pub is_review: bool,
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
    /// 每步答错后重考的次数（不含首次作答）
    #[serde(rename = "retryCounts", default)]
    pub retry_counts: Vec<i32>,
    /// 每步首次答错、之后重考答对（“查”之后改对）
    #[serde(rename = "fixedSteps", default)]
    pub fixed_steps: Vec<bool>,
    /// 当轮小测结果（没做为 null）
    #[serde(rename = "reviewCorrect", default)]
    pub review_correct: Option<bool>,
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

// ==================== AI规划相关类型 ====================

/// 学习计划规划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanScheduleRequest {
    pub name: String,
    pub description: String,
    /// 每天新学的词数（1–50）；周期与复习由系统计算（自适应间隔复习，D20）
    #[serde(default)]
    pub daily_new_words: i32,
    /// 已废弃：由每天新词数推出，保留字段兼容旧前端
    #[serde(default)]
    pub intensity_level: String,
    /// 已废弃：周期 = 学新词天数 + 巩固期
    #[serde(default)]
    pub study_period_days: i32,
    /// 已废弃：复习按记忆等级自适应安排
    #[serde(default)]
    pub review_frequency: i32,
    pub start_date: String,    // YYYY-MM-DD
    pub wordbook_ids: Vec<Id>, // 选择的词汇本ID列表
    pub model_id: Option<i64>, // AI模型ID
    /// 是否用 AI 排学习顺序（默认 true）；false 时按词汇本原顺序、词长估难度，立即完成
    #[serde(default)]
    pub use_ai: Option<bool>,
}

/// AI规划结果的元数据
#[derive(Debug, Default, Serialize, Deserialize)]
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
    /// 每天新词数（自适应复习计划；旧规划没有）
    #[serde(rename = "dailyNewWords", default)]
    pub daily_new_words: Option<i32>,
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

/// 计划日程摘要里的一个单词
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanScheduleWord {
    pub word_id: Id,
    pub word: String,
    pub meaning: String,
    /// 复习词（按记忆等级到期加入）
    pub is_review: bool,
}

/// 计划日程摘要（get_study_plan_schedules；今天到期的复习已动态放进今天的日程）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanScheduleSummary {
    pub id: Id,
    /// 本地日历日期 YYYY-MM-DD
    pub schedule_date: String,
    /// 第几天
    pub day: i64,
    /// 日程单词数（新学 + 复习）
    pub word_count: i64,
    pub new_words_count: i64,
    pub review_words_count: i64,
    /// 当次通过的单词数
    pub completed_words_count: i64,
    /// 日程已练完
    pub completed: bool,
    /// 当天的单词：复习在前、新学在后
    pub words: Vec<PlanScheduleWord>,
}

/// 创建带AI规划的学习计划请求
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateStudyPlanWithScheduleRequest {
    pub name: String,
    pub description: String,
    /// 已废弃：保存时以日程元数据为准，前端不再发送
    #[serde(default)]
    pub intensity_level: String,
    /// 已废弃：同上
    #[serde(default)]
    pub study_period_days: i32,
    /// 已废弃：复习按记忆等级自适应安排
    #[serde(default)]
    pub review_frequency: i32,
    pub start_date: String,
    pub end_date: String,
    pub ai_plan_data: String, // 日程 JSON 字符串（StudyPlanAIResult）
    pub wordbook_ids: Vec<Id>,
    pub status: Option<String>, // "draft" 或 "active"
    /// 练习内容：words（默认）/ passages / both；只练短文时 ai_plan_data 可为空
    #[serde(default)]
    pub practice_content: Option<String>,
    /// 计划里的短文（顺序即排期顺序）
    #[serde(default)]
    pub passages: Vec<crate::types::passage::PlanPassageInput>,
    /// 短文每几天一篇（默认 2）
    #[serde(default)]
    pub passage_interval_days: Option<i64>,
}

/// 学习计划日程
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanSchedule {
    pub id: Id,
    pub plan_id: Id,
    pub day: i32, // 注意: 数据库字段名是 'day_number'
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

    // 记忆状态（自适应复习，D20）
    /// 记忆等级：0 未学，1–5（≥4 为掌握）
    #[serde(default)]
    pub memory_box: i32,
    /// 下次复习日期（本地 YYYY-MM-DD）
    #[serde(default)]
    pub next_review_date: Option<String>,
    /// 上次练习日期（本地 YYYY-MM-DD）
    #[serde(default)]
    pub last_practiced_date: Option<String>,
    /// 复习答错次数
    #[serde(default)]
    pub lapses: i32,
    /// 复习次数
    #[serde(default)]
    pub reviews: i32,
    /// 安排学新词的日期（本地 YYYY-MM-DD）
    #[serde(default)]
    pub learn_date: Option<String>,
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
    /// 当天的短文任务数 / 其中已完成的
    #[serde(default)]
    pub passage_tasks: i32,
    #[serde(default)]
    pub passage_completed: i32,
    /// 当天的短文任务明细（日历选中某天时列出）
    #[serde(default)]
    pub passages: Vec<CalendarPassageTask>,
}

/// 日历某天的一项短文任务
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarPassageTask {
    pub plan_id: i64,
    pub plan_name: String,
    pub passage_id: i64,
    pub title: String,
    /// 题组；为空表示只朗读
    pub set_id: Option<i64>,
    /// reading / listening
    pub mode: String,
    /// 视频切片（只读任务即「看视频跟读」）
    pub is_video: bool,
    pub completed: bool,
    /// 计划状态（与 CalendarStudyPlan 同一种取值）：只有待开始 / 进行中的计划能练
    pub unified_status: StudyPlanLifecycleStatus,
}

/// 日历中的学习计划信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarStudyPlan {
    pub plan_id: i64,
    pub plan_name: String,
    /// 当天这个计划的日程（月视图可直接据此进入练习）
    pub schedule_id: i64,
    pub unified_status: StudyPlanLifecycleStatus,
    /// 这个日程已练完
    #[serde(default)]
    pub practiced: bool,
    /// 有练了一半的练习
    #[serde(default)]
    pub in_progress: bool,
    #[serde(default)]
    pub new_words_count: i32,
    #[serde(default)]
    pub review_words_count: i32,
    #[serde(default)]
    pub total_words_count: i32,
    /// 已掌握（当次通过）的单词数
    #[serde(default)]
    pub completed_words_count: i32,
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
    pub overdue_ratio: f64,         // 逾期比率 (逾期日程数/日程数)
    pub streak_days: i32,           // 该计划的连续练习天数

    // 详细数据
    /// 日程天数（学习日）；没有日程时为计划的自然天数
    pub total_days: i64,
    /// 已练完的日程数（与日历“完成”同一口径）
    pub completed_days: i64,
    /// 逾期日程数：日期已过、没练，且计划仍在进行（进行中 / 待开始）
    pub overdue_days: i64,
    pub total_words: i64,
    /// 已掌握的单词数（记忆等级 ≥ 4）
    pub completed_words: i64,
    /// 已学的单词数（完成过一次含该词的练习，记忆等级 ≥ 1）
    pub learned_words: i64,
    pub total_study_minutes: i64,
}

// ==================== 状态管理相关类型 ====================

/// 学习计划状态变更历史
#[derive(Debug, Serialize, Deserialize)]
#[cfg(test)]
pub struct StudyPlanStatusHistory {
    pub id: Id,
    pub plan_id: Id,
    pub from_status: Option<String>,
    pub to_status: String,
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
    pub status: String, // completed, in-progress, overdue（过期待补）, not-started
    pub can_start_practice: bool,
    /// 过期待补的日程：这个计划没练的过期日程数（含本条）；今天的日程为 0
    pub overdue_count: i32,
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

// ==================== 服务层内部写入参数（不经 IPC） ====================

/// 一次单词步骤作答
#[derive(Debug, Clone)]
pub struct PracticeStepRecord {
    pub session_id: String,
    pub word_id: Id,
    pub plan_word_id: Id,
    /// 1..=3
    pub step: i32,
    pub user_input: String,
    pub is_correct: bool,
    /// 毫秒
    pub time_spent: i64,
    pub attempts: i32,
    /// learn（每步首次作答）/ retry（纠正后重考）/ review（当轮小测）
    pub kind: String,
}

/// 作答记录类型
pub const RECORD_KINDS: [&str; 3] = ["learn", "retry", "review"];

/// 一次完成的学习会话（写入 study_sessions）
#[derive(Debug, Clone)]
pub struct NewStudySession<'a> {
    pub plan_id: Id,
    pub started_at: &'a str,
    pub finished_at: &'a str,
    pub words_studied: i32,
    pub correct_answers: i32,
    pub total_time_seconds: i64,
}

/// 某个记忆等级的单词数
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct MemoryBoxCount {
    /// 记忆等级 1–5（间隔 1 / 3 / 7 / 14 / 30 天）
    pub box_level: i32,
    pub count: i64,
}

/// 计划的记忆概况（自适应复习，D20）
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PlanMemoryOverview {
    pub plan_id: i64,
    /// 计划单词总数
    pub total: i64,
    /// 还没学的（等级 0）
    pub not_started: i64,
    /// 已学过（等级 ≥ 1）
    pub learned: i64,
    /// 已掌握（等级 ≥ 4）
    pub mastered: i64,
    /// 今天到期（含之前到期未练）的复习数
    pub due_today: i64,
    /// 下一次有复习到期的日期（本地日期 YYYY-MM-DD；没有待复习时为 null）
    pub next_due_date: Option<String>,
    /// 等级 1–5 各自的单词数（固定 5 项，按等级升序）
    pub box_counts: Vec<MemoryBoxCount>,
}
