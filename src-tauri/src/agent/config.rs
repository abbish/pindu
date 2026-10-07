//! 模型配置 + 任务定义 → sidecar 启动参数（docs/agent-harness/DESIGN.md §3–§4）。
//!
//! 密钥只出现在子进程环境变量 `REDLARK_KEY_<provider_id>` 中；写入磁盘的配置文件只含变量名。

use super::session::AgentLaunch;
use crate::error::{AppError, AppResult};
use crate::types::ai_model::{AIModelConfig, AIProvider};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// pi 支持的思考档
pub const THINKING_LEVELS: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/// 一个 agent 任务的固定部分：提示词、工具白名单、默认思考档
#[derive(Debug, Clone)]
pub struct AgentTask {
    /// 用于日志与运行目录命名
    pub name: &'static str,
    pub system_prompt: String,
    /// 本任务开放的工具（白名单；pi 内置工具一律不在其中）
    pub tools: &'static [&'static str],
    /// 模型未设置思考档时使用
    pub default_thinking: &'static str,
}

/// 会话持久化方式（H5 场景对话会增加持久化会话）
#[derive(Debug, Clone)]
pub enum SessionMode {
    /// 一次性任务：不落盘
    Ephemeral,
}

/// sidecar 可执行文件与应用数据目录
#[derive(Debug, Clone)]
pub struct AgentPaths {
    pub program: PathBuf,
    /// `<app_data>/agent`
    pub root: PathBuf,
}

impl AgentPaths {
    /// 打包后 sidecar 与主程序同目录（tauri externalBin 去掉 target triple 后缀）；
    /// 环境变量 `REDLARK_AGENT_BIN` 可覆盖（开发 / 测试）。
    pub fn resolve(app_data_dir: &Path) -> AppResult<Self> {
        let program = match std::env::var_os("REDLARK_AGENT_BIN") {
            Some(path) => PathBuf::from(path),
            None => {
                let exe = std::env::current_exe().map_err(|e| {
                    AppError::InternalError(format!("无法定位应用可执行文件：{}", e))
                })?;
                let dir = exe
                    .parent()
                    .ok_or_else(|| AppError::InternalError("无法定位应用目录".to_string()))?;
                dir.join(format!("redlark-agent{}", std::env::consts::EXE_SUFFIX))
            }
        };
        #[cfg(debug_assertions)]
        ensure_sidecar_fresh(&program)?;
        Ok(Self {
            program,
            root: app_data_dir.join("agent"),
        })
    }
}

/// 开发模式：sidecar 比 agent/src 里的源码旧时直接报错并说明怎么办。
/// tauri:dev 只在启动时编译一次 sidecar，之后改了工具（如新增 submit_*）运行中的应用仍用旧程序，
/// 模型拿不到新工具，只会表现为“模型没有提交……”这类含糊的错误。
#[cfg(debug_assertions)]
fn ensure_sidecar_fresh(program: &std::path::Path) -> AppResult<()> {
    fn newest(dir: &std::path::Path) -> Option<std::time::SystemTime> {
        let mut latest = None;
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            let time = if path.is_dir() {
                newest(&path)
            } else if path.extension().is_some_and(|e| e == "ts") {
                entry.metadata().and_then(|m| m.modified()).ok()
            } else {
                None
            };
            latest = latest.max(time);
        }
        latest
    }
    let source_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../agent/src");
    let (Some(source), Ok(binary)) = (
        newest(&source_dir),
        std::fs::metadata(program).and_then(|m| m.modified()),
    ) else {
        return Ok(()); // 找不到源码或程序时不拦（如 REDLARK_AGENT_BIN 指向别处）
    };
    if source > binary {
        return Err(AppError::InternalError(
            "AI 助手程序比源码旧（agent/src 有更新）：请运行 npm run agent:build 后重启 npm run tauri:dev".to_string(),
        ));
    }
    Ok(())
}

/// pi 中使用的 provider id：内置 provider 用其 id，自定义端点为 `redlark-p<id>`
pub fn provider_key(provider: &AIProvider) -> String {
    match &provider.pi_provider {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => format!("redlark-p{}", provider.id),
    }
}

/// 存放该提供商 API Key 的环境变量名
pub fn key_env(provider: &AIProvider) -> String {
    format!("REDLARK_KEY_{}", provider.id)
}

/// 模型的思考档：模型设置了合法值就用它，否则用任务默认
pub fn thinking_level(model: &AIModelConfig, task_default: &str) -> String {
    model
        .thinking_level
        .as_deref()
        .map(str::trim)
        .filter(|level| THINKING_LEVELS.contains(level))
        .unwrap_or(task_default)
        .to_string()
}

