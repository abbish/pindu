mod agent;
mod app_paths;
mod database;
mod error;
mod handlers;
mod jobs;
mod lemma;
mod log_bridge;
mod logger;
mod media;
mod media_server;
#[cfg(target_os = "macos")]
mod menu;
mod repositories;
mod services;
mod startup;
mod time;
mod types;

mod prompts;

#[cfg(test)]
mod test_support;

use handlers::*;
use tauri::Manager;

/// 后台任务的日志：提交（INFO）、成功（INFO）、取消（INFO）、失败（ERROR，附错误）。
/// 进度更新也会走 emit，只在这几个状态各记一次（排队只在提交时出现一次，结束状态只出现一次）。
fn log_job(app: &tauri::AppHandle, job: &jobs::Job) {
    let Some(logger) = app.try_state::<logger::Logger>() else {
        return;
    };
    let head = format!("[{}] {}「{}」", job.id, job.kind, job.title);
    match job.status {
        jobs::JobStatus::Queued => logger.info("JOB", &format!("{} 已提交", head)),
        jobs::JobStatus::Running => {}
        jobs::JobStatus::Succeeded => logger.info(
            "JOB",
            &format!(
                "{} 完成（{} → {}）",
                head,
                job.started_at.as_deref().unwrap_or("—"),
                job.finished_at.as_deref().unwrap_or("—")
            ),
        ),
        jobs::JobStatus::Cancelled => logger.info("JOB", &format!("{} 已取消", head)),
        jobs::JobStatus::Failed => logger.error(
            "JOB",
            &format!("{} 失败", head),
            job.error.as_ref().map(|e| e.to_string()).as_deref(),
        ),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // 发布版同一时间只运行一个实例（必须最先注册）：再次打开时把已有窗口带到前面，
    // 避免新旧两个版本同时打开、同时升级同一个数据库。开发版不限制，便于和安装版并存
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    // macOS 菜单栏换成中文（Windows / Linux 不显示菜单栏）
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);
    #[cfg(target_os = "macos")]
    let builder = builder.on_menu_event(|app, event| {
        use tauri::Emitter;
        if event.id() == menu::CHECK_UPDATE_ID {
            let _ = app.emit("menu-check-update", ());
        } else if event.id() == menu::SHOW_JOBS_ID {
            let _ = app.emit("menu-show-jobs", ());
        } else if event.id() == menu::QUIT_ID && !handlers::intercept_quit(app) {
            app.exit(0);
        }
    });
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(handlers::PendingUpdate::default())
        .plugin(tauri_plugin_process::init())
        // 有后台任务在跑时，关窗先请用户确认（前端确认后调用 quit_app）
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if handlers::intercept_quit(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // 后台任务：变化经 job-updated 事件推给前端（jobs.rs）
            let emitter = app.handle().clone();
            app.manage(jobs::Jobs::new(move |job| {
                use tauri::Emitter;
                log_job(&emitter, job);
                let _ = emitter.emit(jobs::EVENT, job);
            }));

            // 获取主窗口并打开开发者工具
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // 数据目录（发布版按 identifier 定位；开发版独立目录；可用 PINDU_DATA_DIR 覆盖），见 app_paths.rs
            // 目录或日志初始化失败也不崩溃：日志退到临时目录，前端显示错误页
            let (dirs, logger, early_failure) = startup::prepare(app.handle());
            // tracing / log / panic 都接进同一个日志（log_bridge.rs）
            log_bridge::install(&logger);
            logger.info(
                "APP",
                &format!("Application starting up (v{})", app.package_info().version),
            );
            logger.info(
                "APP",
                &format!("App data directory: {}", dirs.data.display()),
            );
            #[cfg(debug_assertions)]
            logger.info("APP", "Running in development mode with DevTools enabled");

            // 启动进度：窗口先显示启动画面（index.html），数据库在后台打开（startup::StartupState）
            app.manage(startup::StartupState::default());
            app.manage(logger.clone());
            app.manage(dirs.clone());

            // 视频库的文件经本机媒体服务给播放器（media_server.rs）；启动失败只影响视频播放
            match tauri::async_runtime::block_on(media_server::MediaServer::start(
                dirs.data.join("videos"),
                logger.clone(),
            )) {
                Ok(server) => {
                    app.manage(server);
                }
                Err(e) => logger.warn("APP", "无法启动视频播放服务", Some(&e.to_string())),
            }

            // 立即显示窗口：启动画面写在 index.html 里，第一帧就能画出来（不设原生背景色：
            // 应用主题可以和系统不同，原生侧拿不到，设了反而让 macOS 标题栏颜色不对）
            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();

            // 打开并升级数据库：失败时不崩溃、不建新库，前端显示错误页（见 startup.rs）。
            // 完成前命令入口拒绝需要数据库的命令（startup::command_guard）
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let started = std::time::Instant::now();
                let state = handle.state::<startup::StartupState>();
                if let Some(failure) = early_failure {
                    state.fail(*failure);
                    return;
                }
                match startup::open_database(&dirs, &logger, |phase, detail| {
                    state.set_phase(phase, detail)
                })
                .await
                {
                    Ok(pool) => {
                        // 自适应复习：把今天到期的复习放进今天的日程，并清理过期未练的复习（失败不影响启动）
                        if let Err(e) = services::srs::sync_all_today(&pool).await {
                            logger.warn("SRS", "启动时同步今日复习失败", Some(&e.to_string()));
                        }
                        // 日志级别：设置页保存的（未设置为默认）
                        services::log_settings::LogSettingsService::apply_saved(&pool, &logger)
                            .await;
                        // AI 任务的等待上限（设置 → AI 助手）
                        let agent_settings = services::agent_settings::AgentSettingsService::new(
                            std::sync::Arc::new(pool.clone()),
                            std::sync::Arc::new(logger.clone()),
                        );
                        if let Err(e) = agent_settings.apply_timeout().await {
                            logger.warn(
                                "AGENT",
                                "读取 AI 等待上限失败，用默认值",
                                Some(&e.to_string()),
                            );
                        }
                        handle.manage(pool);
                        state.ready();
                        logger.info(
                            "STARTUP",
                            &format!("数据已就绪（{:.1}s）", started.elapsed().as_secs_f64()),
                        );
                    }
                    Err(failure) => state.fail(*failure),
                }
            });

            Ok(())
        })
        .invoke_handler({
            let commands: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                generate_word_explanation,
                ask_word_tutor,
                generate_word_examples,
                get_word_books,
                get_word_book_detail,
                get_word_book_linked_plans,
                get_word_book_statistics,
                get_tags,
                create_tag,
                set_material_tags,
                get_passage_word_cards,
                add_passage_target_word,
                analyze_sentence,
                start_word_cards,
                get_material_settings,
                save_material_settings,
                update_material_tags,
                rename_tag,
                delete_tag,
                get_word_materials,
                get_book_word_materials,
                get_global_word_book_statistics,
                create_word_book,
                update_word_book,
                delete_word_book,
                restore_word_book,
                get_words_by_book,
                add_word_to_book,
                update_word,
                delete_words,
                find_existing_words,
                get_study_plans,
                get_study_plan,
                update_study_plan_basic_info,
                generate_study_plan_schedule,
                start_study_plan_ordering,
                preview_study_plan,
                replan_study_plan_pace,
                add_word_books_to_plan,
                create_study_plan_with_schedule,
                get_study_statistics,
                get_daily_learning_activity,
                // 学习计划状态管理命令
                start_study_plan,
                pause_study_plan,
                resume_study_plan,
                complete_study_plan,
                terminate_study_plan,
                restart_study_plan,
                publish_study_plan,
                delete_study_plan,
                get_plan_memory_overview,
                get_system_logs,
                get_log_level,
                set_log_level,
                write_client_log,
                open_log_folder,
                open_data_folder,
                get_startup_status,
                check_for_update,
                install_update,
                restart_app,
                create_word_book_from_analysis,
                get_all_ai_providers,
                get_all_ai_models,
                set_default_ai_model,
                create_ai_provider,
                update_ai_provider,
                delete_ai_provider,
                create_ai_model,
                update_ai_model,
                delete_ai_model,
                test_ai_model,
                list_provider_remote_models,
                get_agent_catalog_providers,
                get_agent_catalog_models,
                // 批量分析相关命令
                extract_words_from_text,
                generate_words_from_intent,
                suggest_vocab_topics,
                start_word_analysis,
                analyze_word,
                // 新增的学习计划单词管理命令
                get_study_plan_words,
                get_study_plan_word_books,
                batch_remove_words_from_plan,
                get_study_plan_statistics,
                // 日历相关命令
                get_calendar_month_data,
                get_today_study_schedules,
                get_study_plan_calendar_data,
                #[cfg(debug_assertions)]
                diagnose_calendar_data,
                #[cfg(debug_assertions)]
                diagnose_study_plan_data,
                #[cfg(debug_assertions)]
                diagnose_today_schedules,
                // 数据管理相关命令
                get_database_statistics,
                reset_user_data,
                reset_selected_tables,
                delete_database_and_restart,
                // 单词练习相关命令
                start_practice_session,
                submit_step_result,
                save_practice_progress,
                pause_practice_session,
                resume_practice_session,
                complete_practice_session,
                cancel_practice_session,
                get_incomplete_practice_sessions,
                get_practice_session_detail,
                get_plan_practice_sessions,
                get_study_plan_schedules,
                // TTS相关命令
                text_to_speech,
                get_tts_voices,
                get_default_tts_voice,
                clear_tts_cache,
                get_tts_cache_stats,
                get_agent_settings,
                update_agent_settings,
                get_prompt_profile,
                update_prompt_profile,
                apply_prompt_preset,
                preview_prompts,
                get_passage_word_candidates,
                get_plan_scope_counts,
                start_passage_planning,
                suggest_passage_scenes,
                start_passage_generation,
                get_passages,
                get_passage,
                get_passage_words,
                delete_passage,
                start_question_set_generation,
                get_question_set,
                delete_question_set,
                start_passage_attempt,
                submit_passage_attempt,
                regrade_passage_open,
                get_passage_statistics,
                get_plan_passages,
                set_plan_passages,
                get_today_passage_tasks,
                get_plan_passage_candidates,
                complete_plan_passage_reading,
                read_material_file,
                prepare_passage_import,
                start_passage_import,
                get_passage_new_words,
                add_passage_words_to_book,
                get_tts_config,
                update_tts_config,
                list_jobs,
                cancel_job,
                remove_job,
                clear_finished_jobs,
                quit_app,
                get_media_tools_status,
                set_ffmpeg_dir,
                start_video_import,
                get_videos,
                get_video,
                get_video_peaks,
                rename_video,
                save_video_plan,
                create_video_plan,
                rename_video_plan,
                delete_video_plan,
                set_video_subtitle_offset,
                get_clips,
                suggest_video_requirements,
                start_video_plan,
                start_video_processing,
                get_passage_video,
                delete_video,
                delete_video_source
            ];
            // 启动时数据库没打开：需要数据库的命令直接返回错误，不在取连接处崩溃（startup::command_guard）
            move |invoke: tauri::ipc::Invoke| {
                let app = invoke.message.webview().app_handle().clone();
                if let Some(error) = startup::command_guard(&app, invoke.message.command()) {
                    if let Some(logger) = app.try_state::<logger::Logger>() {
                        logger.warn(
                            "STARTUP",
                            &format!("数据库没打开，拒绝命令 {}", invoke.message.command()),
                            None,
                        );
                    }
                    invoke.resolver.reject(error);
                    return true;
                }
                commands(invoke)
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
