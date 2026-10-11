//! AI 老师独立对话（对话内容由 pi 会话保存，这里只有列表与请求）

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 对话列表的一项
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorConversation {
    pub id: String,
    /// 标题：pi 会话名，没有时为第一条消息
    pub title: String,
    pub created: String,
    pub modified: String,
    pub message_count: i64,
    pub pinned: bool,
    pub archived: bool,
    /// 正在回答
    pub running: bool,
}

/// 打开一个对话：pi 的消息（`get_messages`）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorOpened {
    pub id: String,
    pub messages: Value,
    pub running: bool,
}

/// 随消息发送的图片（粘贴的截图等）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorImage {
    /// base64（不含 data: 前缀）
    pub data: String,
    pub mime_type: String,
}

/// 发一条消息：没有对话 id 时开新对话
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorSendRequest {
    pub conversation_id: Option<String>,
    pub message: String,
    #[serde(default)]
    pub images: Vec<TutorImage>,
}

/// 回答工具向用户的提问（pi `extension_ui_response`）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorUiAnswer {
    pub conversation_id: String,
    pub request_id: String,
    pub value: Option<String>,
    pub confirmed: Option<bool>,
    #[serde(default)]
    pub cancelled: bool,
}

/// 置顶 / 归档（pi 没有这个概念，存在 app_settings）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TutorFlags {
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived: bool,
}
