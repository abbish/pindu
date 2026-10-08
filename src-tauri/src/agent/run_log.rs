//! 一次 agent 运行的执行日志（组件 `AGENT`，每行以 `[任务名#运行编号]` 开头，便于在日志里串起同一次运行）。
//!
//! | 级别 | 内容 |
//! |---|---|
//! | INFO | 开始（模型、提供商、工具、输入长度）；正常结束（用时、tokens、费用、自动重试、各工具调用 / 退回次数）；取消 |
//! | WARN | 自动重试及原因；工具校验退回及原因；结束了但没有成功交出 `submit_*` 结果 |
//! | ERROR | 模型返回错误（服务商原始信息）；进程 / 通信失败、超时（附 sidecar stderr 尾部） |
//! | DEBUG | 发给模型的消息、每次工具调用通过的结果、模型最后的文本 |
//!
//! 全部经 `redact` 去掉密钥；单条明细由 Logger 截断。

use super::config::AgentTask;
use super::protocol::{AgentEvent, RunOutcome};
use super::session::CANCELLED;
use crate::error::AppError;
use crate::logger::{LogLevel, Logger};
use crate::types::ai_model::AIModelConfig;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Instant;

const COMPONENT: &str = "AGENT";

pub struct RunLog<'a> {
    logger: &'a Logger,
    /// `任务名#6 位编号`
    id: String,
    secret: String,
    started: Instant,
    /// 任务要求经 `submit_*` 工具交结果
    expects_submit: bool,
}

impl<'a> RunLog<'a> {
    /// 记下开始（INFO）与发给模型的消息（DEBUG）
    pub fn start(
        logger: &'a Logger,
        task: &AgentTask,
        model: &AIModelConfig,
        message: &str,
    ) -> Self {
        let run = RunLog {
            logger,
            id: format!(
                "{}#{}",
                task.name,
                &uuid::Uuid::new_v4().simple().to_string()[..6]
            ),
            secret: model.provider.api_key.clone(),
            started: Instant::now(),
            expects_submit: task.tools.iter().any(|t| t.starts_with("submit_")),
        };
        logger.info(
            COMPONENT,
            &format!(
                "[{}] 开始：模型 {}（{}），提供商 {}，工具 [{}]，输入 {} 字",
                run.id,
                model.display_name,
                model.model_id,
                model.provider.display_name,
                task.tools.join(", "),
                message.chars().count()
            ),
        );
        if logger.enabled(LogLevel::Debug) {
            logger.debug(
                COMPONENT,
                &format!("[{}] 发给模型的消息", run.id),
                Some(&run.redact(message)),
            );
        }
        run
    }

    /// 运行中的事件：重试与工具退回（WARN），工具通过的结果（DEBUG）
    pub fn event(&self, event: &AgentEvent) {
        match event {
            AgentEvent::AutoRetryStart {
                attempt,
                error_message,
            } => self.logger.warn(
                COMPONENT,
                &format!("[{}] 第 {} 次自动重试", self.id, attempt),
                Some(&self.redact(error_message)),
            ),
            AgentEvent::ToolExecutionEnd {
                tool_name,
                is_error: true,
                content_text,
                ..
            } => self.logger.warn(
                COMPONENT,
                &format!("[{}] {} 被退回", self.id, tool_name),
                Some(&self.redact(content_text)),
            ),
            AgentEvent::ToolExecutionEnd {
                tool_name, details, ..
            } if self.logger.enabled(LogLevel::Debug) => self.logger.debug(
                COMPONENT,
                &format!("[{}] {} 通过", self.id, tool_name),
                Some(&self.redact(&details.to_string())),
            ),
            _ => {}
        }
    }

