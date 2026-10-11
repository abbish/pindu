//! 素材之间的关联：标签（词汇本 / 短文（含视频切片）/ 原始视频共用，迁移 060）与单词（某个词出现在哪些短文 / 切片）
use super::Id;
use serde::{Deserialize, Serialize};

/// 标签
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Tag {
    pub id: Id,
    pub name: String,
}

/// 标签与各类素材的数量（标签管理、筛选用）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagUsage {
    #[serde(flatten)]
    pub tag: Tag,
    pub word_books: i64,
    /// 短文（不含视频切片）
    pub passages: i64,
    /// 视频切片
    pub clips: i64,
    /// 原始视频
    pub videos: i64,
}

/// 素材种类：material_tags.kind
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MaterialKind {
    WordBook,
    Passage,
    Video,
}

impl MaterialKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MaterialKind::WordBook => "word_book",
            MaterialKind::Passage => "passage",
            MaterialKind::Video => "video",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "word_book" => Some(MaterialKind::WordBook),
            "passage" => Some(MaterialKind::Passage),
            "video" => Some(MaterialKind::Video),
            _ => None,
        }
    }
}

/// 某个词出现在一篇短文 / 切片里
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordMaterial {
    pub passage_id: Id,
    pub title: String,
    /// generated / imported / video
    pub origin: String,
    pub level: String,
    /// 是这篇的重点词（目标词），否则只是正文里出现过
    pub key: bool,
    /// 第一处出现的句子
    pub en: String,
    pub zh: String,
    /// 切片：这句在切片里的开始（毫秒）
    pub start_ms: Option<i64>,
    /// 切片才有
    pub clip: Option<ClipBrief>,
}

/// 切片的播放信息
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipBrief {
    pub video_id: Id,
    pub video_title: String,
    pub clip_url: Option<String>,
    pub poster_url: Option<String>,
    pub duration_ms: i64,
}

/// 词汇本里一个词在素材里出现的次数
#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordMaterialCount {
    pub word_id: Id,
    /// 出现过的短文（不含切片）
    pub passages: i64,
    /// 出现过的视频切片
    pub clips: i64,
}

/// 单词卡：不在词汇本里的目标词的学习资料（word_cards，063）
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WordCard {
    pub word: String,
    pub meaning: String,
    pub pos_abbreviation: String,
    pub pos_chinese: String,
    pub ipa: String,
    pub syllables: String,
    pub phonics_rule: String,
    pub analysis_explanation: String,
    pub examples: Vec<crate::types::wordbook::WordExample>,
    /// word / phrase（由内容决定）
    #[serde(default)]
    pub kind: String,
    /// 词组类型：phrasal_verb / collocation / idiom / fixed（单词为空）
    #[serde(default)]
    pub phrase_type: String,
    /// 短语动词能否拆开用
    #[serde(default)]
    pub separable: bool,
}

// ==================== 素材阅读（pi 自主处理非文本素材，多模态素材 B2） ====================

/// 素材里的一句：英文原文 + 材料里印的中文（没有为 None）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSentence {
    pub en: String,
    #[serde(default)]
    pub zh: Option<String>,
    #[serde(default)]
    pub paragraph: Option<i64>,
    /// 有文字层时，这句在文件文字层里没找到（可能识别错了），界面上提示核对
    #[serde(default)]
    pub unverified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPassage {
    #[serde(default)]
    pub title: Option<String>,
    pub sentences: Vec<MaterialSentence>,
}

/// 材料在正文里标出的词或词组（画线、加粗、旁注）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPhrase {
    /// 在原文句子里的写法
    pub text: String,
    /// 原形（与写法不同时才有，如 got through → get through）
    #[serde(default)]
    pub base: Option<String>,
    pub meaning: String,
}

/// 材料里的词汇表条目
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaterialVocab {
    pub word: String,
    #[serde(default)]
    pub ipa: Option<String>,
    #[serde(default)]
    pub pos: Option<String>,
    #[serde(default)]
    pub meaning: Option<String>,
}

/// pi 读完一份素材整理出的内容（Rust 已核对）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaterialContent {
    #[serde(default)]
    pub title: Option<String>,
    pub passages: Vec<MaterialPassage>,
    pub phrases: Vec<MaterialPhrase>,
    pub vocabulary: Vec<MaterialVocab>,
    /// pi 给学习者的说明（读不清、跳过、需要能看图的模型等）
    #[serde(default)]
    pub note: Option<String>,
    /// 这次用的模型能看图
    #[serde(default)]
    pub used_images: bool,
}

/// 交给 AI 读取的素材文件（PDF / 图片 / Word），用于导入短文
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialImportRequest {
    pub file_name: String,
    pub file_base64: String,
}
