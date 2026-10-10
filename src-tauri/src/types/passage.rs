//! 短文库的类型（DECISIONS D23）：短文（独立素材）、来源、阅读理解题组、作答与统计

use crate::types::common::Id;
use serde::{Deserialize, Serialize};

/// 短文的一句：英文 + 中文翻译
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageSentence {
    pub en: String,
    pub zh: String,
    /// 本句开始一个新段落（导入的材料保留原文分段；AI 写的短文为 false）
    #[serde(default)]
    pub paragraph: bool,
    /// 视频短片：这句在短片里的开始 / 结束（毫秒，相对短片开头）；文字短文为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<i64>,
}

/// 短文用到的目标词
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageTargetWord {
    /// 手动输入的词为 None
    pub word_id: Option<Id>,
    pub word: String,
    /// true = 用户指定必须出现；false = AI 从来源中挑选
    #[serde(default)]
    pub required: bool,
    /// 中文释义（导入材料时 AI 挑的重点词带上；其余为空）
    #[serde(default)]
    pub meaning: Option<String>,
}

/// 短文的来源（创建时的快照）。kind：book 词汇本 / plan 学习计划
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageSource {
    pub kind: String,
    pub ref_id: Id,
    /// 创建时的名称
    pub name: String,
    /// plan 的取词策略（逗号分隔）：wrong / weak / recent / upcoming / mastered / learned
    pub detail: Option<String>,
    /// 来源是否还在（被删除时为 false）
    pub exists: bool,
}

/// 题组的生成参数（各题型数量 + 难度）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSetSpec {
    /// 选词填空空数
    pub cloze: i64,
    /// 选择题
    pub choice: i64,
    /// 判断题
    pub true_false: i64,
    /// 开放题
    pub open: i64,
    /// basic 基础 / standard 标准 / advanced 提高
    pub difficulty: String,
}

/// 题目。kind：cloze 选词填空 / choice 选择 / true_false 判断 / open 开放题
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageQuestion {
    pub id: Id,
    pub kind: String,
    /// cloze：被挖空的词（与原文写法一致）；其它：题干
    pub stem: String,
    /// choice 的选项
    pub options: Vec<String>,
    /// cloze：被挖空的词；choice：正确选项下标；true_false："true" / "false"；open：None
    pub answer: Option<String>,
    pub explanation: Option<String>,
    /// open 的参考答案
    pub reference_answer: Option<String>,
    /// open 的评分要点
    pub rubric: Vec<String>,
    /// cloze：空位所在句子（从 0 开始）
    pub sentence_index: Option<i64>,
}

/// 一次完成的作答（列表用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageAttemptBrief {
    pub id: Id,
    pub mode: String,
    pub objective_correct: i64,
    pub objective_total: i64,
    pub open_score: Option<i64>,
    pub open_total: Option<i64>,
    pub completed_at: Option<String>,
}

/// 题组摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSetSummary {
    pub id: Id,
    pub passage_id: Id,
    pub name: String,
    pub spec: QuestionSetSpec,
    pub created_at: String,
    /// 完成的作答次数
    pub completed_attempts: i64,
    pub last_attempt: Option<PassageAttemptBrief>,
}

/// 题组（练习用：含题目与选词填空词库）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSet {
    pub id: Id,
    pub passage_id: Id,
    pub name: String,
    pub spec: QuestionSetSpec,
    pub model_name: Option<String>,
    pub created_at: String,
    pub questions: Vec<PassageQuestion>,
    /// 选词填空的词库（答案 + 干扰词，已打乱）
    pub cloze_bank: Vec<String>,
}

/// 短文详情
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub id: Id,
    pub title: String,
    pub sentences: Vec<PassageSentence>,
    pub target_words: Vec<PassageTargetWord>,
    /// 生成时用的场景
    pub scene: Option<String>,
    pub sources: Vec<PassageSource>,
    /// 英语水平 a1 / a2 / b1 / b2
    pub level: String,
    /// 英文词数
    pub word_count: i64,
    pub model_name: Option<String>,
    pub created_at: String,
    pub question_sets: Vec<QuestionSetSummary>,
    /// generated AI 写的 / imported 导入的材料 / video 视频切片
    pub origin: String,
    /// 导入时的文件名或「粘贴的文本」（AI 写的为空）
    pub source_label: Option<String>,
    pub tags: Vec<crate::types::material::Tag>,
}

