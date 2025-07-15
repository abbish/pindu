use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_sql::{Migration, MigrationKind};

// ===== 核心数据结构 =====

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyPlan {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub status: String, // "active", "paused", "completed"
    pub total_words: i32,
    pub learned_words: i32,
    pub accuracy_rate: f64,
    pub mastery_level: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanWithProgress {
    #[serde(flatten)]
    pub plan: StudyPlan,
    pub progress_percentage: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyStatistics {
    pub total_words_learned: i32,
    pub average_accuracy: f64,
    pub streak_days: i32,
    pub completion_rate: f64,
    pub weekly_progress: Vec<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordBook {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub icon_color: String,
    pub total_words: i32,
    pub linked_plans: i32,
    pub word_types: WordTypes,
    pub created_at: String,
    pub last_used: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordTypes {
    pub nouns: i32,
    pub verbs: i32,
    pub adjectives: i32,
    pub others: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordBookStatistics {
    pub total_books: i32,
    pub total_words: i32,
    pub nouns: i32,
    pub verbs: i32,
    pub adjectives: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Word {
    pub id: String,
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub phonetic: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<Vec<String>>,
    pub image_url: Option<String>,
    pub word_book_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateStudyPlanRequest {
    pub name: String,
    pub description: String,
    pub word_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordBookRequest {
    pub title: String,
    pub description: String,
    pub icon: String,
    pub icon_color: String,
}

// ===== API 实现 =====

#[tauri::command]
pub async fn get_study_plans(app: AppHandle) -> Result<Vec<StudyPlanWithProgress>, String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let query = "
        SELECT id, name, description, status, total_words, learned_words, 
               accuracy_rate, mastery_level, created_at, updated_at
        FROM study_plans
        ORDER BY created_at DESC
    ";
    
    let rows = tauri_plugin_sql::query(&**db, "sqlite:vocabulary.db", query, [])
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut plans = Vec::new();
    for row in rows {
        let total_words: i32 = row.get("total_words").unwrap_or(0);
        let learned_words: i32 = row.get("learned_words").unwrap_or(0);
        let progress_percentage = if total_words > 0 {
            (learned_words as f64 / total_words as f64) * 100.0
        } else {
            0.0
        };
        
        plans.push(StudyPlanWithProgress {
            plan: StudyPlan {
                id: row.get("id").unwrap_or(0),
                name: row.get("name").unwrap_or_default(),
                description: row.get("description").unwrap_or_default(),
                status: row.get("status").unwrap_or_default(),
                total_words,
                learned_words,
                accuracy_rate: row.get("accuracy_rate").unwrap_or(0.0),
                mastery_level: row.get("mastery_level").unwrap_or(1),
                created_at: row.get("created_at").unwrap_or_default(),
                updated_at: row.get("updated_at").unwrap_or_default(),
            },
            progress_percentage,
        });
    }
    
    // 如果没有数据，插入一些示例数据
    if plans.is_empty() {
        let insert_query = "
            INSERT INTO study_plans (name, description, status, total_words, learned_words, accuracy_rate, mastery_level)
            VALUES 
                ('基础词汇 Level 1', '日常生活常用单词', 'active', 120, 86, 85.0, 3),
                ('动物世界', '各种动物的英文名称', 'paused', 80, 45, 78.0, 2),
                ('颜色大全', '常见颜色的英文表达', 'completed', 50, 50, 92.0, 5)
        ";
        
        tauri_plugin_sql::execute(&**db, "sqlite:vocabulary.db", insert_query, [])
            .await
            .map_err(|e| format!("Failed to insert sample data: {}", e))?;
        
        // 重新查询
        return get_study_plans(app).await;
    }
    
    Ok(plans)
}

#[tauri::command]
pub async fn get_study_statistics(app: AppHandle) -> Result<StudyStatistics, String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let query = "
        SELECT 
            COALESCE(SUM(learned_words), 0) as total_words_learned,
            COALESCE(AVG(accuracy_rate), 0.0) as average_accuracy,
            COUNT(*) as total_plans
        FROM study_plans
    ";
    
    let rows = tauri_plugin_sql::query(&**db, "sqlite:vocabulary.db", query, [])
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    let row = rows.first().ok_or("No statistics found")?;
    let total_words_learned: i32 = row.get("total_words_learned").unwrap_or(0);
    let average_accuracy: f64 = row.get("average_accuracy").unwrap_or(0.0);
    let total_plans: i32 = row.get("total_plans").unwrap_or(0);
    
    let completion_rate = if total_plans > 0 {
        let completed_query = "SELECT COUNT(*) as completed FROM study_plans WHERE status = 'completed'";
        let completed_rows = tauri_plugin_sql::query(&**db, "sqlite:vocabulary.db", completed_query, [])
            .await
            .map_err(|e| format!("Database error: {}", e))?;
        
        if let Some(completed_row) = completed_rows.first() {
            let completed: i32 = completed_row.get("completed").unwrap_or(0);
            (completed as f64 / total_plans as f64) * 100.0
        } else {
            0.0
        }
    } else {
        0.0
    };
    
    let stats = StudyStatistics {
        total_words_learned,
        average_accuracy,
        streak_days: 12, // TODO: 实际计算连续学习天数
        completion_rate,
        weekly_progress: vec![15, 22, 18, 28, 35, 20, 25], // TODO: 实际查询每周进度
    };

    Ok(stats)
}

#[tauri::command]
pub async fn create_study_plan(app: AppHandle, request: CreateStudyPlanRequest) -> Result<i64, String> {
    if request.name.trim().is_empty() {
        return Err("计划名称不能为空".to_string());
    }

    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let insert_query = "
        INSERT INTO study_plans (name, description, total_words)
        VALUES (?, ?, ?)
    ";
    
    let result = tauri_plugin_sql::execute(
        &**db, 
        "sqlite:vocabulary.db", 
        insert_query, 
        [&request.name, &request.description, &request.word_ids.len().to_string()]
    ).await.map_err(|e| format!("Failed to create study plan: {}", e))?;
    
    Ok(result.last_insert_id)
}

#[tauri::command]
pub async fn get_word_books(app: AppHandle) -> Result<Vec<WordBook>, String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let query = "
        SELECT wb.id, wb.title, wb.description, wb.icon, wb.icon_color, 
               wb.total_words, wb.linked_plans, wb.created_at, wb.last_used
        FROM word_books wb
        ORDER BY wb.last_used DESC, wb.created_at DESC
    ";
    
    let rows = tauri_plugin_sql::query(&**db, "sqlite:vocabulary.db", query, [])
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut books = Vec::new();
    for row in rows {
        // TODO: 实际计算单词类型统计
        let word_types = WordTypes {
            nouns: 45,
            verbs: 32,
            adjectives: 28,
            others: 15,
        };
        
        books.push(WordBook {
            id: row.get("id").unwrap_or(0),
            title: row.get("title").unwrap_or_default(),
            description: row.get("description").unwrap_or_default(),
            icon: row.get("icon").unwrap_or_default(),
            icon_color: row.get("icon_color").unwrap_or_default(),
            total_words: row.get("total_words").unwrap_or(0),
            linked_plans: row.get("linked_plans").unwrap_or(0),
            word_types,
            created_at: row.get("created_at").unwrap_or_default(),
            last_used: row.get("last_used").unwrap_or_default(),
        });
    }
    
    // 如果没有数据，插入示例数据
    if books.is_empty() {
        let insert_query = "
            INSERT INTO word_books (title, description, icon, icon_color, total_words, linked_plans)
            VALUES 
                ('基础生活词汇', '日常生活中最常用的英语单词，包括家庭、购物、交通等场景', 'home', 'primary', 120, 3),
                ('动物世界', '各种动物的英文名称，包括宠物、野生动物、海洋生物等', 'paw', 'orange', 80, 2),
                ('食物与饮料', '各种食物和饮料的英文表达，包括水果、蔬菜、主食等', 'utensils', 'yellow', 95, 1)
        ";
        
        tauri_plugin_sql::execute(&**db, "sqlite:vocabulary.db", insert_query, [])
            .await
            .map_err(|e| format!("Failed to insert sample data: {}", e))?;
        
        return get_word_books(app).await;
    }
    
    Ok(books)
}

#[tauri::command]
pub async fn get_word_book_statistics(app: AppHandle) -> Result<WordBookStatistics, String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let query = "
        SELECT 
            COUNT(*) as total_books,
            COALESCE(SUM(total_words), 0) as total_words
        FROM word_books
    ";
    
    let rows = tauri_plugin_sql::query(&**db, "sqlite:vocabulary.db", query, [])
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    let row = rows.first().ok_or("No statistics found")?;
    let total_books: i32 = row.get("total_books").unwrap_or(0);
    let total_words: i32 = row.get("total_words").unwrap_or(0);
    
    // TODO: 实际计算单词类型统计
    let stats = WordBookStatistics {
        total_books,
        total_words,
        nouns: 520,
        verbs: 342,
        adjectives: 258,
    };

    Ok(stats)
}

#[tauri::command]
pub async fn create_word_book(app: AppHandle, request: CreateWordBookRequest) -> Result<i64, String> {
    if request.title.trim().is_empty() {
        return Err("单词本标题不能为空".to_string());
    }

    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let insert_query = "
        INSERT INTO word_books (title, description, icon, icon_color)
        VALUES (?, ?, ?, ?)
    ";
    
    let result = tauri_plugin_sql::execute(
        &**db, 
        "sqlite:vocabulary.db", 
        insert_query, 
        [&request.title, &request.description, &request.icon, &request.icon_color]
    ).await.map_err(|e| format!("Failed to create word book: {}", e))?;
    
    Ok(result.last_insert_id)
}

#[tauri::command]
pub async fn get_words_by_book(app: AppHandle, book_id: i64) -> Result<Vec<Word>, String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let query = "
        SELECT id, word, meaning, description, phonetic, ipa, syllables, 
               phonics_segments, image_url, word_book_id
        FROM words
        WHERE word_book_id = ?
        ORDER BY word ASC
    ";
    
    let rows = tauri_plugin_sql::query(&**db, "sqlite:vocabulary.db", query, [book_id])
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut words = Vec::new();
    for row in rows {
        let phonics_segments_str: Option<String> = row.get("phonics_segments");
        let phonics_segments = phonics_segments_str.and_then(|s| {
            serde_json::from_str::<Vec<String>>(&s).ok()
        });
        
        words.push(Word {
            id: row.get("id").unwrap_or_default(),
            word: row.get("word").unwrap_or_default(),
            meaning: row.get("meaning").unwrap_or_default(),
            description: row.get("description"),
            phonetic: row.get("phonetic"),
            ipa: row.get("ipa"),
            syllables: row.get("syllables"),
            phonics_segments,
            image_url: row.get("image_url"),
            word_book_id: row.get("word_book_id"),
        });
    }
    
    // 如果没有单词，插入示例数据
    if words.is_empty() && book_id <= 3 {
        let sample_words = match book_id {
            1 => vec![
                ("1", "Apple", "苹果", "一种红色或绿色的水果", "/ˈæpl/", "Ap-ple", r#"["Ap", "ple"]"#),
                ("2", "Water", "水", "无色无味的液体", "/ˈwɔːtər/", "Wa-ter", r#"["Wa", "ter"]"#),
            ],
            2 => vec![
                ("3", "Cat", "猫", "一种常见的宠物动物", "/kæt/", "Cat", r#"["C", "at"]"#),
                ("4", "Dog", "狗", "人类的好朋友", "/dɔːɡ/", "Dog", r#"["D", "og"]"#),
            ],
            3 => vec![
                ("5", "Bread", "面包", "日常主食", "/bred/", "Bread", r#"["Br", "ead"]"#),
                ("6", "Milk", "牛奶", "白色的营养饮品", "/mɪlk/", "Milk", r#"["M", "ilk"]"#),
            ],
            _ => vec![],
        };
        
        for (id, word, meaning, desc, ipa, syllables, phonics) in sample_words {
            let insert_query = "
                INSERT INTO words (id, word, meaning, description, ipa, syllables, phonics_segments, word_book_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ";
            
            tauri_plugin_sql::execute(
                &**db,
                "sqlite:vocabulary.db",
                insert_query,
                [id, word, meaning, desc, ipa, syllables, phonics, &book_id.to_string()]
            ).await.map_err(|e| format!("Failed to insert sample words: {}", e))?;
        }
        
        return get_words_by_book(app, book_id).await;
    }
    
    Ok(words)
}

#[tauri::command]
pub async fn get_study_plan_words(app: AppHandle, plan_id: i64) -> Result<Vec<Word>, String> {
    // 暂时返回第一个单词本的单词作为学习计划的单词
    // TODO: 实现学习计划与单词的关联关系
    get_words_by_book(app, 1).await
}

// 学习会话管理
#[tauri::command]
pub async fn start_study_session(app: AppHandle, plan_id: i64) -> Result<i64, String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let insert_query = "
        INSERT INTO study_sessions (plan_id)
        VALUES (?)
    ";
    
    let result = tauri_plugin_sql::execute(
        &**db, 
        "sqlite:vocabulary.db", 
        insert_query, 
        [plan_id]
    ).await.map_err(|e| format!("Failed to start study session: {}", e))?;
    
    Ok(result.last_insert_id)
}

#[tauri::command]
pub async fn submit_word_answer(
    session_id: i64,
    word_id: String,
    user_answer: String,
    is_correct: bool,
    time_spent: i32,
) -> Result<(), String> {
    // TODO: 记录用户答案到数据库
    println!("Session {}: Word {} - Answer: {} ({})", 
             session_id, word_id, user_answer, if is_correct { "correct" } else { "incorrect" });
    
    Ok(())
}

#[tauri::command]
pub async fn end_study_session(
    app: AppHandle,
    session_id: i64,
    words_studied: i32,
    correct_answers: i32,
    total_time: i32,
) -> Result<(), String> {
    let db = app.state::<tauri_plugin_sql::DbPool>();
    
    let update_query = "
        UPDATE study_sessions 
        SET words_studied = ?, correct_answers = ?, total_time = ?, ended_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ";
    
    tauri_plugin_sql::execute(
        &**db,
        "sqlite:vocabulary.db",
        update_query,
        [words_studied, correct_answers, total_time, session_id as i32]
    ).await.map_err(|e| format!("Failed to end study session: {}", e))?;
    
    Ok(())
}