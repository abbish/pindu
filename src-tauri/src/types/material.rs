//! 素材之间的关联：标签（单词本 / 短文（含视频切片）/ 原始视频共用，迁移 060）与单词（某个词出现在哪些短文 / 切片）
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

/// 单词本里一个词在素材里出现的次数
#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordMaterialCount {
    pub word_id: Id,
    /// 出现过的短文（不含切片）
    pub passages: i64,
    /// 出现过的视频切片
    pub clips: i64,
}
