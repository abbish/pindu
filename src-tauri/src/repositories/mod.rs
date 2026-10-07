// 数据访问层 - Repository 模式

pub mod ai_model_repository;
pub mod calendar_repository;
#[cfg(debug_assertions)]
pub mod diagnostics_repository;
pub mod passage_repository;
pub mod plan_pace_repository;
pub mod plan_passage_repository;
pub mod practice_metrics;
pub mod practice_repository;
pub mod settings_repository;
pub mod srs_repository;
pub mod statistics_repository;
pub mod study_plan_repository;
pub mod study_schedule_repository;
pub mod theme_tag_repository;
pub mod tts_repository;
pub mod word_explanation_repository;
pub mod word_repository;
pub mod wordbook_repository;

// 导出常用的 Repository 类型