/// 短文列表项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageSummary {
    pub id: Id,
    pub title: String,
    pub level: String,
    pub word_count: i64,
    pub target_words: Vec<PassageTargetWord>,
    pub sources: Vec<PassageSource>,
    pub created_at: String,
    /// generated AI 写的 / imported 导入的材料 / video 视频切片
    pub origin: String,
    /// 导入时的文件名或「粘贴的文本」
    pub source_label: Option<String>,
    pub tags: Vec<crate::types::material::Tag>,
    /// 题组数
    pub question_sets: i64,
    /// 完成的作答次数（所有题组）
    pub completed_attempts: i64,
    pub last_attempt: Option<PassageAttemptBrief>,
}

/// 选词填空一空的结果
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClozeResult {
    pub question_id: Id,
    pub answer: String,
    pub given: String,
    pub correct: bool,
}

/// 一道题的结果（不含选词填空）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionResult {
    pub question_id: Id,
    pub given: String,
    /// 客观题是否答对（开放题为 None）
    pub correct: Option<bool>,
    /// 开放题得分（0–OPEN_MAX_SCORE；评分失败或未评为 None）
    pub score: Option<i64>,
    /// 开放题评语
    pub feedback: Option<String>,
    /// 开放题的改进示例
    pub suggestion: Option<String>,
}

/// 作答记录。mode：reading 阅读 / listening 听力；status：in_progress / completed
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageAttempt {
    pub id: Id,
    pub set_id: Id,
    pub passage_id: Id,
    pub plan_id: Option<Id>,
    pub schedule_id: Option<Id>,
    pub mode: String,
    pub status: String,
    pub cloze_results: Vec<ClozeResult>,
    pub question_results: Vec<QuestionResult>,
    pub objective_correct: i64,
    pub objective_total: i64,
    pub open_score: Option<i64>,
    pub open_total: Option<i64>,
    /// 开放题 AI 评分失败的原因（可重试）
    pub grading_error: Option<String>,
    /// 毫秒
    pub active_time: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
}

/// 词汇来源：词汇本、学习计划（都可多选）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageWordSources {
    #[serde(default)]
    pub book_ids: Vec<Id>,
    #[serde(default)]
    pub plan_ids: Vec<Id>,
    /// 计划的取词策略（可多选，取并集）：wrong 错词 / weak 还没记牢 / recent 最近学的 /
    /// upcoming 快到复习 / mastered 已经掌握 / learned 全部学过的（空 = learned）
    #[serde(default)]
    pub plan_scopes: Vec<String>,
}

/// 候选词
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageWordCandidate {
    pub word_id: Id,
    pub word: String,
    pub meaning: String,
    /// 来源名称（词汇本名或计划名）
    pub source: String,
    /// 已在几篇短文里用过
    pub usage: i64,
    /// 计划里的学习情况标签：wrong / weak / recent / upcoming / mastered（词汇本来源为空）
    pub tags: Vec<String>,
    /// 挑词用的学习情况：new / learning / mastered 之一，答错过再加 wrong（词汇本来源按所有计划的练习记录）
    pub statuses: Vec<String>,
}

/// 一种取词策略能取到的词数
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanScopeCount {
    pub scope: String,
    pub count: i64,
}