/// 交给 sidecar 的 RedLark 配置（与 agent/src/config.ts 的 RedLarkAgentConfig 一致，camelCase）
pub fn agent_config_json(model: &AIModelConfig) -> Value {
    let provider = &model.provider;
    json!({
        "provider": {
            "key": provider_key(provider),
            "piProvider": provider.pi_provider.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            "name": provider.display_name,
            "baseUrl": provider.base_url,
            "api": provider.api,
            "apiKeyEnv": key_env(provider),
            "model": {
                "modelId": model.model_id,
                "name": model.display_name,
                "maxTokens": model.max_tokens.filter(|t| *t > 0),
                "temperature": model.temperature,
                "extraParams": model.extra_params.clone().filter(Value::is_object),
                "contextWindow": model.context_window.filter(|c| *c > 0),
                "reasoning": model.reasoning,
            }
        }
    })
}

/// sidecar 命令行参数（不含任何密钥）
pub fn launch_args(
    task: &AgentTask,
    model: &AIModelConfig,
    system_prompt_file: &Path,
    session: &SessionMode,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match session {
        SessionMode::Ephemeral => args.push("--no-session".into()),
    }
    // 不加载任何外部资源：扩展 / MCP / 技能 / 提示模板 / AGENTS.md / 主题 / 项目 .pi
    for flag in [
        "-ne",
        "--no-mcp",
        "-ns",
        "-np",
        "-nc",
        "--no-themes",
        "--no-approve",
    ] {
        args.push(flag.into());
    }
    if task.tools.is_empty() {
        // 纯对话任务：不开放任何工具（含扩展工具）
        args.push("-nt".into());
    } else {
        args.push("--tools".into());
        args.push(task.tools.join(","));
    }
    args.push("--system-prompt".into());
    args.push(system_prompt_file.to_string_lossy().into_owned());
    args.push("--provider".into());
    args.push(provider_key(&model.provider));
    args.push("--model".into());
    args.push(model.model_id.clone());
    args.push("--thinking".into());
    args.push(thinking_level(model, task.default_thinking));
    args
}

