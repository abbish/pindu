mod agent;
mod database;
mod error;
mod handlers;
mod logger;
#[cfg(target_os = "macos")]
mod menu;
mod planning_progress;
mod repositories;
mod services;
mod time;
mod types;

mod progress_manager;
mod prompts;

#[cfg(test)]
mod test_support;

use database::DatabaseManager;
use handlers::*;
use logger::Logger;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
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

            tauri::async_runtime::block_on(async {
                // 获取应用数据目录
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .expect("Failed to get app data directory");

                // 确保目录存在
                std::fs::create_dir_all(&app_data_dir)
                    .expect("Failed to create app data directory");

                // 初始化日志系统
                let logger = Logger::new(&app_data_dir).expect("Failed to initialize logger");

                logger.info("APP", "Application starting up");
                logger.info(
                    "APP",
                    &format!("App data directory: {}", app_data_dir.display()),
                );

                #[cfg(debug_assertions)]
                logger.info("APP", "Running in development mode with DevTools enabled");

                // 构建数据库路径
                let db_path = app_data_dir.join("vocabulary.db");
                let db_url = format!("sqlite:{}", db_path.to_string_lossy());

                logger.info("DATABASE", &format!("Database path: {}", db_path.display()));

                // 初始化数据库
                match DatabaseManager::new(&db_url).await {
                    Ok(db_manager) => {
                        logger.info("DATABASE", "Database connection established");

                        // 运行迁移
                        match db_manager.migrate().await {
                            Ok(_) => {
                                logger
                                    .info("DATABASE", "Database migrations completed successfully");
                            }
                            Err(e) => {
                                logger.error(
                                    "DATABASE",
                                    "Failed to run migrations",
                                    Some(&e.to_string()),
                                );
                                panic!("Failed to run migrations: {}", e);
                            }
                        }

                        let pool = db_manager.pool().clone();

                        // 自适应复习：把今天到期的复习放进今天的日程，并清理过期未练的复习（失败不影响启动）
                        if let Err(e) = services::srs::sync_all_today(&pool).await {
                            logger.warn("SRS", "启动时同步今日复习失败", Some(&e.to_string()));
                        }
                        app.manage(pool);
                        app.manage(logger);
                    }
                    Err(e) => {
                        logger.error(
                            "DATABASE",
                            "Failed to initialize database",
                            Some(&e.to_string()),
                        );
                        panic!("Failed to initialize database: {}", e);
                    }
                }
            });

            // 在初始化完成后显示窗口
            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_word_explanation,
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
