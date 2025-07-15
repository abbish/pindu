use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub message: String,
    pub code: String,
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self {
            message,
            code: "UNKNOWN_ERROR".to_string(),
        }
    }
}

impl From<&str> for ApiError {
    fn from(message: &str) -> Self {
        Self {
            message: message.to_string(),
            code: "UNKNOWN_ERROR".to_string(),
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlanWithProgress {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub status: String,
    pub total_words: i32,
    pub learned_words: i32,
    pub accuracy_rate: f64,
    pub mastery_level: i32,
    pub progress_percentage: f64,
    pub created_at: String,
    pub updated_at: String,
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
pub struct CreateStudyPlanRequest {
    pub name: String,
    pub description: String,
    pub word_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Word {
    pub id: i64,
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub phonetic: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
    pub image_path: Option<String>,
    pub audio_path: Option<String>,
    pub part_of_speech: Option<String>,
    pub difficulty_level: Option<i32>,
    pub category_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: String,
    pub icon: String,
    pub word_count: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWordRequest {
    pub word: String,
    pub meaning: String,
    pub description: Option<String>,
    pub phonetic: Option<String>,
    pub ipa: Option<String>,
    pub syllables: Option<String>,
    pub phonics_segments: Option<String>,
    pub part_of_speech: Option<String>,
    pub difficulty_level: Option<i32>,
    pub category_id: Option<i64>,
}

impl CreateWordRequest {
    pub fn validate(&self) -> Result<(), ApiError> {
        if self.word.trim().is_empty() {
            return Err(ApiError {
                message: "Word cannot be empty".to_string(),
                code: "INVALID_WORD".to_string(),
            });
        }
        
        if self.meaning.trim().is_empty() {
            return Err(ApiError {
                message: "Meaning cannot be empty".to_string(),
                code: "INVALID_MEANING".to_string(),
            });
        }
        
        if let Some(difficulty) = self.difficulty_level {
            if !(1..=5).contains(&difficulty) {
                return Err(ApiError {
                    message: "Difficulty level must be between 1 and 5".to_string(),
                    code: "INVALID_DIFFICULTY".to_string(),
                });
            }
        }
        
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetWordsQuery {
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub category_id: Option<i64>,
    pub difficulty_level: Option<i32>,
    pub search: Option<String>,
}

#[tauri::command]
pub async fn get_study_plans() -> Result<Vec<StudyPlanWithProgress>, String> {
    // Mock data for now - will be replaced with actual database queries
    let plans = vec![
        StudyPlanWithProgress {
            id: 1,
            name: "基础词汇 Level 1".to_string(),
            description: "日常生活常用单词".to_string(),
            status: "active".to_string(),
            total_words: 120,
            learned_words: 86,
            accuracy_rate: 85.0,
            mastery_level: 3,
            progress_percentage: 72.0,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-15T00:00:00Z".to_string(),
        },
        StudyPlanWithProgress {
            id: 2,
            name: "动物世界".to_string(),
            description: "各种动物的英文名称".to_string(),
            status: "paused".to_string(),
            total_words: 80,
            learned_words: 45,
            accuracy_rate: 78.0,
            mastery_level: 2,
            progress_percentage: 56.0,
            created_at: "2024-01-05T00:00:00Z".to_string(),
            updated_at: "2024-01-12T00:00:00Z".to_string(),
        },
        StudyPlanWithProgress {
            id: 3,
            name: "颜色大全".to_string(),
            description: "常见颜色的英文表达".to_string(),
            status: "completed".to_string(),
            total_words: 50,
            learned_words: 50,
            accuracy_rate: 92.0,
            mastery_level: 5,
            progress_percentage: 100.0,
            created_at: "2023-12-20T00:00:00Z".to_string(),
            updated_at: "2024-01-10T00:00:00Z".to_string(),
        },
    ];

    Ok(plans)
}

#[tauri::command]
pub async fn get_study_statistics() -> Result<StudyStatistics, String> {
    // Mock data for now - will be replaced with actual database queries
    let stats = StudyStatistics {
        total_words_learned: 250,
        average_accuracy: 85.0,
        streak_days: 12,
        completion_rate: 92.0,
        weekly_progress: vec![15, 22, 18, 28, 35, 20, 25],
    };

    Ok(stats)
}

#[tauri::command]
pub async fn create_study_plan(request: CreateStudyPlanRequest) -> Result<i64, String> {
    // Mock implementation - will be replaced with actual database operations
    println!("Creating study plan: {}", request.name);
    println!("Description: {}", request.description);
    println!("Word IDs: {:?}", request.word_ids);
    
    // Return mock plan ID
    Ok(4)
}

#[tauri::command]
pub async fn get_words(query: GetWordsQuery) -> Result<Vec<Word>, String> {
    // Mock data for now - will be replaced with actual database queries
    let mut words = vec![
        Word {
            id: 1,
            word: "Apple".to_string(),
            meaning: "苹果".to_string(),
            description: Some("一种红色或绿色的水果".to_string()),
            phonetic: Some("/ˈæpl/".to_string()),
            ipa: Some("/ˈæpl/".to_string()),
            syllables: Some("Ap-ple".to_string()),
            phonics_segments: Some("[\"Ap\", \"ple\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(1),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        Word {
            id: 2,
            word: "Cat".to_string(),
            meaning: "猫".to_string(),
            description: Some("一种常见的宠物动物".to_string()),
            phonetic: Some("/kæt/".to_string()),
            ipa: Some("/kæt/".to_string()),
            syllables: Some("Cat".to_string()),
            phonics_segments: Some("[\"C\", \"at\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(2),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        Word {
            id: 3,
            word: "Red".to_string(),
            meaning: "红色".to_string(),
            description: Some("火和血的颜色".to_string()),
            phonetic: Some("/red/".to_string()),
            ipa: Some("/red/".to_string()),
            syllables: Some("Red".to_string()),
            phonics_segments: Some("[\"R\", \"ed\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("adjective".to_string()),
            difficulty_level: Some(1),
            category_id: Some(3),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    ];

    // Apply filters
    if let Some(category_id) = query.category_id {
        words.retain(|w| w.category_id == Some(category_id));
    }
    
    if let Some(difficulty) = query.difficulty_level {
        words.retain(|w| w.difficulty_level == Some(difficulty));
    }
    
    if let Some(search) = &query.search {
        let search_lower = search.to_lowercase();
        words.retain(|w| 
            w.word.to_lowercase().contains(&search_lower) ||
            w.meaning.to_lowercase().contains(&search_lower)
        );
    }

    // Apply pagination
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(10);
    let start = ((page - 1) * page_size) as usize;
    let end = (start + page_size as usize).min(words.len());
    
    if start < words.len() {
        words = words[start..end].to_vec();
    } else {
        words = vec![];
    }

    Ok(words)
}

#[tauri::command]
pub async fn get_word_detail(word_id: i64) -> Result<Word, String> {
    // Mock data for now - will be replaced with actual database queries
    match word_id {
        1 => Ok(Word {
            id: 1,
            word: "Apple".to_string(),
            meaning: "苹果".to_string(),
            description: Some("一种红色或绿色的水果，营养丰富，富含维生素".to_string()),
            phonetic: Some("/ˈæpl/".to_string()),
            ipa: Some("/ˈæpl/".to_string()),
            syllables: Some("Ap-ple".to_string()),
            phonics_segments: Some("[\"Ap\", \"ple\"]".to_string()),
            image_path: Some("/images/apple.jpg".to_string()),
            audio_path: Some("/audio/apple.mp3".to_string()),
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(1),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }),
        _ => Err("Word not found".to_string()),
    }
}

#[tauri::command]
pub async fn create_word(request: CreateWordRequest) -> Result<i64, String> {
    // Validate request
    request.validate().map_err(|e| e.message)?;
    
    // Mock implementation - will be replaced with actual database operations
    println!("Creating word: {}", request.word);
    println!("Meaning: {}", request.meaning);
    
    // Return mock word ID
    Ok(10)
}

#[tauri::command]
pub async fn get_categories() -> Result<Vec<Category>, String> {
    // Mock data for now - will be replaced with actual database queries
    let categories = vec![
        Category {
            id: 1,
            name: "基础词汇".to_string(),
            description: Some("日常生活常用单词".to_string()),
            color: "#4ECDC4".to_string(),
            icon: "book".to_string(),
            word_count: 3,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        },
        Category {
            id: 2,
            name: "动物世界".to_string(),
            description: Some("各种动物的英文名称".to_string()),
            color: "#FF9500".to_string(),
            icon: "paw".to_string(),
            word_count: 2,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        },
        Category {
            id: 3,
            name: "颜色大全".to_string(),
            description: Some("常见颜色的英文表达".to_string()),
            color: "#9C27B0".to_string(),
            icon: "palette".to_string(),
            word_count: 2,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        },
    ];

    Ok(categories)
}

#[tauri::command]
pub async fn start_study_session(plan_id: i64) -> Result<i64, String> {
    // Mock implementation - will be replaced with actual database operations
    println!("Starting study session for plan: {}", plan_id);
    
    // Return mock session ID
    Ok(1)
}

#[tauri::command]
pub async fn end_study_session(session_id: i64, words_studied: i32, correct_answers: i32, total_time_seconds: i32) -> Result<(), String> {
    // Mock implementation - will be replaced with actual database operations
    println!("Ending study session {}: {} words studied, {} correct, {} seconds", 
             session_id, words_studied, correct_answers, total_time_seconds);
    
    Ok(())
}

#[tauri::command]
pub async fn update_word_progress(plan_id: i64, word_id: i64, is_correct: bool) -> Result<(), String> {
    // Mock implementation - will be replaced with actual database operations
    println!("Updating progress for word {} in plan {}: {}", 
             word_id, plan_id, if is_correct { "correct" } else { "incorrect" });
    
    Ok(())
}

#[tauri::command]
pub async fn upload_word_image(word_id: i64, file_path: String) -> Result<String, String> {
    // Validate file path
    if file_path.trim().is_empty() {
        return Err("File path cannot be empty".to_string());
    }
    
    // Basic validation for image file extensions
    let valid_extensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    let is_valid = valid_extensions.iter().any(|ext| file_path.to_lowercase().ends_with(ext));
    
    if !is_valid {
        return Err("Invalid image file format. Supported formats: jpg, jpeg, png, gif, webp".to_string());
    }
    
    // Mock implementation - will be replaced with actual database operations
    println!("Uploading image for word {}: {}", word_id, file_path);
    
    Ok(file_path)
}

#[tauri::command]
pub async fn upload_word_audio(word_id: i64, file_path: String) -> Result<String, String> {
    // Validate file path
    if file_path.trim().is_empty() {
        return Err("File path cannot be empty".to_string());
    }
    
    // Basic validation for audio file extensions
    let valid_extensions = [".mp3", ".wav", ".ogg", ".m4a"];
    let is_valid = valid_extensions.iter().any(|ext| file_path.to_lowercase().ends_with(ext));
    
    if !is_valid {
        return Err("Invalid audio file format. Supported formats: mp3, wav, ogg, m4a".to_string());
    }
    
    // Mock implementation - will be replaced with actual database operations
    println!("Uploading audio for word {}: {}", word_id, file_path);
    
    Ok(file_path)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyModeConfig {
    pub mode: String, // "flashcard", "quiz", "listening", "spelling"
    pub difficulty_filter: Option<i32>,
    pub category_filter: Option<i64>,
    pub word_count: i32,
    pub randomize: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyQuestion {
    pub question_id: String,
    pub question_type: String, // "meaning", "pronunciation", "spelling", "listening"
    pub word: Word,
    pub options: Option<Vec<String>>, // For multiple choice questions
    pub answer: String,
}

#[tauri::command]
pub async fn get_study_questions(config: StudyModeConfig) -> Result<Vec<StudyQuestion>, String> {
    // Mock implementation - generate study questions based on config
    let mut questions = Vec::new();
    
    // Mock words (in real implementation, this would come from database)
    let words = vec![
        Word {
            id: 1,
            word: "Apple".to_string(),
            meaning: "苹果".to_string(),
            description: Some("一种红色或绿色的水果".to_string()),
            phonetic: Some("/ˈæpl/".to_string()),
            ipa: Some("/ˈæpl/".to_string()),
            syllables: Some("Ap-ple".to_string()),
            phonics_segments: Some("[\"Ap\", \"ple\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(1),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        Word {
            id: 2,
            word: "Cat".to_string(),
            meaning: "猫".to_string(),
            description: Some("一种常见的宠物动物".to_string()),
            phonetic: Some("/kæt/".to_string()),
            ipa: Some("/kæt/".to_string()),
            syllables: Some("Cat".to_string()),
            phonics_segments: Some("[\"C\", \"at\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(2),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    ];
    
    for (i, word) in words.iter().enumerate().take(config.word_count as usize) {
        match config.mode.as_str() {
            "flashcard" => {
                questions.push(StudyQuestion {
                    question_id: format!("flashcard_{}", i + 1),
                    question_type: "meaning".to_string(),
                    word: word.clone(),
                    options: None,
                    answer: word.meaning.clone(),
                });
            },
            "quiz" => {
                questions.push(StudyQuestion {
                    question_id: format!("quiz_{}", i + 1),
                    question_type: "meaning".to_string(),
                    word: word.clone(),
                    options: Some(vec![
                        word.meaning.clone(),
                        "错误选项1".to_string(),
                        "错误选项2".to_string(),
                        "错误选项3".to_string(),
                    ]),
                    answer: word.meaning.clone(),
                });
            },
            "spelling" => {
                questions.push(StudyQuestion {
                    question_id: format!("spelling_{}", i + 1),
                    question_type: "spelling".to_string(),
                    word: word.clone(),
                    options: None,
                    answer: word.word.clone(),
                });
            },
            _ => {
                questions.push(StudyQuestion {
                    question_id: format!("default_{}", i + 1),
                    question_type: "meaning".to_string(),
                    word: word.clone(),
                    options: None,
                    answer: word.meaning.clone(),
                });
            }
        }
    }
    
    Ok(questions)
}

#[tauri::command]
pub async fn submit_study_answer(question_id: String, answer: String, is_correct: bool) -> Result<(), String> {
    // Mock implementation - record answer and update progress
    println!("Question {}: Answer '{}' is {}", 
             question_id, answer, if is_correct { "correct" } else { "incorrect" });
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordFavorite {
    pub word_id: i64,
    pub user_note: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn add_word_to_favorites(word_id: i64, note: Option<String>) -> Result<(), String> {
    // Mock implementation - add word to favorites
    println!("Adding word {} to favorites with note: {:?}", word_id, note);
    
    Ok(())
}

#[tauri::command]
pub async fn remove_word_from_favorites(word_id: i64) -> Result<(), String> {
    // Mock implementation - remove word from favorites
    println!("Removing word {} from favorites", word_id);
    
    Ok(())
}

#[tauri::command]
pub async fn get_favorite_words() -> Result<Vec<Word>, String> {
    // Mock implementation - return favorite words
    let favorites = vec![
        Word {
            id: 1,
            word: "Apple".to_string(),
            meaning: "苹果".to_string(),
            description: Some("一种红色或绿色的水果".to_string()),
            phonetic: Some("/ˈæpl/".to_string()),
            ipa: Some("/ˈæpl/".to_string()),
            syllables: Some("Ap-ple".to_string()),
            phonics_segments: Some("[\"Ap\", \"ple\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(1),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    ];
    
    Ok(favorites)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetailedStudyStats {
    pub daily_stats: Vec<DailyStudyStats>,
    pub weekly_summary: WeeklySummary,
    pub word_mastery_distribution: WordMasteryDistribution,
    pub category_progress: Vec<CategoryProgress>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyStudyStats {
    pub date: String,
    pub words_studied: i32,
    pub correct_answers: i32,
    pub total_attempts: i32,
    pub study_time_minutes: i32,
    pub accuracy_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WeeklySummary {
    pub total_words_studied: i32,
    pub total_study_time: i32,
    pub average_accuracy: f64,
    pub longest_streak: i32,
    pub current_streak: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordMasteryDistribution {
    pub beginner: i32,     // mastery < 0.3
    pub intermediate: i32, // 0.3 <= mastery < 0.7
    pub advanced: i32,     // 0.7 <= mastery < 0.9
    pub mastered: i32,     // mastery >= 0.9
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategoryProgress {
    pub category_id: i64,
    pub category_name: String,
    pub total_words: i32,
    pub learned_words: i32,
    pub progress_percentage: f64,
    pub average_accuracy: f64,
}

#[tauri::command]
pub async fn get_detailed_study_stats(days: Option<i32>) -> Result<DetailedStudyStats, String> {
    let days = days.unwrap_or(7); // Default to last 7 days
    
    // Mock implementation - generate detailed study statistics
    let mut daily_stats = Vec::new();
    
    // Generate mock daily stats for the last 'days' days
    for i in 0..days {
        daily_stats.push(DailyStudyStats {
            date: format!("2024-07-{:02}", 14 - i),
            words_studied: 15 + (i % 5),
            correct_answers: 12 + (i % 3),
            total_attempts: 18 + (i % 4),
            study_time_minutes: 25 + (i * 2),
            accuracy_rate: 75.0 + (i as f64 * 2.5),
        });
    }
    
    let weekly_summary = WeeklySummary {
        total_words_studied: 120,
        total_study_time: 180, // minutes
        average_accuracy: 82.5,
        longest_streak: 12,
        current_streak: 5,
    };
    
    let word_mastery_distribution = WordMasteryDistribution {
        beginner: 45,
        intermediate: 32,
        advanced: 18,
        mastered: 25,
    };
    
    let category_progress = vec![
        CategoryProgress {
            category_id: 1,
            category_name: "基础词汇".to_string(),
            total_words: 50,
            learned_words: 38,
            progress_percentage: 76.0,
            average_accuracy: 85.2,
        },
        CategoryProgress {
            category_id: 2,
            category_name: "动物世界".to_string(),
            total_words: 30,
            learned_words: 22,
            progress_percentage: 73.3,
            average_accuracy: 79.1,
        },
        CategoryProgress {
            category_id: 3,
            category_name: "颜色大全".to_string(),
            total_words: 20,
            learned_words: 18,
            progress_percentage: 90.0,
            average_accuracy: 92.5,
        },
    ];
    
    Ok(DetailedStudyStats {
        daily_stats,
        weekly_summary,
        word_mastery_distribution,
        category_progress,
    })
}

#[tauri::command]
pub async fn get_words_for_review() -> Result<Vec<Word>, String> {
    // Mock implementation - return words that need review based on spaced repetition
    let review_words = vec![
        Word {
            id: 5,
            word: "Challenge".to_string(),
            meaning: "挑战".to_string(),
            description: Some("困难的任务或情况".to_string()),
            phonetic: Some("/ˈtʃælɪndʒ/".to_string()),
            ipa: Some("/ˈtʃælɪndʒ/".to_string()),
            syllables: Some("Chal-lenge".to_string()),
            phonics_segments: Some("[\"Chal\", \"lenge\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(3),
            category_id: Some(1),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
        Word {
            id: 6,
            word: "Elephant".to_string(),
            meaning: "大象".to_string(),
            description: Some("大型哺乳动物".to_string()),
            phonetic: Some("/ˈelɪfənt/".to_string()),
            ipa: Some("/ˈelɪfənt/".to_string()),
            syllables: Some("El-e-phant".to_string()),
            phonics_segments: Some("[\"El\", \"e\", \"phant\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(2),
            category_id: Some(2),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        },
    ];
    
    Ok(review_words)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyReminder {
    pub id: i64,
    pub title: String,
    pub message: String,
    pub scheduled_time: String,
    pub is_active: bool,
    pub repeat_type: String, // "daily", "weekly", "custom"
}

#[tauri::command]
pub async fn set_study_reminder(title: String, message: String, scheduled_time: String, repeat_type: String) -> Result<i64, String> {
    // Mock implementation - create a study reminder
    println!("Setting study reminder: {} at {} ({})", title, scheduled_time, repeat_type);
    
    // Return mock reminder ID
    Ok(1)
}

#[tauri::command]
pub async fn get_study_reminders() -> Result<Vec<StudyReminder>, String> {
    // Mock implementation - return active study reminders
    let reminders = vec![
        StudyReminder {
            id: 1,
            title: "每日英语学习".to_string(),
            message: "该学习新单词了！".to_string(),
            scheduled_time: "09:00".to_string(),
            is_active: true,
            repeat_type: "daily".to_string(),
        },
        StudyReminder {
            id: 2,
            title: "复习时间".to_string(),
            message: "复习之前学过的单词".to_string(),
            scheduled_time: "19:00".to_string(),
            is_active: true,
            repeat_type: "daily".to_string(),
        },
    ];
    
    Ok(reminders)
}

#[tauri::command]
pub async fn update_reminder_status(reminder_id: i64, is_active: bool) -> Result<(), String> {
    // Mock implementation - update reminder status
    println!("Updating reminder {} status to {}", reminder_id, is_active);
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpacedRepetitionResult {
    pub next_review_date: String,
    pub difficulty_multiplier: f64,
    pub interval_days: i32,
    pub repetition_count: i32,
}

#[tauri::command]
pub async fn calculate_next_review(word_id: i64, quality: i32) -> Result<SpacedRepetitionResult, String> {
    // 实现超级记忆算法 (SuperMemo-like algorithm)
    // quality: 0-5 评分 (0=完全不记得, 5=完美记住)
    
    if !(0..=5).contains(&quality) {
        return Err("Quality must be between 0 and 5".to_string());
    }
    
    // 模拟从数据库获取当前间隔和重复次数
    let current_interval = 1; // 默认1天
    let current_repetition = 0; // 默认第一次
    let current_easiness = 2.5; // 默认难度系数
    
    let mut easiness_factor = current_easiness;
    let mut interval = current_interval;
    let mut repetition = current_repetition + 1;
    
    // 更新难度系数
    easiness_factor = easiness_factor + (0.1 - (5.0 - quality as f64) * (0.08 + (5.0 - quality as f64) * 0.02));
    easiness_factor = easiness_factor.max(1.3);
    
    // 计算下次复习间隔
    if quality < 3 {
        // 回答质量差，重新开始
        repetition = 1;
        interval = 1;
    } else {
        match repetition {
            1 => interval = 1,
            2 => interval = 6,
            _ => interval = (interval as f64 * easiness_factor).round() as i32,
        }
    }
    
    // 计算下次复习日期 - 使用简单的字符串格式避免 chrono 依赖
    let next_review_date = format!("2024-07-{:02} 09:00:00", 14 + interval);
    
    Ok(SpacedRepetitionResult {
        next_review_date,
        difficulty_multiplier: easiness_factor,
        interval_days: interval,
        repetition_count: repetition,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Achievement {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub category: String, // "daily", "milestone", "streak", "mastery"
    pub requirement: i32,
    pub current_progress: i32,
    pub is_unlocked: bool,
    pub unlocked_at: Option<String>,
}

#[tauri::command]
pub async fn get_achievements() -> Result<Vec<Achievement>, String> {
    // 模拟成就系统
    let achievements = vec![
        Achievement {
            id: 1,
            title: "初学者".to_string(),
            description: "学习第一个单词".to_string(),
            icon: "🌱".to_string(),
            category: "milestone".to_string(),
            requirement: 1,
            current_progress: 1,
            is_unlocked: true,
            unlocked_at: Some("2024-07-01T00:00:00Z".to_string()),
        },
        Achievement {
            id: 2,
            title: "词汇达人".to_string(),
            description: "学习100个单词".to_string(),
            icon: "📚".to_string(),
            category: "milestone".to_string(),
            requirement: 100,
            current_progress: 45,
            is_unlocked: false,
            unlocked_at: None,
        },
        Achievement {
            id: 3,
            title: "连续学习者".to_string(),
            description: "连续学习7天".to_string(),
            icon: "🔥".to_string(),
            category: "streak".to_string(),
            requirement: 7,
            current_progress: 5,
            is_unlocked: false,
            unlocked_at: None,
        },
        Achievement {
            id: 4,
            title: "单词大师".to_string(),
            description: "掌握50个单词".to_string(),
            icon: "👑".to_string(),
            category: "mastery".to_string(),
            requirement: 50,
            current_progress: 23,
            is_unlocked: false,
            unlocked_at: None,
        },
        Achievement {
            id: 5,
            title: "今日学者".to_string(),
            description: "今天学习20个单词".to_string(),
            icon: "⭐".to_string(),
            category: "daily".to_string(),
            requirement: 20,
            current_progress: 12,
            is_unlocked: false,
            unlocked_at: None,
        },
    ];
    
    Ok(achievements)
}

#[tauri::command]
pub async fn check_achievement_progress(action_type: String, count: i32) -> Result<Vec<Achievement>, String> {
    // 检查成就进度并返回新解锁的成就
    // action_type: "word_learned", "study_session", "daily_goal", etc.
    
    println!("Checking achievement progress for action: {} with count: {}", action_type, count);
    
    // 模拟检查逻辑
    let mut newly_unlocked = Vec::new();
    
    match action_type.as_str() {
        "word_learned" => {
            if count == 1 {
                newly_unlocked.push(Achievement {
                    id: 1,
                    title: "初学者".to_string(),
                    description: "学习第一个单词".to_string(),
                    icon: "🌱".to_string(),
                    category: "milestone".to_string(),
                    requirement: 1,
                    current_progress: 1,
                    is_unlocked: true,
                    unlocked_at: Some("2024-07-14 10:00:00".to_string()),
                });
            }
        },
        "daily_goal" => {
            if count >= 20 {
                newly_unlocked.push(Achievement {
                    id: 5,
                    title: "今日学者".to_string(),
                    description: "今天学习20个单词".to_string(),
                    icon: "⭐".to_string(),
                    category: "daily".to_string(),
                    requirement: 20,
                    current_progress: count,
                    is_unlocked: true,
                    unlocked_at: Some("2024-07-14 15:30:00".to_string()),
                });
            }
        },
        _ => {}
    }
    
    Ok(newly_unlocked)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordRecommendation {
    pub word: Word,
    pub reason: String, // "similar_difficulty", "same_category", "trending", "review_needed"
    pub confidence_score: f64,
}

#[tauri::command]
pub async fn get_word_recommendations(user_level: Option<i32>, category_preference: Option<i64>, limit: Option<i32>) -> Result<Vec<WordRecommendation>, String> {
    let limit = limit.unwrap_or(5);
    let user_level = user_level.unwrap_or(1);
    
    // 模拟推荐算法
    let mut recommendations = Vec::new();
    
    // 基于用户水平推荐
    recommendations.push(WordRecommendation {
        word: Word {
            id: 10,
            word: "Beautiful".to_string(),
            meaning: "美丽的".to_string(),
            description: Some("形容外观或声音令人愉悦".to_string()),
            phonetic: Some("/ˈbjuːtɪfəl/".to_string()),
            ipa: Some("/ˈbjuːtɪfəl/".to_string()),
            syllables: Some("Beau-ti-ful".to_string()),
            phonics_segments: Some("[\"Beau\", \"ti\", \"ful\"]".to_string()),
            image_path: None,
            audio_path: None,
            part_of_speech: Some("adjective".to_string()),
            difficulty_level: Some(user_level),
            category_id: category_preference,
            created_at: "2024-07-14T00:00:00Z".to_string(),
            updated_at: "2024-07-14T00:00:00Z".to_string(),
        },
        reason: "适合你当前水平的单词".to_string(),
        confidence_score: 0.85,
    });
    
    // 基于分类推荐
    if let Some(cat_id) = category_preference {
        recommendations.push(WordRecommendation {
            word: Word {
                id: 11,
                word: "Wonderful".to_string(),
                meaning: "精彩的".to_string(),
                description: Some("令人惊奇或钦佩的".to_string()),
                phonetic: Some("/ˈwʌndəfəl/".to_string()),
                ipa: Some("/ˈwʌndəfəl/".to_string()),
                syllables: Some("Won-der-ful".to_string()),
                phonics_segments: Some("[\"Won\", \"der\", \"ful\"]".to_string()),
                image_path: None,
                audio_path: None,
                part_of_speech: Some("adjective".to_string()),
                difficulty_level: Some(user_level),
                category_id: Some(cat_id),
                created_at: "2024-07-14T00:00:00Z".to_string(),
                updated_at: "2024-07-14T00:00:00Z".to_string(),
            },
            reason: "同分类的热门单词".to_string(),
            confidence_score: 0.78,
        });
    }
    
    // 限制返回数量
    recommendations.truncate(limit as usize);
    
    Ok(recommendations)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub words: Vec<Word>,
    pub categories: Vec<Category>,
    pub study_plans: Vec<StudyPlanWithProgress>,
    pub export_date: String,
    pub version: String,
}

#[tauri::command]
pub async fn export_user_data(include_progress: bool) -> Result<String, String> {
    // 导出用户数据为JSON格式
    
    let export_data = ExportData {
        words: vec![
            // 示例数据
            Word {
                id: 1,
                word: "Apple".to_string(),
                meaning: "苹果".to_string(),
                description: Some("一种红色或绿色的水果".to_string()),
                phonetic: Some("/ˈæpl/".to_string()),
                ipa: Some("/ˈæpl/".to_string()),
                syllables: Some("Ap-ple".to_string()),
                phonics_segments: Some("[\"Ap\", \"ple\"]".to_string()),
                image_path: None,
                audio_path: None,
                part_of_speech: Some("noun".to_string()),
                difficulty_level: Some(1),
                category_id: Some(1),
                created_at: "2024-01-01T00:00:00Z".to_string(),
                updated_at: "2024-01-01T00:00:00Z".to_string(),
            },
        ],
        categories: vec![
            Category {
                id: 1,
                name: "基础词汇".to_string(),
                description: Some("日常生活常用单词".to_string()),
                color: "#4ECDC4".to_string(),
                icon: "book".to_string(),
                word_count: 1,
                created_at: "2024-01-01T00:00:00Z".to_string(),
            },
        ],
        study_plans: if include_progress {
            vec![
                StudyPlanWithProgress {
                    id: 1,
                    name: "基础词汇 Level 1".to_string(),
                    description: "日常生活常用单词".to_string(),
                    status: "active".to_string(),
                    total_words: 10,
                    learned_words: 5,
                    accuracy_rate: 85.0,
                    mastery_level: 2,
                    progress_percentage: 50.0,
                    created_at: "2024-01-01T00:00:00Z".to_string(),
                    updated_at: "2024-07-14T00:00:00Z".to_string(),
                },
            ]
        } else {
            vec![]
        },
        export_date: "2024-07-14 16:00:00".to_string(),
        version: "1.0.0".to_string(),
    };
    
    // 序列化为JSON
    match serde_json::to_string_pretty(&export_data) {
        Ok(json_string) => Ok(json_string),
        Err(e) => Err(format!("Failed to export data: {}", e)),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: bool,
    pub imported_words: i32,
    pub imported_categories: i32,
    pub imported_plans: i32,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn import_user_data(json_data: String) -> Result<ImportResult, String> {
    // 导入用户数据
    
    match serde_json::from_str::<ExportData>(&json_data) {
        Ok(import_data) => {
            let mut errors = Vec::new();
            
            // 验证数据格式
            if import_data.version != "1.0.0" {
                errors.push("Unsupported data version".to_string());
            }
            
            // 模拟导入过程
            let imported_words = import_data.words.len() as i32;
            let imported_categories = import_data.categories.len() as i32;
            let imported_plans = import_data.study_plans.len() as i32;
            
            println!("Importing {} words, {} categories, {} plans", 
                     imported_words, imported_categories, imported_plans);
            
            Ok(ImportResult {
                success: errors.is_empty(),
                imported_words,
                imported_categories,
                imported_plans,
                errors,
            })
        },
        Err(e) => Err(format!("Invalid JSON format: {}", e)),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LearningAnalysis {
    pub user_level: i32,
    pub strength_areas: Vec<String>,
    pub weakness_areas: Vec<String>,
    pub recommended_focus: String,
    pub learning_efficiency: f64,
    pub next_milestone: String,
}

#[tauri::command]
pub async fn analyze_learning_progress() -> Result<LearningAnalysis, String> {
    // 分析用户学习进度和模式
    
    // 模拟分析算法
    let analysis = LearningAnalysis {
        user_level: 2,
        strength_areas: vec![
            "基础词汇理解".to_string(),
            "名词学习".to_string(),
            "视觉记忆".to_string(),
        ],
        weakness_areas: vec![
            "形容词拼写".to_string(),
            "长单词记忆".to_string(),
            "发音准确性".to_string(),
        ],
        recommended_focus: "建议多练习形容词的拼写和发音".to_string(),
        learning_efficiency: 0.78,
        next_milestone: "掌握100个基础词汇".to_string(),
    };
    
    Ok(analysis)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonalizedPlan {
    pub plan_id: i64,
    pub name: String,
    pub daily_target: i32,
    pub estimated_days: i32,
    pub focus_areas: Vec<String>,
    pub difficulty_progression: Vec<i32>,
    pub word_selection_strategy: String,
}

#[tauri::command]
pub async fn generate_personalized_plan(target_words: i32, available_time_minutes: i32, focus_category: Option<i64>) -> Result<PersonalizedPlan, String> {
    // 基于用户情况生成个性化学习计划
    
    let daily_words = (available_time_minutes / 3).max(5).min(50); // 每个单词大约3分钟
    let estimated_days = (target_words as f64 / daily_words as f64).ceil() as i32;
    
    let plan = PersonalizedPlan {
        plan_id: 99,
        name: format!("个性化学习计划 - {} 个单词", target_words),
        daily_target: daily_words,
        estimated_days,
        focus_areas: vec![
            "基础词汇".to_string(),
            "常用动词".to_string(),
            "日常形容词".to_string(),
        ],
        difficulty_progression: vec![1, 1, 2, 2, 3], // 递进难度
        word_selection_strategy: "基于遗忘曲线和用户弱点".to_string(),
    };
    
    Ok(plan)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGoal {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub target_value: i32,
    pub current_value: i32,
    pub deadline: String,
    pub goal_type: String, // "daily", "weekly", "monthly", "custom"
    pub is_active: bool,
    pub reward: Option<String>,
}

#[tauri::command]
pub async fn get_study_goals() -> Result<Vec<StudyGoal>, String> {
    // 获取学习目标列表
    
    let goals = vec![
        StudyGoal {
            id: 1,
            title: "每日单词目标".to_string(),
            description: "每天学习20个新单词".to_string(),
            target_value: 20,
            current_value: 12,
            deadline: "2024-07-14 23:59:59".to_string(),
            goal_type: "daily".to_string(),
            is_active: true,
            reward: Some("解锁新徽章".to_string()),
        },
        StudyGoal {
            id: 2,
            title: "本周学习目标".to_string(),
            description: "本周完成100个单词的学习".to_string(),
            target_value: 100,
            current_value: 67,
            deadline: "2024-07-20 23:59:59".to_string(),
            goal_type: "weekly".to_string(),
            is_active: true,
            reward: Some("获得特殊头像".to_string()),
        },
        StudyGoal {
            id: 3,
            title: "本月掌握目标".to_string(),
            description: "本月掌握200个单词".to_string(),
            target_value: 200,
            current_value: 89,
            deadline: "2024-07-31 23:59:59".to_string(),
            goal_type: "monthly".to_string(),
            is_active: true,
            reward: Some("解锁高级功能".to_string()),
        },
    ];
    
    Ok(goals)
}

#[tauri::command]
pub async fn create_study_goal(title: String, description: String, target_value: i32, deadline: String, goal_type: String) -> Result<i64, String> {
    // 创建新的学习目标
    
    // 验证输入
    if title.trim().is_empty() {
        return Err("Goal title cannot be empty".to_string());
    }
    
    if target_value <= 0 {
        return Err("Target value must be positive".to_string());
    }
    
    if !["daily", "weekly", "monthly", "custom"].contains(&goal_type.as_str()) {
        return Err("Invalid goal type".to_string());
    }
    
    println!("Creating goal: {} with target {} by {}", title, target_value, deadline);
    
    // 返回模拟的目标ID
    Ok(4)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LearningStreak {
    pub current_streak: i32,
    pub longest_streak: i32,
    pub streak_start_date: String,
    pub last_study_date: String,
    pub streak_milestones: Vec<StreakMilestone>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StreakMilestone {
    pub days: i32,
    pub title: String,
    pub reward: String,
    pub achieved: bool,
    pub achieved_date: Option<String>,
}

#[tauri::command]
pub async fn get_learning_streak() -> Result<LearningStreak, String> {
    // 获取学习连击信息
    
    let streak = LearningStreak {
        current_streak: 5,
        longest_streak: 12,
        streak_start_date: "2024-07-09".to_string(),
        last_study_date: "2024-07-14".to_string(),
        streak_milestones: vec![
            StreakMilestone {
                days: 3,
                title: "坚持学习3天".to_string(),
                reward: "青铜徽章".to_string(),
                achieved: true,
                achieved_date: Some("2024-07-11".to_string()),
            },
            StreakMilestone {
                days: 7,
                title: "坚持学习1周".to_string(),
                reward: "银质徽章".to_string(),
                achieved: false,
                achieved_date: None,
            },
            StreakMilestone {
                days: 30,
                title: "坚持学习1个月".to_string(),
                reward: "金质徽章".to_string(),
                achieved: false,
                achieved_date: None,
            },
        ],
    };
    
    Ok(streak)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DifficultyAdjustment {
    pub recommended_difficulty: i32,
    pub reason: String,
    pub confidence: f64,
    pub adjustment_type: String, // "increase", "decrease", "maintain"
}

#[tauri::command]
pub async fn suggest_difficulty_adjustment(recent_accuracy: f64, study_time_seconds: i32, word_count: i32) -> Result<DifficultyAdjustment, String> {
    // 根据学习表现建议难度调整
    
    let avg_time_per_word = study_time_seconds as f64 / word_count as f64;
    
    let adjustment = if recent_accuracy > 0.9 && avg_time_per_word < 30.0 {
        DifficultyAdjustment {
            recommended_difficulty: 3,
            reason: "准确率很高且答题速度快，建议提高难度".to_string(),
            confidence: 0.85,
            adjustment_type: "increase".to_string(),
        }
    } else if recent_accuracy < 0.6 || avg_time_per_word > 60.0 {
        DifficultyAdjustment {
            recommended_difficulty: 1,
            reason: "准确率较低或答题时间过长，建议降低难度".to_string(),
            confidence: 0.78,
            adjustment_type: "decrease".to_string(),
        }
    } else {
        DifficultyAdjustment {
            recommended_difficulty: 2,
            reason: "当前难度适合，继续保持".to_string(),
            confidence: 0.65,
            adjustment_type: "maintain".to_string(),
        }
    };
    
    Ok(adjustment)
}