/// 生成短文
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePassageRequest {
    #[serde(default)]
    pub book_ids: Vec<Id>,
    #[serde(default)]
    pub plan_ids: Vec<Id>,
    /// 计划的取词策略（见 PassageWordSources）
    #[serde(default)]
    pub plan_scopes: Vec<String>,
    /// 必须出现的词（来源里勾选的）
    #[serde(default)]
    pub required_word_ids: Vec<Id>,
    /// 必须出现的词（手动输入的英文单词）
    #[serde(default)]
    pub extra_words: Vec<String>,
    /// 这些词的中文释义（小写单词 → 释义；按描述生成时 AI 选词给出）
    #[serde(default)]
    pub extra_meanings: std::collections::HashMap<String, String>,
    /// 再让 AI 从来源里挑几个适合场景的词（0 = 不挑）
    #[serde(default)]
    pub ai_pick: i64,
    /// AI 挑词只从这些学习情况的词里挑（new / learning / wrong / mastered，取并集；空 = 不限）
    #[serde(default)]
    pub pick_statuses: Vec<String>,
    /// AI 挑词的单词难度：easy / medium / hard（空 = 不限）
    #[serde(default)]
    pub pick_difficulty: Option<String>,
    /// AI 挑词的常用程度：common / advanced（空 = 不限）
    #[serde(default)]
    pub pick_frequency: Option<String>,
    /// 自定主题 / 场景（空 = 用所选词汇本的场景）
    pub topic: Option<String>,
    /// 按描述生成：用户写的要求（主题、体裁、人物等）。有它时可以不选单词，场景就是这段要求
    #[serde(default)]
    pub instruction: Option<String>,
    /// short / standard / long（空 = standard）
    pub length: Option<String>,
    /// 按内容规划里的一篇来写（此时用它的词、篇幅与构思，忽略 required_word_ids / extra_words / ai_pick / length）
    #[serde(default)]
    pub plan_item: Option<PassagePlanItem>,
}

/// 内容规划里的一篇（AI 提议，用户可改标题、构思、篇幅后再生成）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassagePlanItem {
    /// 建议标题（英文）
    pub title: String,
    /// 故事构思（中文，多行：主角与目标 / 麻烦或意外 / 发展与解决 / 结尾）
    pub idea: String,
    /// 这一篇用的词（required = 用户指定的必用词；false = AI 从来源里挑的）
    pub words: Vec<PassageTargetWord>,
    /// short / standard / long
    pub length: String,
}

/// 按内容规划写几篇短文（start_passage_generation，后台任务）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePassagesRequest {
    /// 来源、必用词、挑词偏好、主题与篇幅（plan_item 由下面的 items 逐篇填入）
    pub base: GeneratePassageRequest,
    pub items: Vec<PassagePlanItem>,
}

/// 导入几篇材料（start_passage_import，后台任务），逐篇翻译保存
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPassagesRequest {
    pub items: Vec<ImportPassageRequest>,
}

/// 写短文 / 导入任务里一篇的状态（job.detail.items）
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageItemStatus {
    /// waiting / running / done / failed
    pub state: String,
    pub passage_id: Option<Id>,
    /// 写好 / 导入好的短文标题
    pub title: Option<String>,
    pub error: Option<String>,
}

/// 内容规划：写几篇、每篇的构思和用词，以及给用户的说明
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassagePlan {
    pub items: Vec<PassagePlanItem>,
    /// 为什么这样规划（一两句）
    pub note: String,
}

impl GeneratePassageRequest {
    /// 按描述生成（有写作要求）
    pub fn has_instruction(&self) -> bool {
        self.instruction
            .as_deref()
            .is_some_and(|t| !t.trim().is_empty())
    }

    pub fn word_sources(&self) -> PassageWordSources {
        PassageWordSources {
            book_ids: self.book_ids.clone(),
            plan_ids: self.plan_ids.clone(),
            plan_scopes: self.plan_scopes.clone(),
        }
    }
}

/// 为短文生成一套阅读理解题
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateQuestionSetRequest {
    pub passage_id: Id,
    /// 题组名称（空 = 第 N 套）
    pub name: Option<String>,
    pub spec: QuestionSetSpec,
}

/// 一道题的作答
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageAnswer {
    pub question_id: Id,
    /// cloze：填的词；choice：选项下标；true_false："true" / "false"；open：回答文字
    pub value: String,
}

/// 提交作答
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPassageAttemptRequest {
    pub attempt_id: Id,
    /// 毫秒
    pub active_time: i64,
    #[serde(default)]
    pub answers: Vec<PassageAnswer>,
}

