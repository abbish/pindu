mod agent;
mod app_paths;
mod database;
mod error;
mod handlers;
mod logger;
#[cfg(target_os = "macos")]
mod menu;
mod planning_progress;
mod repositories;
mod services;
mod startup;
mod time;
mod types;

mod progress_manager;
mod prompts;

#[cfg(test)]
mod test_support;

use app_paths::AppDirs;
use handlers::*;
use logger::Logger;
use tauri::Manager;
use types::common::StartupStatus;

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
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 获取主窗口并打开开发者工具
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
                println!("Development mode: DevTools opened automatically");
            }

            // 数据目录（发布版按 identifier 定位；开发版独立目录；可用 PINDU_DATA_DIR 覆盖），见 app_paths.rs
            let dirs = AppDirs::resolve(app.handle())?;
            std::fs::create_dir_all(&dirs.data)?;
            let logger = Logger::new(&dirs.data)?;
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

            // 打开并升级数据库：失败时不崩溃、不建新库，前端显示错误页（见 startup.rs）
            let status = tauri::async_runtime::block_on(async {
                match startup::open_database(&dirs, &logger).await {
                    Ok(pool) => {
                        // 自适应复习：把今天到期的复习放进今天的日程，并清理过期未练的复习（失败不影响启动）
                        if let Err(e) = services::srs::sync_all_today(&pool).await {
                            logger.warn("SRS", "启动时同步今日复习失败", Some(&e.to_string()));
                        }
                        app.manage(pool);
                        StartupStatus {
                            ok: true,
                            failure: None,
                        }
                    }
                    Err(failure) => StartupStatus {
                        ok: false,
                        failure: Some(*failure),
                    },
                }
            });
            app.manage(status);
            app.manage(logger);
            app.manage(dirs);

            // 在初始化完成后显示窗口
            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_word_explanation,
            ask_word_tutor,
            generate_word_examples,
            get_word_books,
            get_word_book_detail,
            get_word_book_linked_plans,
            get_word_book_statistics,
            get_theme_tags,
            create_theme_tag,
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
            open_log_folder,
            open_data_folder,
            get_startup_status,
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
            get_analysis_progress,
            clear_analysis_progress,
            cancel_analysis,
            // 批量分析相关命令
            extract_words_from_text,
            generate_words_from_intent,
            analyze_extracted_words,
            get_batch_analysis_progress,
            cancel_batch_analysis,
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
            plan_passages,
            generate_passage,
            get_passages,
            get_passage,
            get_passage_words,
            delete_passage,
            generate_question_set,
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
            import_passage,
            cancel_passage_import,
            get_passage_new_words,
            add_passage_words_to_book,
            get_tts_config,
            update_tts_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
