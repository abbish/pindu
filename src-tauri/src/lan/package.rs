//! 素材包（pindu-package v1）：设备之间传送的业务数据格式，与传输方式无关。
//!
//! 一个素材包 = 这份 manifest + 若干文件（视频、封面、波形…）。manifest 只放业务数据，**不含本机数据库编号**：
//! 对象之间用包内引用 `ref`（如 "wb1" "w12"），文件用 `fileId`；接收方导入时换成新建的编号（每次传送都是新的一份）。
//! 字段与已有的业务类型一致（短文句子、题组参数、字幕、切分规划、句子分析、单词卡直接复用）。
//! 设计见 `.claude/work/lan-pairing/transfer-protocol.md`。

use crate::services::subtitle::Cue;
use crate::types::material::WordCard;
use crate::types::passage::{PassageSentence, QuestionSetSpec, SentenceAnalysis};
use crate::types::video::VideoPlan;
use crate::types::wordbook::WordExample;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const FORMAT: &str = "pindu-package";
/// 格式版本：格式不兼容时加一；接收方只接受 ≤ 自己支持的版本
pub const VERSION: u32 = 1;

/// 上限（防止异常数据拖垮接收方）
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_FILES: usize = 10_000;
pub const MAX_OBJECTS: usize = 200_000;
/// 单个文件与全部文件的大小上限（一次传送；原始视频可能很大）
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub app: AppInfo,
    #[serde(default)]
    pub created_at: String,
    /// 用户选中的对象（摘要用）；其余是依赖
    #[serde(default)]
    pub roots: Vec<Root>,
    #[serde(default)]
    pub tags: Vec<PkgTag>,
    #[serde(default)]
    pub word_books: Vec<PkgWordBook>,
    #[serde(default)]
    pub passages: Vec<PkgPassage>,
    #[serde(default)]
    pub word_cards: Vec<WordCard>,
    #[serde(default)]
    pub sentence_analyses: Vec<PkgSentenceAnalysis>,
    #[serde(default)]
    pub videos: Vec<PkgVideo>,
    #[serde(default)]
    pub plans: Vec<PkgPlan>,
    #[serde(default)]
    pub files: Vec<PkgFile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    #[serde(default)]
    pub version: String,
    /// 发送方已执行的迁移数（只用于日志与提示）
    #[serde(default)]
    pub schema: i64,
}

