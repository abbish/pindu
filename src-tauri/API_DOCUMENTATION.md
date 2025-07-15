# RedLark 词汇学习应用 API 文档

本文档描述了 RedLark 词汇学习应用的后端 API 接口。

## 核心功能模块

### 1. 学习计划管理 (Study Plans)

#### `get_study_plans()`
获取所有学习计划列表
- **返回**: `Vec<StudyPlanWithProgress>` - 包含进度信息的学习计划列表

#### `create_study_plan(request: CreateStudyPlanRequest)`
创建新的学习计划
- **参数**: 
  - `name: String` - 计划名称
  - `description: String` - 计划描述
  - `word_ids: Vec<i64>` - 包含的单词ID列表
- **返回**: `i64` - 新创建的计划ID

#### `get_study_statistics()`
获取学习统计信息
- **返回**: `StudyStatistics` - 总体学习统计数据

### 2. 词汇管理 (Word Management)

#### `get_words(query: GetWordsQuery)`
获取词汇列表（支持分页和筛选）
- **参数**:
  - `page: Option<i32>` - 页码（默认1）
  - `page_size: Option<i32>` - 每页大小（默认10）
  - `category_id: Option<i64>` - 分类筛选
  - `difficulty_level: Option<i32>` - 难度筛选
  - `search: Option<String>` - 搜索关键词
- **返回**: `Vec<Word>` - 单词列表

#### `get_word_detail(word_id: i64)`
获取单词详细信息
- **参数**: `word_id: i64` - 单词ID
- **返回**: `Word` - 单词详细信息

#### `create_word(request: CreateWordRequest)`
创建新单词
- **参数**: `CreateWordRequest` - 包含单词所有信息
- **返回**: `i64` - 新创建的单词ID

#### `get_categories()`
获取所有分类
- **返回**: `Vec<Category>` - 分类列表

### 3. 学习会话管理 (Study Sessions)

#### `start_study_session(plan_id: i64)`
开始学习会话
- **参数**: `plan_id: i64` - 学习计划ID
- **返回**: `i64` - 会话ID

#### `end_study_session(session_id: i64, words_studied: i32, correct_answers: i32, total_time_seconds: i32)`
结束学习会话
- **参数**:
  - `session_id: i64` - 会话ID
  - `words_studied: i32` - 学习单词数
  - `correct_answers: i32` - 正确答案数
  - `total_time_seconds: i32` - 总学习时间（秒）

#### `update_word_progress(plan_id: i64, word_id: i64, is_correct: bool)`
更新单词学习进度
- **参数**:
  - `plan_id: i64` - 学习计划ID
  - `word_id: i64` - 单词ID
  - `is_correct: bool` - 是否回答正确

### 4. 学习模式 (Study Modes)

#### `get_study_questions(config: StudyModeConfig)`
生成学习题目
- **参数**: `StudyModeConfig` - 学习模式配置
  - `mode: String` - 模式类型（"flashcard", "quiz", "listening", "spelling"）
  - `difficulty_filter: Option<i32>` - 难度筛选
  - `category_filter: Option<i64>` - 分类筛选
  - `word_count: i32` - 题目数量
  - `randomize: bool` - 是否随机
- **返回**: `Vec<StudyQuestion>` - 学习题目列表

#### `submit_study_answer(question_id: String, answer: String, is_correct: bool)`
提交学习答案
- **参数**:
  - `question_id: String` - 题目ID
  - `answer: String` - 用户答案
  - `is_correct: bool` - 是否正确

### 5. 收藏功能 (Favorites)

#### `add_word_to_favorites(word_id: i64, note: Option<String>)`
添加单词到收藏
- **参数**:
  - `word_id: i64` - 单词ID
  - `note: Option<String>` - 用户备注

#### `remove_word_from_favorites(word_id: i64)`
从收藏中移除单词
- **参数**: `word_id: i64` - 单词ID

#### `get_favorite_words()`
获取收藏的单词
- **返回**: `Vec<Word>` - 收藏的单词列表

### 6. 文件上传 (File Upload)

#### `upload_word_image(word_id: i64, file_path: String)`
上传单词图片
- **参数**:
  - `word_id: i64` - 单词ID
  - `file_path: String` - 图片文件路径
- **支持格式**: jpg, jpeg, png, gif, webp
- **返回**: `String` - 文件路径

#### `upload_word_audio(word_id: i64, file_path: String)`
上传单词音频
- **参数**:
  - `word_id: i64` - 单词ID
  - `file_path: String` - 音频文件路径
- **支持格式**: mp3, wav, ogg, m4a
- **返回**: `String` - 文件路径

### 7. 详细统计 (Detailed Statistics)