    /// 本轮结束：模型错误（ERROR）/ 没有交出结果（WARN）/ 完成（INFO）
    pub fn finished(&self, outcome: &RunOutcome, stats: &Value) {
        let summary = format!(
            "用时 {:.1}s，tokens {}，费用 {}，自动重试 {} 次，工具 {}",
            self.started.elapsed().as_secs_f64(),
            number(&stats["tokens"]["total"]),
            number(&stats["cost"]),
            outcome.retries,
            tool_summary(outcome)
        );
        if let Some(error) = &outcome.error {
            self.logger.error(
                COMPONENT,
                &format!("[{}] 模型返回错误：{}", self.id, summary),
                Some(&self.redact(error)),
            );
            return;
        }
        let submitted = outcome
            .tool_calls
            .iter()
            .any(|c| c.tool_name.starts_with("submit_") && !c.is_error);
        if self.expects_submit && !submitted {
            // 最后一次退回的原因；没调过工具时是模型的文本
            let reason = outcome
                .tool_calls
                .iter()
                .rev()
                .find(|c| c.is_error)
                .map(|c| format!("最后一次退回（{}）：{}", c.tool_name, c.content_text))
                .unwrap_or_else(|| format!("模型没有调用提交工具，回复：{}", outcome.text));
            self.logger.warn(
                COMPONENT,
                &format!("[{}] 结束但没有交出结果：{}", self.id, summary),
                Some(&self.redact(&reason)),
            );
            return;
        }
        self.logger
            .info(COMPONENT, &format!("[{}] 完成：{}", self.id, summary));
        if !outcome.text.is_empty() && self.logger.enabled(LogLevel::Debug) {
            self.logger.debug(
                COMPONENT,
                &format!("[{}] 模型最后的文本", self.id),
                Some(&self.redact(&outcome.text)),
            );
        }
    }

    /// 没跑完：取消（INFO）；超时、进程退出、通信失败（ERROR，附 stderr 尾部）
    pub fn failed(&self, error: &AppError, stderr: &str) {
        let elapsed = self.started.elapsed().as_secs_f64();
        let message = error.to_string();
        if message.contains(CANCELLED) {
            self.logger.info(
                COMPONENT,
                &format!("[{}] 已取消（{:.1}s）", self.id, elapsed),
            );
            return;
        }
        let details = if stderr.trim().is_empty() {
            self.redact(&message)
        } else {
            self.redact(&format!("{}\nstderr: {}", message, stderr))
        };
        self.logger.error(
            COMPONENT,
            &format!("[{}] 运行失败（{:.1}s）", self.id, elapsed),
            Some(&details),
        );
    }

    fn redact(&self, text: &str) -> String {
        if self.secret.len() >= 8 {
            text.replace(&self.secret, "****")
        } else {
            text.to_string()
        }
    }
}

/// 数字原样，缺失为 —
fn number(v: &Value) -> String {
    if v.is_null() {
        "—".to_string()
    } else {
        v.to_string()
    }
}

