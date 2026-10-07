//! pi RPC 协议（纯函数）：命令序列化、stdout 行解析为响应 / 事件、一轮结果汇总。
//!
//! 协议要点（pi docs/rpc.md、docs/json.md）：
//! - 严格 JSONL，按字节 LF 切分；命令可带 `id`，响应原样带回 `id`（可能乱序）。
//! - 一轮结束以 `agent_settled` 为准（`agent_end` 之后仍可能重试 / 压缩）。
//! - 结构化结果取 `tool_execution_end.result.details`；模型错误体现为 assistant 消息 `stopReason = "error"`。

use serde_json::{json, Map, Value};

/// 一条命令序列化为一行 JSON（含结尾换行）
pub fn command_line(id: &str, command_type: &str, fields: Value) -> String {
    let mut object = match fields {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    object.insert("id".to_string(), json!(id));
    object.insert("type".to_string(), json!(command_type));
    let mut line = Value::Object(object).to_string();
    line.push('\n');
    line
}

/// 命令响应
#[derive(Debug, Clone, PartialEq)]
pub struct RpcResponse {
    pub id: Option<String>,
    pub command: String,
    pub success: bool,
    pub data: Value,
    pub error: Option<String>,
}

/// 我们关心的会话事件；其余事件保留类型名
#[derive(Debug, Clone, PartialEq)]
pub enum AgentEvent {
    /// 流式文本增量
    TextDelta(String),
    /// 工具执行完成：结构化结果在 `details`
    ToolExecutionEnd {
        tool_call_id: String,
        tool_name: String,
        details: Value,
        is_error: bool,
        /// 工具返回给模型的文本（错误时为错误信息）
        content_text: String,
    },
    /// assistant 消息结束（完整文本、停止原因、错误信息）
    AssistantMessageEnd {
        text: String,
        stop_reason: Option<String>,
        error_message: Option<String>,
    },
    /// 自动重试开始（用于日志 / 进度）
    AutoRetryStart { attempt: u64, error_message: String },
    /// 本轮彻底结束
    AgentSettled,
    /// 其它事件
    Other(String),
}

/// stdout 的一行
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Response(RpcResponse),
    Event(AgentEvent),
}

fn str_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// 消息内容中的文本块拼接（content 为字符串或 `[{type:"text",text}]` 数组）
fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// 解析一行 stdout；非 JSON 返回错误
pub fn parse_line(line: &str) -> Result<Incoming, String> {
    let value: Value =
        serde_json::from_str(line).map_err(|e| format!("无法解析 agent 输出：{}", e))?;
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");

    if kind == "response" {
        return Ok(Incoming::Response(RpcResponse {
            id: str_field(&value, "id"),
            command: str_field(&value, "command").unwrap_or_default(),
            success: value
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            data: value.get("data").cloned().unwrap_or(Value::Null),
            error: str_field(&value, "error"),
        }));
    }

    let event = match kind {
        "message_update" => {
            let delta = value.get("assistantMessageEvent");
            match delta.and_then(|d| d.get("type")).and_then(Value::as_str) {
                Some("text_delta") => AgentEvent::TextDelta(
                    delta
                        .and_then(|d| str_field(d, "delta"))
                        .unwrap_or_default(),
                ),
                _ => AgentEvent::Other("message_update".to_string()),
            }
        }
        "tool_execution_end" => {
            let result = value.get("result");
            AgentEvent::ToolExecutionEnd {
                tool_call_id: str_field(&value, "toolCallId").unwrap_or_default(),
                tool_name: str_field(&value, "toolName").unwrap_or_default(),
                details: result
                    .and_then(|r| r.get("details"))
                    .cloned()
                    .unwrap_or(Value::Null),
                is_error: value
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                content_text: content_text(result.and_then(|r| r.get("content"))),
            }
        }
        "message_end" => {
            let message = value.get("message").cloned().unwrap_or(Value::Null);
            if message.get("role").and_then(Value::as_str) == Some("assistant") {
                AgentEvent::AssistantMessageEnd {
                    text: content_text(message.get("content")),
                    stop_reason: str_field(&message, "stopReason"),
                    error_message: str_field(&message, "errorMessage"),
                }
            } else {
                AgentEvent::Other("message_end".to_string())
            }
        }
        "auto_retry_start" => AgentEvent::AutoRetryStart {
            attempt: value.get("attempt").and_then(Value::as_u64).unwrap_or(0),
            error_message: str_field(&value, "errorMessage").unwrap_or_default(),
        },
        "agent_settled" => AgentEvent::AgentSettled,
        other => AgentEvent::Other(other.to_string()),
    };
    Ok(Incoming::Event(event))
}

/// 一次工具调用的结果
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCallResult {
    pub tool_name: String,
    pub details: Value,
    pub is_error: bool,
    pub content_text: String,
}