#### `get_detailed_study_stats(days: Option<i32>)`
获取详细学习统计
- **参数**: `days: Option<i32>` - 统计天数（默认7天）
- **返回**: `DetailedStudyStats` - 详细统计信息
  - 每日统计
  - 周总结
  - 单词掌握度分布
  - 分类进度

#### `get_words_for_review()`
获取需要复习的单词
- **返回**: `Vec<Word>` - 基于间隔重复算法的复习单词

### 8. 学习提醒 (Study Reminders)

#### `set_study_reminder(title: String, message: String, scheduled_time: String, repeat_type: String)`
设置学习提醒
- **参数**:
  - `title: String` - 提醒标题
  - `message: String` - 提醒内容
  - `scheduled_time: String` - 提醒时间
  - `repeat_type: String` - 重复类型（"daily", "weekly", "custom"）
- **返回**: `i64` - 提醒ID

#### `get_study_reminders()`
获取学习提醒列表
- **返回**: `Vec<StudyReminder>` - 提醒列表

#### `update_reminder_status(reminder_id: i64, is_active: bool)`
更新提醒状态
- **参数**:
  - `reminder_id: i64` - 提醒ID
  - `is_active: bool` - 是否激活

## 数据结构

### Word
```rust
{
    id: i64,
    word: String,
    meaning: String,
    description: Option<String>,
    phonetic: Option<String>,
    ipa: Option<String>,
    syllables: Option<String>,
    phonics_segments: Option<String>,
    image_path: Option<String>,
    audio_path: Option<String>,
    part_of_speech: Option<String>,
    difficulty_level: Option<i32>,
    category_id: Option<i64>,
    created_at: String,
    updated_at: String
}
```

### Category
```rust
{
    id: i64,
    name: String,
    description: Option<String>,
    color: String,
    icon: String,
    word_count: i32,
    created_at: String
}
```

### StudyPlanWithProgress
```rust
{
    id: i64,
    name: String,
    description: String,
    status: String,
    total_words: i32,
    learned_words: i32,
    accuracy_rate: f64,
    mastery_level: i32,
    progress_percentage: f64,
    created_at: String,
    updated_at: String
}
```

## 错误处理

所有 API 都返回 `Result<T, String>` 类型，其中：
- `Ok(T)` - 成功结果
- `Err(String)` - 错误信息

常见错误类型：
- `INVALID_WORD` - 单词不能为空
- `INVALID_MEANING` - 释义不能为空
- `INVALID_DIFFICULTY` - 难度级别必须在1-5之间
- `INVALID_FILE_FORMAT` - 文件格式不支持
- `WORD_NOT_FOUND` - 单词不存在

## 使用示例

### 前端调用示例（JavaScript/TypeScript）

```typescript
import { invoke } from '@tauri-apps/api/tauri';

// 获取词汇列表
const words = await invoke('get_words', { 
  query: { 
    page: 1, 
    page_size: 10, 
    category_id: 1 
  } 
});

// 创建新单词
const wordId = await invoke('create_word', {
  request: {
    word: "Hello",
    meaning: "你好",
    difficulty_level: 1,
    category_id: 1
  }
});

// 开始学习会话
const sessionId = await invoke('start_study_session', { plan_id: 1 });

// 获取学习题目
const questions = await invoke('get_study_questions', {
  config: {
    mode: "flashcard",
    word_count: 10,
    randomize: true
  }
});
```

### 9. 间隔重复算法 (Spaced Repetition)

#### `calculate_next_review(word_id: i64, quality: i32)`
计算下次复习时间
- **参数**:
  - `word_id: i64` - 单词ID
  - `quality: i32` - 回答质量评分（0-5，0=完全不记得，5=完美记住）
- **返回**: `SpacedRepetitionResult` - 包含下次复习时间、难度系数等信息

### 10. 成就系统 (Achievement System)

#### `get_achievements()`
获取所有成就
- **返回**: `Vec<Achievement>` - 成就列表

#### `check_achievement_progress(action_type: String, count: i32)`
检查成就进度
- **参数**:
  - `action_type: String` - 动作类型（"word_learned", "study_session", "daily_goal"等）
  - `count: i32` - 数量
- **返回**: `Vec<Achievement>` - 新解锁的成就列表

### 11. 智能推荐 (Smart Recommendations)

#### `get_word_recommendations(user_level: Option<i32>, category_preference: Option<i64>, limit: Option<i32>)`
获取单词推荐
- **参数**:
  - `user_level: Option<i32>` - 用户水平
  - `category_preference: Option<i64>` - 偏好分类
  - `limit: Option<i32>` - 推荐数量限制
- **返回**: `Vec<WordRecommendation>` - 推荐单词列表

### 12. 数据导入导出 (Import/Export)

#### `export_user_data(include_progress: bool)`
导出用户数据
- **参数**: `include_progress: bool` - 是否包含学习进度
- **返回**: `String` - JSON格式的用户数据