/// 一种模式的统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageModeStatistics {
    pub attempts: i64,
    /// 客观题正确率 0–100（没有作答为 None）
    pub objective_accuracy: Option<f64>,
    /// 开放题得分率 0–100
    pub open_score_rate: Option<f64>,
    /// 毫秒
    pub total_time: i64,
}

/// 短文练习统计（与单词练习口径独立）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageStatistics {
    /// 短文总数（按计划筛选时为引用了该计划的短文）
    pub total_passages: i64,
    /// 阅读理解题组总数
    pub total_sets: i64,
    /// 练过的短文篇数
    pub passages: i64,
    pub reading: PassageModeStatistics,
    pub listening: PassageModeStatistics,
}

// ==================== 学习计划里的短文（C4） ====================

fn default_plan_mode() -> String {
    "reading".into()
}

/// 计划里的一项短文任务（新建计划 / 修改计划短文时传入）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanPassageInput {
    pub passage_id: Id,
    /// 用哪套阅读理解题；为空表示只朗读、自由学习（点「读完了」算完成）
    #[serde(default)]
    pub set_id: Option<Id>,
    /// reading / listening（默认 reading）
    #[serde(default = "default_plan_mode")]
    pub mode: String,
}

/// 修改计划的练习内容与短文（顺序即排期顺序）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPlanPassagesRequest {
    pub plan_id: Id,
    /// words / passages / both
    pub practice_content: String,
    /// 完整顺序：已完成的短文必须包含在内（其日期与题组锁定）
    #[serde(default)]
    pub passages: Vec<PlanPassageInput>,
    /// 每几天一篇（1–30）
    pub interval_days: i64,
}

/// 计划里的一项短文任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPassage {
    pub id: Id,
    pub plan_id: Id,
    pub passage_id: Id,
    pub title: String,
    pub level: String,
    pub word_count: i64,
    pub set_id: Option<Id>,
    pub set_name: Option<String>,
    pub mode: String,
    pub sort_order: i64,
    /// 本地日期 YYYY-MM-DD
    pub scheduled_date: String,
    pub completed_at: Option<String>,
    /// completed / due（今天）/ overdue（日期已过没完成）/ upcoming
    pub status: String,
    /// 完成这项任务的作答（只读任务为空）
    /// 视频切片：只读任务即「看视频跟读」
    pub is_video: bool,
    pub attempt: Option<PassageAttemptBrief>,
}

/// 今天要做的短文任务（首页；含今天刚完成的）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayPassageTask {
    pub item_id: Id,
    pub plan_id: Id,
    pub plan_name: String,
    pub passage_id: Id,
    pub title: String,
    pub word_count: i64,
    pub set_id: Option<Id>,
    pub set_name: Option<String>,
    pub mode: String,
    /// 视频切片
    pub is_video: bool,
    pub scheduled_date: String,
    /// completed / due / overdue
    pub status: String,
}

/// 给计划挑短文时的候选范围
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPassageCandidatesRequest {
    /// 计划用的词汇本（新建计划时）
    #[serde(default)]
    pub book_ids: Vec<Id>,
    /// 已有计划（计划设置里加短文时）：按计划里的单词算相关度
    #[serde(default)]
    pub plan_id: Option<Id>,
}

/// 可加进计划的短文：相关度 = 目标词里属于计划单词（或所选词汇本）的个数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPassageCandidate {
    pub passage: PassageSummary,
    pub overlap: i64,
    /// 题组（最新的在前）
    pub sets: Vec<QuestionSetSummary>,
    /// 加进计划时默认用的题组：最早生成的一套；没有题组为空（只朗读）
    pub default_set_id: Option<Id>,
}

// ==================== 导入材料 ====================

/// 导入材料的一句（原文，不做改写）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSentence {
    pub en: String,
    /// 本句开始一个新段落
    #[serde(default)]
    pub paragraph: bool,
}

/// 预处理材料：粘贴的文本，或文件（文件名 + base64 内容）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareImportRequest {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub file_base64: Option<String>,
    /// 每篇目标词数（120–450，默认 300）
    #[serde(default)]
    pub target_words: Option<i64>,
}