/// `submit_words ×2（退回 1）, tokenize_text ×1`；没有调用为「无」
fn tool_summary(outcome: &RunOutcome) -> String {
    let mut counts: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
    for call in &outcome.tool_calls {
        let entry = counts.entry(call.tool_name.as_str()).or_default();
        entry.0 += 1;
        if call.is_error {
            entry.1 += 1;
        }
    }
    if counts.is_empty() {
        return "无".to_string();
    }
    counts
        .into_iter()
        .map(|(name, (n, rejected))| {
            if rejected > 0 {
                format!("{} ×{}（退回 {}）", name, n, rejected)
            } else {
                format!("{} ×{}", name, n)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::ToolCallResult;

    fn logger() -> Logger {
        let dir = std::env::temp_dir().join(format!("redlark-runlog-{}", uuid::Uuid::new_v4()));
        Logger::new(&dir).unwrap()
    }

    fn model() -> AIModelConfig {
        serde_json::from_value(serde_json::json!({
            "id": 11, "name": "kimi-k3", "displayName": "Kimi", "modelId": "kimi-k3",
            "description": null, "maxTokens": null, "temperature": null,
            "thinkingLevel": null, "extraParams": null, "contextWindow": null, "reasoning": null,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": {
                "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://x",
                "apiKey": "sk-secret-123456", "description": null, "piProvider": null,
                "api": "openai-completions", "isActive": true, "createdAt": "", "updatedAt": ""
            }
        }))
        .unwrap()
    }

    const TASK: AgentTask = AgentTask {
        name: "extract-words",
        system_prompt: String::new(),
        tools: &["tokenize_text", "submit_words"],
        default_thinking: "low",
    };

    fn call(name: &str, is_error: bool, text: &str) -> ToolCallResult {
        ToolCallResult {
            tool_name: name.into(),
            details: serde_json::json!({ "ok": !is_error }),
            is_error,
            content_text: text.into(),
        }
    }

    #[test]
    fn logs_start_rejections_and_summary() {
        let logger = logger();
        let run = RunLog::start(&logger, &TASK, &model(), "hello sk-secret-123456");
        run.event(&AgentEvent::AutoRetryStart {
            attempt: 1,
            error_message: "429 rate limited".into(),
        });
        let outcome = RunOutcome {
            tool_calls: vec![
                call("tokenize_text", false, ""),
                call("submit_words", true, "缺少 3 个词"),
                call("submit_words", false, ""),
            ],
            retries: 1,
            ..Default::default()
        };
        for c in &outcome.tool_calls {
            run.event(&AgentEvent::ToolExecutionEnd {
                tool_call_id: String::new(),
                tool_name: c.tool_name.clone(),
                details: c.details.clone(),
                is_error: c.is_error,
                content_text: c.content_text.clone(),
            });
        }
        run.finished(
            &outcome,
            &serde_json::json!({ "tokens": { "total": 1200 }, "cost": 0.01 }),
        );

        let all = logger.recent_lines(50).unwrap().join("\n");
        assert!(
            all.contains("开始：模型 Kimi（kimi-k3），提供商 月之暗面"),
            "{all}"
        );
        assert!(all.contains("第 1 次自动重试") && all.contains("429 rate limited"));
        assert!(all.contains("submit_words 被退回") && all.contains("缺少 3 个词"));
        assert!(all.contains("完成：") && all.contains("tokens 1200"));
        assert!(all.contains("submit_words ×2（退回 1）, tokenize_text ×1"));
        // 开发版默认 DEBUG：消息内容会记录，但密钥被去掉
        assert!(!all.contains("sk-secret-123456"));
        assert!(all.contains("extract-words#"));
    }

    #[test]
    fn model_error_and_missing_submission_are_flagged() {
        let logger = logger();
        let run = RunLog::start(&logger, &TASK, &model(), "x");
        run.finished(
            &RunOutcome {
                error: Some("401 invalid api key".into()),
                ..Default::default()
            },
            &Value::Null,
        );
        run.finished(
            &RunOutcome {
                tool_calls: vec![call("submit_words", true, "单词不在原文里")],
                ..Default::default()
            },
            &Value::Null,
        );
        let lines = logger.recent_lines(10).unwrap();
        assert!(
            lines[0].contains("\"WARN\"")
                && lines[0].contains("没有交出结果")
                && lines[0].contains("单词不在原文里")
        );
        assert!(lines[1].contains("\"ERROR\"") && lines[1].contains("401 invalid api key"));
        assert!(lines[1].contains("tokens —"));
    }

    #[test]
    fn cancel_is_info_and_failure_keeps_stderr() {
        let logger = logger();
        let run = RunLog::start(&logger, &TASK, &model(), "x");
        run.failed(
            &AppError::ExternalServiceError(format!("{}：用户取消", CANCELLED)),
            "",
        );
        run.failed(
            &AppError::ExternalServiceError("agent 超时（300 秒）未完成".into()),
            "boom",
        );
        let lines = logger.recent_lines(10).unwrap();
        assert!(
            lines[0].contains("\"ERROR\"")
                && lines[0].contains("超时")
                && lines[0].contains("stderr: boom")
        );
        assert!(lines[1].contains("\"INFO\"") && lines[1].contains("已取消"));
    }

    #[test]
    fn warn_level_hides_routine_lines() {
        let logger = logger();
        logger.set_min_level(LogLevel::Warn);
        let run = RunLog::start(&logger, &TASK, &model(), "x");
        run.finished(
            &RunOutcome {
                tool_calls: vec![call("submit_words", false, "")],
                ..Default::default()
            },
            &Value::Null,
        );
        assert!(logger.recent_lines(10).unwrap().is_empty());
    }
}