/// 准备一次运行：校验密钥、创建运行目录（agentDir / 配置 / 系统提示词）、组装环境变量
pub fn prepare_launch(
    paths: &AgentPaths,
    task: &AgentTask,
    model: &AIModelConfig,
    session: SessionMode,
) -> AppResult<AgentLaunch> {
    let provider = &model.provider;
    if !provider.has_api_key() {
        return Err(AppError::ValidationError(format!(
            "请先在设置页为「{}」配置 API Key",
            provider.display_name
        )));
    }

    let io = |e: std::io::Error| AppError::InternalError(format!("准备 agent 运行目录失败：{}", e));
    // 每个进程独立的 agentDir：models.json 由 sidecar 按本次配置生成，并发运行互不覆盖
    let run_dir = paths
        .root
        .join("runs")
        .join(format!("{}-{}", task.name, uuid::Uuid::new_v4()));
    let agent_dir = run_dir.join("agent");
    let cwd = paths.root.join("cwd"); // 空目录：不会加载任何项目资源
    std::fs::create_dir_all(&agent_dir).map_err(io)?;
    std::fs::create_dir_all(&cwd).map_err(io)?;

    let config_file = run_dir.join("config.json");
    std::fs::write(&config_file, agent_config_json(model).to_string()).map_err(io)?;
    let prompt_file = run_dir.join("system.md");
    std::fs::write(&prompt_file, &task.system_prompt).map_err(io)?;

    let args = launch_args(task, model, &prompt_file, &session);
    let env = vec![
        (
            "PI_CODING_AGENT_DIR".to_string(),
            agent_dir.to_string_lossy().into_owned(),
        ),
        ("PI_OFFLINE".to_string(), "1".to_string()),
        ("PI_TELEMETRY".to_string(), "0".to_string()),
        (
            "REDLARK_AGENT_CONFIG".to_string(),
            config_file.to_string_lossy().into_owned(),
        ),
        (key_env(provider), provider.api_key.clone()),
    ];

    Ok(AgentLaunch {
        program: paths.program.clone(),
        args,
        env,
        cwd,
        run_dir: Some(run_dir),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-moonshot-secret-0123456789";

    fn model(pi_provider: Option<&str>) -> AIModelConfig {
        serde_json::from_value(json!({
            "id": 11, "name": "kimi-k3", "displayName": "Kimi K3", "modelId": "kimi-k3",
            "description": null, "maxTokens": 32000, "temperature": 1.0,
            "thinkingLevel": null, "extraParams": {"top_p": 0.95}, "contextWindow": null, "reasoning": null,
            "isActive": true, "isDefault": true, "createdAt": "", "updatedAt": "",
            "provider": {
                "id": 2, "name": "moonshot", "displayName": "月之暗面", "baseUrl": "https://api.moonshot.cn/v1",
                "apiKey": SECRET, "description": null, "piProvider": pi_provider, "api": "openai-completions",
                "isActive": true, "createdAt": "", "updatedAt": ""
            }
        }))
        .unwrap()
    }

    fn task() -> AgentTask {
        AgentTask {
            name: "extract-words",
            system_prompt: "提示词".to_string(),
            tools: &["tokenize_text", "submit_words"],
            default_thinking: "low",
        }
    }

    #[test]
    fn builtin_provider_maps_to_pi_id_and_config_has_no_secret() {
        let m = model(Some("moonshotai-cn"));
        assert_eq!(provider_key(&m.provider), "moonshotai-cn");
        let config = agent_config_json(&m);
        assert_eq!(config["provider"]["apiKeyEnv"], "REDLARK_KEY_2");
        assert_eq!(config["provider"]["model"]["extraParams"]["top_p"], 0.95);
        assert!(!config.to_string().contains(SECRET));
    }

    #[test]
    fn custom_provider_gets_redlark_key() {
        let m = model(None);
        assert_eq!(provider_key(&m.provider), "redlark-p2");
        assert_eq!(agent_config_json(&m)["provider"]["piProvider"], Value::Null);
    }

    #[test]
    fn args_whitelist_tools_disable_resources_and_never_contain_the_key() {
        let m = model(Some("moonshotai-cn"));
        let args = launch_args(
            &task(),
            &m,
            Path::new("/tmp/system.md"),
            &SessionMode::Ephemeral,
        );
        let joined = args.join(" ");
        assert!(
            joined.starts_with("--no-session -ne --no-mcp -ns -np -nc --no-themes --no-approve")
        );
        assert!(joined.contains("--tools tokenize_text,submit_words"));
        assert!(joined.contains("--provider moonshotai-cn --model kimi-k3 --thinking low"));
        assert!(!joined.contains(SECRET));
    }

    #[test]
    fn task_without_tools_disables_all_tools() {
        let mut no_tools = task();
        no_tools.tools = &[];
        let args = launch_args(
            &no_tools,
            &model(Some("moonshotai-cn")),
            Path::new("/tmp/s.md"),
            &SessionMode::Ephemeral,
        );
        assert!(args.contains(&"-nt".to_string()));
        assert!(!args.contains(&"--tools".to_string()));
    }

    #[test]
    fn thinking_level_prefers_valid_model_setting() {
        let mut m = model(Some("moonshotai-cn"));
        assert_eq!(thinking_level(&m, "low"), "low");
        m.thinking_level = Some("high".to_string());
        assert_eq!(thinking_level(&m, "low"), "high");
        m.thinking_level = Some("turbo".to_string());
        assert_eq!(thinking_level(&m, "medium"), "medium");
    }

    #[test]
    fn prepare_launch_writes_files_without_secret_and_passes_key_by_env() {
        let root =
            std::env::temp_dir().join(format!("redlark-agent-test-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program: PathBuf::from("/bin/redlark-agent"),
            root: root.clone(),
        };
        let launch = prepare_launch(
            &paths,
            &task(),
            &model(Some("moonshotai-cn")),
            SessionMode::Ephemeral,
        )
        .unwrap();
        let run_dir = launch.run_dir.clone().unwrap();
        let config = std::fs::read_to_string(run_dir.join("config.json")).unwrap();
        assert!(!config.contains(SECRET));
        assert_eq!(
            std::fs::read_to_string(run_dir.join("system.md")).unwrap(),
            "提示词"
        );
        assert!(launch
            .env
            .iter()
            .any(|(k, v)| k == "REDLARK_KEY_2" && v == SECRET));
        assert!(launch
            .env
            .iter()
            .any(|(k, v)| k == "PI_OFFLINE" && v == "1"));
        assert!(launch.cwd.ends_with("cwd"));
        let _ = std::fs::remove_dir_all(root);

        let mut no_key = model(Some("moonshotai-cn"));
        no_key.provider.api_key = "PLEASE_SET_YOUR_API_KEY".to_string();
        assert!(matches!(
            prepare_launch(&paths, &task(), &no_key, SessionMode::Ephemeral),
            Err(AppError::ValidationError(_))
        ));
    }
}
