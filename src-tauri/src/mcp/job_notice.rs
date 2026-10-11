//! 后台任务结束时通知发起它的 AI 老师对话（D55）：工具提交任务时登记任务属于哪个对话（MCP 请求头
//! `X-Pindu-Conversation`），任务结束时调用 sidecar 扩展命令 `/pindu-job`，由 pi 的 `sendMessage`
//! 把结果放进会话并让 AI 老师接着说（忙时排到这一轮之后）。任务本身照常出现在后台任务里。

use crate::agent::chat::ChatHub;
use crate::jobs::{Job, JobStatus};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Manager};

/// 结束时要通知的任务：任务 id → 对话 id
static WATCHED: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);
/// AI 老师提交的任务来自哪个对话（查看后台任务时标出「这个对话发起的」）
static ORIGIN: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

tokio::task_local! {
    /// 当前这次工具调用来自哪个对话（MCP 请求头）
    pub static CONVERSATION: Option<String>;
}

/// 当前这次工具调用来自的对话
pub fn current_conversation() -> Option<String> {
    CONVERSATION.try_with(|c| c.clone()).ok().flatten()
}

/// 记下任务来自当前对话；`notify` 时任务结束通知这个对话
pub fn track(job_id: &str, notify: bool) {
    let Some(conversation) = current_conversation() else {
        return;
    };
    if let Ok(mut origin) = ORIGIN.lock() {
        origin.insert(job_id.to_string(), conversation.clone());
    }
    prune();
    if notify {
        if let Ok(mut watched) = WATCHED.lock() {
            watched.insert(job_id.to_string(), conversation);
        }
    }
}

/// 后台任务被移除后（任务只放内存，清除已完成 / 重启都会没）不再记它的来源，免得只增不减
fn prune() {
    let Ok(mut origin) = ORIGIN.lock() else {
        return;
    };
    if origin.len() < 64 {
        return;
    }
    let live: std::collections::HashSet<String> = crate::mcp::live_job_ids();
    origin.retain(|id, _| live.contains(id));
}

/// 任务来自哪个对话（AI 老师提交的才有）
pub fn origin_of(job_id: &str) -> Option<String> {
    ORIGIN.lock().ok().and_then(|o| o.get(job_id).cloned())
}

/// 给 AI 老师看的一句话：任务名 + 结果（短文 id 方便接着出题）
pub fn notice_text(job: &Job) -> String {
    let ids = job
        .result
        .as_ref()
        .and_then(|r| r.get("passageIds"))
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_i64)
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    match job.status {
        JobStatus::Succeeded if !ids.is_empty() => {
            format!("后台任务完成：{}（短文 id：{}）", job.title, ids.join("、"))
        }
        JobStatus::Succeeded => format!("后台任务完成：{}", job.title),
        JobStatus::Cancelled => format!("后台任务已停止：{}", job.title),
        _ => {
            let reason = job
                .error
                .as_ref()
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("后台任务没能完成：{}。{}", job.title, reason)
        }
    }
}

/// 任务状态变化（jobs 的事件回调里调用）：登记过的任务结束时通知对话
pub fn on_job(app: &AppHandle, job: &Job) {
    if job.status.is_active() {
        return;
    }
    let Some(conversation) = WATCHED.lock().ok().and_then(|mut w| w.remove(&job.id)) else {
        return;
    };
    let app = app.clone();
    let line = format!(
        "/pindu-job {}",
        json!({ "text": notice_text(job), "job": { "id": job.id, "kind": job.kind, "status": job.status } })
    );
    tauri::async_runtime::spawn(async move {
        let hub = app.state::<ChatHub>().inner().clone();
        // 对话已关闭（闲置）：不重新启动，结果在后台任务里能看到，卡片也会更新
        let Some(session) = hub.get(&conversation).await else {
            return;
        };
        if let Err(e) = session
            .request(
                "prompt",
                json!({ "message": line, "streamingBehavior": "followUp" }),
            )
            .await
        {
            tracing::warn!("通知 AI 老师后台任务结束失败：{}", e);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(status: JobStatus, result: Option<Value>, error: Option<Value>) -> Job {
        Job {
            id: "j1".into(),
            kind: "passage_import".into(),
            title: "导入短文 · A Day with My Phone".into(),
            status,
            stage: None,
            current: 0,
            total: 0,
            detached: true,
            link: None,
            detail: None,
            result,
            error,
            created_at: String::new(),
            started_at: None,
            finished_at: None,
        }
    }

    #[test]
    fn notice_says_what_finished() {
        assert_eq!(
            notice_text(&job(
                JobStatus::Succeeded,
                Some(json!({ "passageIds": [12] })),
                None
            )),
            "后台任务完成：导入短文 · A Day with My Phone（短文 id：12）"
        );
        assert_eq!(
            notice_text(&job(
                JobStatus::Failed,
                None,
                Some(json!({ "message": "翻译失败" }))
            )),
            "后台任务没能完成：导入短文 · A Day with My Phone。翻译失败"
        );
        assert!(notice_text(&job(JobStatus::Cancelled, None, None)).starts_with("后台任务已停止"));
    }
}