/// 预览里的一篇
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewItem {
    /// 标题建议：材料里的标题行 / 文件名 / 首句
    pub title: String,
    pub sentences: Vec<ImportSentence>,
    pub word_count: i64,
}

/// 材料预处理结果（不写库，不用 AI）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// 文件名或「粘贴的文本」
    pub source_label: String,
    pub items: Vec<ImportPreviewItem>,
    pub total_words: i64,
    /// 给用户看的提示（截断、去掉了中文行等）
    pub warnings: Vec<String>,
}

/// 导入一篇：原文由这里的句子保存，AI 只翻译、起标题、估水平、挑重点词
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPassageRequest {
    /// 为空时由 AI 起标题
    #[serde(default)]
    pub title: Option<String>,
    pub sentences: Vec<ImportSentence>,
    pub source_label: String,
    /// 原文里属于这些词汇本的词标为目标词
    #[serde(default)]
    pub book_ids: Vec<Id>,
    /// 让 AI 挑重点词
    #[serde(default)]
    pub ai_key_words: bool,
}

/// 短文里还不在词汇本的词（AI 挑的重点词）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PassageNewWord {
    pub word: String,
    pub meaning: Option<String>,
}

/// 把短文里的生词加进词汇本
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPassageWordsRequest {
    pub passage_id: Id,
    pub book_id: Id,
    pub words: Vec<String>,
}

/// 读取一个材料文件（词汇本提取与短文导入共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMaterialRequest {
    pub file_name: String,
    pub file_base64: String,
}

/// 读出的材料文字：已清理（字幕时间轴、Markdown 标记、页码、中文译文行等），段落之间空一行
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialText {
    pub text: String,
    /// 文件名
    pub source_label: String,
    pub warnings: Vec<String>,
}

// ==================== 句子分析 ====================

/// 句子成分：原句里连续的一段 + 它在句中的作用（主语、谓语、宾语、状语、从句…）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentenceChunk {
    pub text: String,
    pub role: String,
}

/// 语法点：标题 + 原句里对应的片段 + 说明
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrammarPoint {
    pub title: String,
    #[serde(default)]
    pub text: String,
    pub explanation: String,
}

/// 句子里的词组：原句写法 + 原形 + 释义
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentencePhrase {
    pub text: String,
    pub base: String,
    pub meaning: String,
}

/// 发音要点：原句里的片段 + 怎么读（连读、弱读、重音、语调）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationTip {
    pub text: String,
    pub tip: String,
}

/// 同一交际功能的其他说法
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlternativeExpression {
    pub en: String,
    pub zh: String,
}

/// 一句话的分析（AI 生成，按句子缓存在 sentence_analyses，065）
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentenceAnalysis {
    /// 句式公式，如「主语 + would rather + do A + than do B」
    pub pattern: String,
    /// 句式说明：表达什么、怎么套用
    #[serde(default)]
    pub pattern_note: String,
    /// 成分划分（按原句顺序）
    #[serde(default)]
    pub chunks: Vec<SentenceChunk>,
    #[serde(default)]
    pub grammar: Vec<GrammarPoint>,
    /// 交际功能，如「委婉地拒绝邀请」
    pub function: String,
    /// 什么场合用、语气
    #[serde(default)]
    pub function_note: String,
    #[serde(default)]
    pub alternatives: Vec<AlternativeExpression>,
    #[serde(default)]
    pub phrases: Vec<SentencePhrase>,
    #[serde(default)]
    pub pronunciation: Vec<PronunciationTip>,
}

/// 分析短文 / 视频片段里的一句
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSentenceRequest {
    pub passage_id: Id,
    /// 句子序号（从 0 开始）
    pub sentence_index: i64,
    /// true：不用已有的分析，重新生成
    #[serde(default)]
    pub refresh: bool,
}

/// 指向短文里的一句（AI 老师围绕句子答疑时用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceRef {
    pub passage_id: Id,
    pub sentence_index: i64,
}