/// kind：word_book / passage / video / clip / plan
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub kind: String,
    #[serde(rename = "ref")]
    pub ref_: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgTag {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgWordBook {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub icon_color: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub words: Vec<PkgWord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgWord {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub word: String,
    #[serde(default)]
    pub meaning: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub ipa: Option<String>,
    #[serde(default)]
    pub syllables: Option<String>,
    #[serde(default)]
    pub phonics_segments: Option<String>,
    #[serde(default)]
    pub part_of_speech: Option<String>,
    #[serde(default)]
    pub pos_abbreviation: Option<String>,
    #[serde(default)]
    pub pos_english: Option<String>,
    #[serde(default)]
    pub pos_chinese: Option<String>,
    #[serde(default)]
    pub phonics_rule: Option<String>,
    #[serde(default)]
    pub analysis_explanation: Option<String>,
    #[serde(default)]
    pub phrase_type: Option<String>,
    #[serde(default)]
    pub separable: bool,
    #[serde(default)]
    pub examples: Vec<WordExample>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPassage {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub title: String,
    #[serde(default)]
    pub scene: Option<String>,
    #[serde(default)]
    pub level: String,
    /// generated / imported（视频片段的短文由 video_clips 推导，这里照样带原值）
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub source_label: Option<String>,
    pub sentences: Vec<PassageSentence>,
    #[serde(default)]
    pub target_words: Vec<PkgTargetWord>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub question_sets: Vec<PkgQuestionSet>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgTargetWord {
    pub word: String,
    /// 同一个包里有这个词时指向它（导入后换成新词的编号），否则为空
    #[serde(default)]
    pub word_ref: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub meaning: Option<String>,
    #[serde(default)]
    pub forms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgQuestionSet {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    /// reading / listening
    pub mode: String,
    pub spec: QuestionSetSpec,
    #[serde(default)]
    pub cloze_distractors: Vec<String>,
    #[serde(default)]
    pub questions: Vec<PkgQuestion>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgQuestion {
    pub kind: String,
    pub stem: String,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub reference_answer: Option<String>,
    #[serde(default)]
    pub rubric: Vec<String>,
    #[serde(default)]
    pub sentence_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgSentenceAnalysis {
    pub sentence: String,
    pub analysis: SentenceAnalysis,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgVideo {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub title: String,
    #[serde(default)]
    pub source_name: String,
    #[serde(default)]
    pub subtitle_name: Option<String>,
    #[serde(default)]
    pub cues: Vec<Cue>,
    #[serde(default)]
    pub subtitle_offset_ms: i64,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub plan_suggestions: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub plans: Vec<PkgVideoPlan>,
    /// 视频目录里的文件：相对路径（source.mp4 / proxy.mp4 / cover.jpg / peaks.json / thumbs/… / clips/…）→ fileId
    #[serde(default)]
    pub files: Vec<PkgVideoFile>,
    /// 原始视频与编辑用的代理文件（相对路径）；不带原始视频时为空
    #[serde(default)]
    pub source_file: Option<String>,
    #[serde(default)]
    pub media_file: Option<String>,
    #[serde(default)]
    pub clips: Vec<PkgClip>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgVideoPlan {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    pub plan: VideoPlan,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgVideoFile {
    pub path: String,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgClip {
    pub passage_ref: String,
    pub seq: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default)]
    pub plan_ref: Option<String>,
    /// 视频目录里的相对路径（在 files 里）
    pub file: String,
    #[serde(default)]
    pub poster: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPlan {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// words / passages / both
    pub practice_content: String,
    #[serde(default)]
    pub daily_new_words: Option<i64>,
    #[serde(default)]
    pub passage_interval_days: i64,
    /// 学习顺序（按顺序排进新词日）
    #[serde(default)]
    pub words: Vec<PkgPlanWord>,
    #[serde(default)]
    pub passage_tasks: Vec<PkgPlanPassage>,
    /// 「连同进度」时有（见 transfer-protocol.md §1.2）
    #[serde(default)]
    pub progress: Option<PkgProgress>,
}

/// 计划的学习进度（「连同进度」）：接收方原样恢复，编号全部换成新的。时刻保持 UTC 规范格式
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgProgress {
    /// unified_status（Pending / Active / Paused / Completed / Terminated）
    pub status: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub actual_start_date: Option<String>,
    #[serde(default)]
    pub actual_end_date: Option<String>,
    #[serde(default)]
    pub actual_terminated_date: Option<String>,
    #[serde(default)]
    pub intensity_level: Option<String>,
    #[serde(default)]
    pub study_period_days: Option<i64>,
    #[serde(default)]
    pub review_frequency: Option<i64>,
    #[serde(default)]
    pub mastery_level: i64,
    /// 日程 JSON（StudyPlanAIResult），单词编号换成包内引用
    #[serde(default)]
    pub ai_plan_data: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub schedules: Vec<PkgSchedule>,
    #[serde(default)]
    pub word_states: Vec<PkgWordState>,
    #[serde(default)]
    pub sessions: Vec<PkgSession>,
    /// 日历上的学习记录（study_sessions）
    #[serde(default)]
    pub study_records: Vec<PkgStudyRecord>,
    /// 与 PkgPlan.passage_tasks 一一对应
    #[serde(default)]
    pub passage_tasks: Vec<PkgPassageTaskState>,
    #[serde(default)]
    pub attempts: Vec<PkgAttempt>,
    #[serde(default)]
    pub history: Vec<PkgStatusChange>,
    /// 计划里的跟读评估（pronunciation_attempts）
    #[serde(default)]
    pub pronunciation: Vec<PkgPronunciation>,
}

/// 一次跟读评估：单词 / 短文按包内引用，会话按 `sessions` 里的序号
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPronunciation {
    #[serde(default)]
    pub session: Option<usize>,
    pub source: String,
    #[serde(default)]
    pub word_ref: Option<String>,
    #[serde(default)]
    pub passage_ref: Option<String>,
    pub text: String,
    pub score: i64,
    /// 逐词逐音 JSON（不含编号）
    pub detail: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgSchedule {
    pub day: i64,
    pub date: String,
    pub status: String,
    pub new_words_count: i64,
    pub review_words_count: i64,
    pub total_words_count: i64,
    pub completed_words_count: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    pub words: Vec<PkgScheduleWord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgScheduleWord {
    pub word_ref: String,
    pub review: bool,
    #[serde(default)]
    pub review_count: Option<i64>,
    pub priority: String,
    pub difficulty: i64,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgWordState {
    pub word_ref: String,
    pub learned: bool,
    pub correct_count: i64,
    pub total_attempts: i64,
    #[serde(default)]
    pub last_studied: Option<String>,
    #[serde(default)]
    pub next_review: Option<String>,
    pub mastery_score: f64,
    pub srs_box: i64,
    #[serde(default)]
    pub srs_due: Option<String>,
    #[serde(default)]
    pub srs_last: Option<String>,
    pub srs_lapses: i64,
    pub srs_reviews: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgSession {
    /// 属于哪天的日程（day_number）
    pub day: i64,
    pub schedule_date: String,
    pub start_time: String,
    #[serde(default)]
    pub end_time: Option<String>,
    pub total_time: i64,
    pub active_time: i64,
    pub pause_count: i64,
    pub completed: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub pauses: Vec<PkgPause>,
    #[serde(default)]
    pub records: Vec<PkgRecord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPause {
    pub start: String,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgRecord {
    pub word_ref: String,
    pub step: i64,
    pub user_input: String,
    pub correct: bool,
    pub time_spent: i64,
    pub attempts: i64,
    pub kind: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgStudyRecord {
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
    pub words_studied: i64,
    pub correct_answers: i64,
    pub total_time_seconds: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPassageTaskState {
    pub scheduled_date: String,
    #[serde(default)]
    pub completed_at: Option<String>,
    /// 完成它的那次作答（attempts 里的下标）
    #[serde(default)]
    pub attempt: Option<usize>,
    #[serde(default)]
    pub created_at: String,
}

/// 计划里的一次短文作答。answers 与作答记录的 JSON 相同，只是 clozeResults / questionResults 里的
/// questionId 换成了题目在题组里的顺序（0 起）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgAttempt {
    pub passage_ref: String,
    pub set_ref: String,
    /// 属于哪天的日程（没有为空）
    #[serde(default)]
    pub day: Option<i64>,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub answers: Option<serde_json::Value>,
    pub objective_correct: i64,
    pub objective_total: i64,
    #[serde(default)]
    pub open_score: Option<i64>,
    #[serde(default)]
    pub open_total: Option<i64>,
    pub active_time: i64,
    pub started_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgStatusChange {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub from_lifecycle: Option<String>,
    #[serde(default)]
    pub to_lifecycle: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPlanWord {
    pub word_ref: String,
    #[serde(default = "default_difficulty")]
    pub difficulty: i32,
    #[serde(default = "default_priority")]
    pub priority: String,
}

fn default_difficulty() -> i32 {
    1
}
fn default_priority() -> String {
    "medium".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgPlanPassage {
    pub passage_ref: String,
    #[serde(default)]
    pub set_ref: Option<String>,
    pub mode: String,
}

/// kind：video / image / json
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PkgFile {
    pub id: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub kind: String,
}

/// 给接收方看的摘要
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageSummary {
    pub word_books: usize,
    pub words: usize,
    pub passages: usize,
    pub videos: usize,
    pub clips: usize,
    pub plans: usize,
    pub with_progress: bool,
    pub with_source_video: bool,
    pub total_bytes: u64,
    pub file_count: usize,
    /// 用户选中的对象标题（最多 20 个）
    pub titles: Vec<String>,
}

impl Package {
    pub fn summary(&self) -> PackageSummary {
        let titles = self
            .roots
            .iter()
            .filter_map(|r| self.title_of(&r.kind, &r.ref_))
            .take(20)
            .collect();
        PackageSummary {
            word_books: self.word_books.len(),
            words: self.word_books.iter().map(|b| b.words.len()).sum(),
            passages: self
                .passages
                .len()
                .saturating_sub(self.videos.iter().map(|v| v.clips.len()).sum()),
            videos: self.videos.len(),
            clips: self.videos.iter().map(|v| v.clips.len()).sum(),
            plans: self.plans.len(),
            with_progress: self.plans.iter().any(|p| p.progress.is_some()),
            with_source_video: self.videos.iter().any(|v| v.source_file.is_some()),
            // 校验过的包不会溢出（单个文件与总量都有上限）；没校验的也不会因为溢出崩溃
            total_bytes: self
                .files
                .iter()
                .fold(0u64, |n, f| n.saturating_add(f.size)),
            file_count: self.files.len(),
            titles,
        }
    }

    fn title_of(&self, kind: &str, r: &str) -> Option<String> {
        match kind {
            "word_book" => self
                .word_books
                .iter()
                .find(|b| b.ref_ == r)
                .map(|b| b.title.clone()),
            "passage" | "clip" => self
                .passages
                .iter()
                .find(|p| p.ref_ == r)
                .map(|p| p.title.clone()),
            "video" => self
                .videos
                .iter()
                .find(|v| v.ref_ == r)
                .map(|v| v.title.clone()),
            "plan" => self
                .plans
                .iter()
                .find(|p| p.ref_ == r)
                .map(|p| p.name.clone()),
            _ => None,
        }
    }

    /// 结构校验：格式与版本、数量上限、引用都能找到、文件表完整、视频里的相对路径安全
    pub fn validate(&self) -> Result<(), String> {
        if self.format != FORMAT {
            return Err("不是拼读的素材包".into());
        }
        if self.version == 0 || self.version > VERSION {
            return Err("素材包来自更新版本的拼读，请先更新这台电脑上的拼读".into());
        }
        let objects = self
            .word_books
            .iter()
            .map(|b| b.words.len() + 1)
            .sum::<usize>()
            + self.passages.len()
            + self.videos.len()
            + self.plans.len()
            + self.word_cards.len()
            + self.sentence_analyses.len()
            + self
                .plans
                .iter()
                .map(|p| p.words.len() + p.progress.as_ref().map_or(0, progress_entries))
                .sum::<usize>();
        if objects > MAX_OBJECTS || self.files.len() > MAX_FILES {
            return Err("素材包太大，请分几次传送".into());
        }
        let mut total = 0u64;
        for f in &self.files {
            total = total
                .checked_add(f.size)
                .filter(|t| f.size <= MAX_FILE_BYTES && *t <= MAX_TOTAL_BYTES)
                .ok_or("素材包里的文件太大，请分几次传送")?;
        }

        let mut refs = HashSet::new();
        let mut unique = |r: &str| -> Result<(), String> {
            if r.is_empty() || r.len() > 64 || !refs.insert(r.to_string()) {
                return Err(format!("素材包里的引用重复或无效：{r}"));
            }
            Ok(())
        };
        let tags: HashSet<&str> = self.tags.iter().map(|t| t.ref_.as_str()).collect();
        for t in &self.tags {
            unique(&t.ref_)?;
        }
        let mut words = HashSet::new();
        for b in &self.word_books {
            unique(&b.ref_)?;
            for w in &b.words {
                unique(&w.ref_)?;
                words.insert(w.ref_.as_str());
                if w.word.trim().is_empty() {
                    return Err("词汇本里有空的单词".into());
                }
            }
        }
        let mut sets = HashSet::new();
        let mut passages = HashSet::new();
        for p in &self.passages {
            unique(&p.ref_)?;
            passages.insert(p.ref_.as_str());
            if p.sentences.is_empty() {
                return Err(format!("短文「{}」没有内容", p.title));
            }
            for qs in &p.question_sets {
                unique(&qs.ref_)?;
                sets.insert((p.ref_.as_str(), qs.ref_.as_str()));
                if qs.mode != "reading" && qs.mode != "listening" {
                    return Err("题组的方式不对".into());
                }
            }
        }
        let files: HashSet<&str> = self.files.iter().map(|f| f.id.as_str()).collect();
        // 不区分大小写也不能重复（macOS / Windows 的磁盘通常不区分大小写，会写到同一个文件）
        let lower: HashSet<String> = self
            .files
            .iter()
            .map(|f| f.id.to_ascii_lowercase())
            .collect();
        if files.len() != self.files.len() || lower.len() != self.files.len() {
            return Err("素材包的文件表重复".into());
        }
        let mut used_files = HashSet::new();
        for f in &self.files {
            if !safe_file_id(&f.id) {
                return Err("素材包的文件编号不对".into());
            }
            if f.sha256.len() != 64 || !f.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("素材包的文件校验码格式不对".into());
            }
        }
        let mut clip_passages = HashSet::new();
        for v in &self.videos {
            unique(&v.ref_)?;
            let mut plans = HashSet::new();
            for vp in &v.plans {
                unique(&vp.ref_)?;
                plans.insert(vp.ref_.as_str());
            }
            let mut paths = HashSet::new();
            let mut lower_paths = HashSet::new();
            for f in &v.files {
                if !safe_video_path(&f.path)
                    || !paths.insert(f.path.as_str())
                    || !lower_paths.insert(f.path.to_ascii_lowercase())
                {
                    return Err(format!("视频文件路径不安全：{}", f.path));
                }
                if !files.contains(f.file.as_str()) {
                    return Err("视频文件不在文件表里".into());
                }
                // 一个文件只能放到一个位置（导入时是移动过去的）
                if !used_files.insert(f.file.as_str()) {
                    return Err("视频文件被重复引用".into());
                }
            }
            for p in [&v.source_file, &v.media_file].into_iter().flatten() {
                if !paths.contains(p.as_str()) {
                    return Err("视频的原始文件不在文件表里".into());
                }
            }
            for c in &v.clips {
                if !passages.contains(c.passage_ref.as_str())
                    || !clip_passages.insert(c.passage_ref.as_str())
                {
                    return Err("场景片段对应的短文不对".into());
                }
                if c.plan_ref.as_deref().is_some_and(|r| !plans.contains(r)) {
                    return Err("场景片段的规划不存在".into());
                }
                if !paths.contains(c.file.as_str())
                    || c.poster.as_deref().is_some_and(|p| !paths.contains(p))
                {
                    return Err("场景片段的文件不在文件表里".into());
                }
            }
            if v.media_file.is_none() && v.clips.is_empty() {
                return Err(format!("视频「{}」既没有原始视频也没有场景片段", v.title));
            }
        }
        for p in &self.passages {
            for t in &p.tags {
                if !tags.contains(t.as_str()) {
                    return Err("标签引用不存在".into());
                }
            }
            for tw in &p.target_words {
                if tw.word_ref.as_deref().is_some_and(|r| !words.contains(r)) {
                    return Err("短文的词汇引用不存在".into());
                }
            }
        }
        for v in &self.videos {
            for t in &v.tags {
                if !tags.contains(t.as_str()) {
                    return Err("标签引用不存在".into());
                }
            }
        }
        for b in &self.word_books {
            for t in &b.tags {
                if !tags.contains(t.as_str()) {
                    return Err("标签引用不存在".into());
                }
            }
        }
        for plan in &self.plans {
            unique(&plan.ref_)?;
            if !["words", "passages", "both"].contains(&plan.practice_content.as_str()) {
                return Err("学习计划的练习内容不对".into());
            }
            for w in &plan.words {
                if !words.contains(w.word_ref.as_str()) {
                    return Err("学习计划的单词不在素材包里".into());
                }
            }
            if let Some(pr) = &plan.progress {
                if !["Pending", "Active", "Paused", "Completed", "Terminated"]
                    .contains(&pr.status.as_str())
                {
                    return Err("学习计划的状态不对".into());
                }
                let in_plan: HashSet<&str> =
                    plan.words.iter().map(|w| w.word_ref.as_str()).collect();
                let word_ok = |r: &str| in_plan.contains(r);
                let days: HashSet<i64> = pr.schedules.iter().map(|s| s.day).collect();
                if days.len() != pr.schedules.len() {
                    return Err("学习计划的日程重复".into());
                }
                if pr
                    .schedules
                    .iter()
                    .flat_map(|s| &s.words)
                    .any(|w| !word_ok(&w.word_ref))
                    || pr.word_states.iter().any(|w| !word_ok(&w.word_ref))
                    || pr
                        .sessions
                        .iter()
                        .flat_map(|s| &s.records)
                        .any(|r| !word_ok(&r.word_ref))
                {
                    return Err("学习进度里的单词不在计划里".into());
                }
                if pr.sessions.iter().any(|s| !days.contains(&s.day))
                    || pr
                        .attempts
                        .iter()
                        .any(|a| a.day.is_some_and(|d| !days.contains(&d)))
                {
                    return Err("学习进度里的日程不存在".into());
                }
                if pr.passage_tasks.len() != plan.passage_tasks.len()
                    || pr
                        .passage_tasks
                        .iter()
                        .any(|t| t.attempt.is_some_and(|i| i >= pr.attempts.len()))
                {
                    return Err("学习进度里的短文任务不对".into());
                }
                if pr
                    .attempts
                    .iter()
                    .any(|a| !sets.contains(&(a.passage_ref.as_str(), a.set_ref.as_str())))
                {
                    return Err("学习进度里的短文作答对应的题组不存在".into());
                }
            }
            for t in &plan.passage_tasks {
                if !passages.contains(t.passage_ref.as_str()) {
                    return Err("学习计划的短文不在素材包里".into());
                }
                if let Some(s) = &t.set_ref {
                    if !sets.contains(&(t.passage_ref.as_str(), s.as_str())) {
                        return Err("学习计划的题组不在素材包里".into());
                    }
                }
            }
        }
        Ok(())
    }
}

/// 学习进度里的条目数（计入素材包的对象上限）
fn progress_entries(p: &PkgProgress) -> usize {
    p.schedules.iter().map(|s| s.words.len() + 1).sum::<usize>()
        + p.word_states.len()
        + p.sessions
            .iter()
            .map(|s| s.records.len() + s.pauses.len() + 1)
            .sum::<usize>()
        + p.study_records.len()
        + p.passage_tasks.len()
        + p.attempts.len()
        + p.history.len()
        + p.pronunciation.len()
}

/// 文件编号：接收方直接拿它当临时文件名，只允许字母、数字、- 和 _（不能带路径）
pub fn safe_file_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 视频目录里允许的相对路径：固定文件名，或 thumbs/、clips/ 下的单层文件名（不含 .. 与路径分隔符）
pub fn safe_video_path(path: &str) -> bool {
    let name_ok = |n: &str| {
        !n.is_empty()
            && n.len() <= 128
            && n != "."
            && n != ".."
            && n.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match path.split_once('/') {
        None => {
            matches!(path, "cover.jpg" | "peaks.json" | "proxy.mp4")
                || (path.starts_with("source.") && name_ok(path))
        }
        Some((dir, name)) => {
            (dir == "thumbs" || dir == "clips") && !name.contains('/') && name_ok(name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_paths_must_stay_inside_the_video_folder() {
        for ok in [
            "source.mp4",
            "proxy.mp4",
            "cover.jpg",
            "peaks.json",
            "thumbs/thumb_0001.jpg",
            "clips/2-abc.mp4",
        ] {
            assert!(safe_video_path(ok), "{ok}");
        }
        for bad in [
            "../x",
            "clips/../x",
            "clips/a/b.mp4",
            "/etc/passwd",
            "other.mp4",
            "thumbs/",
            "source./x",
            "clips/..",
            "clips\\..\\x",
        ] {
            assert!(!safe_video_path(bad), "{bad}");
        }
    }

    #[test]
    fn file_ids_cannot_escape_the_incoming_folder() {
        for bad in ["", "../x", "a/b", "..", "f\\1", &"f".repeat(40)] {
            assert!(!safe_file_id(bad), "{bad}");
        }
        assert!(safe_file_id("f12") && safe_file_id("a-b_c"));
        let p = Package {
            format: FORMAT.into(),
            version: VERSION,
            files: vec![PkgFile {
                id: "../../evil".into(),
                size: 1,
                sha256: "0".repeat(64),
                kind: "json".into(),
            }],
            ..Default::default()
        };
        assert!(p.validate().unwrap_err().contains("文件编号"));
    }

    #[test]
    fn rejects_newer_versions_and_dangling_refs() {
        let mut p = Package {
            format: FORMAT.into(),
            version: VERSION,
            ..Default::default()
        };
        assert!(p.validate().is_ok());
        p.version = VERSION + 1;
        assert!(p.validate().is_err());
        p.version = VERSION;
        p.plans.push(PkgPlan {
            ref_: "p1".into(),
            name: "x".into(),
            practice_content: "words".into(),
            words: vec![PkgPlanWord {
                word_ref: "w9".into(),
                difficulty: 1,
                priority: "medium".into(),
            }],
            ..Default::default()
        });
        assert!(p.validate().unwrap_err().contains("单词"));
    }
}
