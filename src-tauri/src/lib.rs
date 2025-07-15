mod api;

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};
use api::{
    get_study_plans, get_study_statistics, create_study_plan,
    get_word_books, get_word_book_statistics, create_word_book,
    get_words_by_book, get_study_plan_words,
    start_study_session, submit_word_answer, end_study_session
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "Create initial tables",
            sql: "
                CREATE TABLE study_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    total_words INTEGER DEFAULT 0,
                    learned_words INTEGER DEFAULT 0,
                    accuracy_rate REAL DEFAULT 0.0,
                    mastery_level INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE word_books (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT 'book',
                    icon_color TEXT NOT NULL DEFAULT 'primary',
                    total_words INTEGER DEFAULT 0,
                    linked_plans INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE words (
                    id TEXT PRIMARY KEY,
                    word TEXT NOT NULL,
                    meaning TEXT NOT NULL,
                    description TEXT,
                    phonetic TEXT,
                    ipa TEXT,
                    syllables TEXT,
                    phonics_segments TEXT,
                    image_url TEXT,
                    word_book_id INTEGER,
                    FOREIGN KEY (word_book_id) REFERENCES word_books(id)
                );

                CREATE TABLE study_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id INTEGER NOT NULL,
                    words_studied INTEGER DEFAULT 0,
                    correct_answers INTEGER DEFAULT 0,
                    total_time INTEGER DEFAULT 0,
                    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    ended_at DATETIME,
                    FOREIGN KEY (plan_id) REFERENCES study_plans(id)
                );
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:vocabulary.db", migrations)
                .build()
        )
        .invoke_handler(tauri::generate_handler![
            get_study_plans,
            get_study_statistics,
            create_study_plan,
            get_word_books,
            get_word_book_statistics,
            create_word_book,
            get_words_by_book,
            get_study_plan_words,
            start_study_session,
            submit_word_answer,
            end_study_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

