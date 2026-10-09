//! 视频库类型（迁移 059；前端 src/types/video.ts）

use crate::services::subtitle::Cue;
use serde::{Deserialize, Serialize};

/// 视频（列表与详情共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: i64,
    pub title: String,
    /// 导入时的视频文件名
    pub source_name: String,
    pub subtitle_name: Option<String>,
    /// 原视频还在（没有删除来释放空间）
    pub has_source: bool,
    /// 编辑器播放的地址（本机媒体服务）；导入完成前为空
    pub media_url: Option<String>,
    /// 封面（一张缩略图的地址）
    pub cover_url: Option<String>,
    pub duration_ms: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size_bytes: i64,
    /// importing / ready / processing / done / failed
    pub status: String,
    pub error: Option<String>,
    pub cue_count: i64,
    pub clip_count: i64,
    /// 字幕时间纠偏（毫秒，正数 = 字幕延后）；详情里的 cues 已按它换算
    pub subtitle_offset_ms: i64,
    /// 标签（列表里有；详情里为空）
    #[serde(default)]
    pub tags: Vec<crate::types::material::Tag>,
    pub created_at: String,
    pub updated_at: String,
}

/// 视频详情：编辑器用
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetail {
    pub video: Video,
    pub cues: Vec<Cue>,
    pub plan: Option<VideoPlan>,
    /// 时间轴缩略图地址（按时间顺序），第 i 张在 i * thumbIntervalMs
    pub thumbs: Vec<String>,
    pub thumb_interval_ms: i64,
    /// 已切出的短片（编辑器标出已处理的片段，点开对应短文）
    pub clips: Vec<VideoClip>,
}

/// 已切出的短片
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoClip {
    pub passage_id: i64,
    pub seq: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// 切分规划（编辑器草稿，自动保存）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlan {
    /// 用户写的切分要求（给 AI 规划用）
    #[serde(default)]
    pub requirements: String,
    #[serde(default)]
    pub segments: Vec<VideoSegment>,
}

/// 规划里的一段
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoSegment {
    /// 前端生成的稳定 id（拖动、撤销用）
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default)]
    pub title: String,
    /// 场景（如「餐厅点餐」）
    #[serde(default)]
    pub scene: String,
    /// CEFR 水平 a1–c1，空表示未定
    #[serde(default)]
    pub level: String,
    /// 学习重点（AI 给的理由 / 用户备注）
    #[serde(default)]
    pub focus: String,
    #[serde(default)]
    pub key_words: Vec<String>,
    /// 标签名（素材共用标签，切分时写进切片短文的标签）
    #[serde(default)]
    pub tags: Vec<String>,
}

/// 导入视频（start_video_import）：文件路径来自系统选择文件对话框
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVideoImportRequest {
    pub video_path: String,
    pub subtitle_path: String,
    /// 另一个语言的字幕（可选，按时间对齐）
    pub second_subtitle_path: Option<String>,
    pub title: Option<String>,
}

/// 导入已提交：视频 id 与任务 id
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoImportStarted {
    pub video_id: i64,
    pub job_id: String,
}

/// AI 规划切分（start_video_plan，后台任务）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVideoPlanRequest {
    pub video_id: i64,
    /// 学习者的切分要求（可空）
    #[serde(default)]
    pub requirements: String,
    pub min_seconds: i64,
    pub max_seconds: i64,
    /// 在当前规划基础上按意见修改（为空时重新规划）
    pub feedback: Option<String>,
}

/// 短文对应的视频短片（短文详情页播放）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageVideo {
    pub video_id: i64,
    pub video_title: String,
    /// 短片与封面的播放地址（本机媒体服务）
    pub clip_url: String,
    pub poster_url: Option<String>,
    /// 在原视频里的起止
    pub start_ms: i64,
    pub end_ms: i64,
}

/// 视频库「片段」：切出来的短片（一段 = 一篇带视频的短文）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    #[serde(flatten)]
    pub passage: crate::types::passage::PassageSummary,
    pub video_id: i64,
    pub video_title: String,
    /// 在原视频里第几段
    pub seq: i64,
    /// 在原视频里的起止
    pub start_ms: i64,
    pub end_ms: i64,
    pub clip_url: Option<String>,
    pub poster_url: Option<String>,
}
