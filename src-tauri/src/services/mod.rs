//! 业务逻辑服务层
//!
//! Service 层负责:
//! - 业务逻辑封装
//! - 跨 Repository 的协调
//! - 事务管理
//! - 数据验证和转换

pub mod agent_settings;
pub mod ai_model;
pub mod calendar;
#[cfg(debug_assertions)]
pub mod diagnostics;
pub mod log_settings;
pub mod material_settings;
pub mod passage;
pub mod passage_import;
pub mod passage_import_files;
pub mod passage_import_service;
pub mod passage_rules;
pub mod phonics_analysis;
pub mod plan_pace;
pub mod plan_passages;
pub mod practice;
pub mod prompt_profile;
pub mod sentence_analysis;
pub mod sentences;
pub mod srs;
pub mod statistics;
pub mod study_plan;
pub mod study_plan_generation;
pub mod study_planning;
pub mod subtitle;
pub mod tag;
pub mod tts;
pub mod video;
pub mod video_plan;
pub mod video_processing;
pub mod video_translate;
pub mod word;
pub mod word_analysis_job;
pub mod word_cards;
pub mod word_examples;
pub mod word_explanation;
pub mod word_extraction;
pub mod word_forms;
pub mod word_materials;
pub mod word_tutor;
pub mod wordbook;

// 重新导出服务
pub use calendar::*;
pub use practice::*;
pub use word::*;