#### `import_user_data(json_data: String)`
导入用户数据
- **参数**: `json_data: String` - JSON格式的数据
- **返回**: `ImportResult` - 导入结果信息

### 13. 学习分析 (Learning Analysis)

#### `analyze_learning_progress()`
分析学习进度
- **返回**: `LearningAnalysis` - 包含优势领域、弱点分析、建议等

#### `generate_personalized_plan(target_words: i32, available_time_minutes: i32, focus_category: Option<i64>)`
生成个性化学习计划
- **参数**:
  - `target_words: i32` - 目标单词数
  - `available_time_minutes: i32` - 每日可用时间（分钟）
  - `focus_category: Option<i64>` - 重点分类
- **返回**: `PersonalizedPlan` - 个性化学习计划

### 14. 学习目标 (Study Goals)

#### `get_study_goals()`
获取学习目标
- **返回**: `Vec<StudyGoal>` - 学习目标列表

#### `create_study_goal(title: String, description: String, target_value: i32, deadline: String, goal_type: String)`
创建学习目标
- **参数**:
  - `title: String` - 目标标题
  - `description: String` - 目标描述
  - `target_value: i32` - 目标数值
  - `deadline: String` - 截止时间
  - `goal_type: String` - 目标类型（"daily", "weekly", "monthly", "custom"）
- **返回**: `i64` - 目标ID

### 15. 学习连击 (Learning Streaks)

#### `get_learning_streak()`
获取学习连击信息
- **返回**: `LearningStreak` - 连击统计和里程碑信息

### 16. 智能难度调整 (Intelligent Difficulty Adjustment)

#### `suggest_difficulty_adjustment(recent_accuracy: f64, study_time_seconds: i32, word_count: i32)`
建议难度调整
- **参数**:
  - `recent_accuracy: f64` - 最近准确率
  - `study_time_seconds: i32` - 学习时间（秒）
  - `word_count: i32` - 单词数量
- **返回**: `DifficultyAdjustment` - 难度调整建议

## 新增数据结构

### SpacedRepetitionResult
```rust
{
    next_review_date: String,
    difficulty_multiplier: f64,
    interval_days: i32,
    repetition_count: i32
}
```

### Achievement
```rust
{
    id: i64,
    title: String,
    description: String,
    icon: String,
    category: String, // "daily", "milestone", "streak", "mastery"
    requirement: i32,
    current_progress: i32,
    is_unlocked: bool,
    unlocked_at: Option<String>
}
```

### WordRecommendation
```rust
{
    word: Word,
    reason: String, // "similar_difficulty", "same_category", "trending", "review_needed"
    confidence_score: f64
}
```

### LearningAnalysis
```rust
{
    user_level: i32,
    strength_areas: Vec<String>,
    weakness_areas: Vec<String>,
    recommended_focus: String,
    learning_efficiency: f64,
    next_milestone: String
}
```

### StudyGoal
```rust
{
    id: i64,
    title: String,
    description: String,
    target_value: i32,
    current_value: i32,
    deadline: String,
    goal_type: String, // "daily", "weekly", "monthly", "custom"
    is_active: bool,
    reward: Option<String>
}
```

### LearningStreak
```rust
{
    current_streak: i32,
    longest_streak: i32,
    streak_start_date: String,
    last_study_date: String,
    streak_milestones: Vec<StreakMilestone>
}
```

## 高级功能特色

### 🧠 智能学习算法
- **间隔重复算法**: 基于SuperMemo算法，根据遗忘曲线优化复习时间
- **难度自适应**: 根据学习表现智能调整单词难度
- **个性化推荐**: 基于学习历史和偏好推荐合适的单词

### 🎯 目标驱动学习
- **多层次目标**: 支持日、周、月和自定义目标
- **成就系统**: 丰富的成就徽章激励学习
- **连击系统**: 连续学习天数统计和里程碑奖励

### 📊 深度学习分析
- **学习模式分析**: 识别用户的优势和弱点领域
- **进度可视化**: 详细的学习统计图表
- **个性化计划**: 基于用户情况生成最适合的学习计划

### 🔄 数据管理
- **完整导入导出**: 支持学习数据的备份和迁移
- **多格式支持**: JSON格式数据交换
- **版本兼容**: 支持数据版本管理

## 注意事项

1. 当前实现使用模拟数据，生产环境需要连接真实数据库
2. 文件上传功能需要配合前端文件选择器使用
3. 学习提醒功能需要系统通知权限
4. 所有时间字段使用 ISO 8601 格式
5. 单词难度级别范围：1-5（1最简单，5最困难）
6. 间隔重复算法中质量评分范围：0-5（0=完全不记得，5=完美记住）
7. 成就系统支持实时进度更新和解锁通知
8. 推荐算法基于协同过滤和内容过滤混合模式