/// 一轮（prompt → agent_settled）的汇总
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunOutcome {
    pub tool_calls: Vec<ToolCallResult>,
    /// 最后一条 assistant 消息的文本
    pub text: String,
    /// 最后一条 assistant 消息以错误结束时的错误信息
    pub error: Option<String>,
    pub retries: u64,
}

impl RunOutcome {
    /// 按事件顺序累积；返回 true 表示本轮已结束
    pub fn absorb(&mut self, event: &AgentEvent) -> bool {
        match event {
            AgentEvent::ToolExecutionEnd {
                tool_name,
                details,
                is_error,
                content_text,
                ..
            } => self.tool_calls.push(ToolCallResult {
                tool_name: tool_name.clone(),
                details: details.clone(),
                is_error: *is_error,
                content_text: content_text.clone(),
            }),
            AgentEvent::AssistantMessageEnd {
                text,
                stop_reason,
                error_message,
            } => {
                self.text = text.clone();
                self.error = match stop_reason.as_deref() {
                    Some("error") | Some("aborted") => Some(
                        error_message
                            .clone()
                            .unwrap_or_else(|| "模型返回错误（无详细信息）".to_string()),
                    ),
                    _ => None,
                };
            }
            AgentEvent::AutoRetryStart { .. } => self.retries += 1,
            AgentEvent::AgentSettled => return true,
            _ => {}
        }
        false
    }

    /// 最后一次成功的指定工具调用结果（如 `submit_words`）
    pub fn last_successful_call(&self, tool_name: &str) -> Option<&ToolCallResult> {
        self.tool_calls
            .iter()
            .rev()
            .find(|call| call.tool_name == tool_name && !call.is_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实录制：K3（low）先 tokenize_text 再 submit_words（2026-10-06，不含密钥）
    const EXTRACT_RUN: &str = include_str!("fixtures/extract_words_run.jsonl");

    #[test]
    fn command_line_carries_id_and_type() {
        let line = command_line("req-7", "prompt", json!({ "message": "hi" }));
        assert!(line.ends_with('\n'));
        let value: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(
            value,
            json!({ "id": "req-7", "type": "prompt", "message": "hi" })
        );
        let bare: Value =
            serde_json::from_str(command_line("req-8", "get_state", Value::Null).trim_end())
                .unwrap();
        assert_eq!(bare, json!({ "id": "req-8", "type": "get_state" }));
    }

    #[test]
    fn recorded_run_yields_structured_tool_results_and_settles() {
        let mut outcome = RunOutcome::default();
        let mut responses = Vec::new();
        let mut settled_at = None;
        for (index, line) in EXTRACT_RUN.lines().enumerate() {
            match parse_line(line).unwrap() {
                Incoming::Response(r) => responses.push(r),
                Incoming::Event(event) => {
                    if outcome.absorb(&event) && settled_at.is_none() {
                        settled_at = Some(index);
                    }
                }
            }
        }
        assert!(settled_at.is_some(), "应有 agent_settled");
        assert_eq!(responses[0].id.as_deref(), Some("req-1"));
        assert!(responses[0].success);
        assert_eq!(responses[0].data["disposition"], "started");
        // get_session_stats 响应带用量
        let stats = responses
            .iter()
            .find(|r| r.command == "get_session_stats")
            .unwrap();
        assert!(stats.data["tokens"]["total"].as_u64().unwrap() > 0);

        let names: Vec<&str> = outcome
            .tool_calls
            .iter()
            .map(|c| c.tool_name.as_str())
            .collect();
        assert_eq!(names, vec!["tokenize_text", "submit_words"]);
        assert_eq!(outcome.tool_calls[0].details["the"], 3);
        let words = &outcome
            .last_successful_call("submit_words")
            .unwrap()
            .details["words"];
        let cat = words
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["word"] == "cat")
            .unwrap();
        assert_eq!(cat["frequency"], 2);
        assert_eq!(outcome.error, None);
    }

    #[test]
    fn error_messages_and_text_deltas_are_recognised() {
        let delta = parse_line(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hel"}}"#,
        )
        .unwrap();
        assert_eq!(
            delta,
            Incoming::Event(AgentEvent::TextDelta("Hel".to_string()))
        );

        let mut outcome = RunOutcome::default();
        let end = parse_line(
            r#"{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"invalid temperature: only 1 is allowed for this model"}}"#,
        )
        .unwrap();
        if let Incoming::Event(event) = end {
            outcome.absorb(&event);
        }
        assert_eq!(
            outcome.error.as_deref(),
            Some("invalid temperature: only 1 is allowed for this model")
        );

        let failed = parse_line(
            r#"{"id":"req-3","type":"response","command":"set_model","success":false,"error":"Model not found"}"#,
        )
        .unwrap();
        match failed {
            Incoming::Response(r) => {
                assert!(!r.success);
                assert_eq!(r.error.as_deref(), Some("Model not found"));
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(parse_line("not json").is_err());
    }
}
