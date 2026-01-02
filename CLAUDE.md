# CLAUDE.md - RedLark 单词学习应用开发文档

## 项目概述

RedLark 是一个基于 Tauri + React + TypeScript 构建的跨平台单词学习应用，旨在帮助用户通过科学的学习方法和 AI 辅助功能高效学习英语单词。

### 核心特性
- **智能学习规划**: 基于 AI 的学习计划生成和日程安排
- **三步练习法**: 科学的单词记忆方法（完整信息→隐藏原文→仅中文）
- **自然拼读分析**: AI 辅助的单词发音规则分析
- **进度追踪**: 详细的学习统计和日历视图
- **跨平台支持**: Windows、macOS、Linux 全平台支持
- **本地数据存储**: SQLite 数据库，数据安全可控

## 技术架构

### 技术栈
- **前端框架**: React 18 + TypeScript + Vite
- **桌面应用框架**: Tauri 2.x (Rust)
- **数据库**: SQLite + SQLx
- **构建工具**: Vite + Tauri CLI
- **包管理**: pnpm + Cargo
- **样式方案**: CSS Modules + CSS 变量
- **图标库**: FontAwesome

### 架构模式
```
┌─────────────────────────────────────────────────────────────┐
│                      前端层 (React)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  页面层   │→ │ 组件层   │→ │ 服务层   │→ │ API层 │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ↓ Tauri IPC
┌─────────────────────────────────────────────────────────────┐
│                    后端层 (Rust)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 处理器层 │→ │ 服务层   │→ │ 数据访问层│→ │ SQLite│ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 核心功能模块

### 1. 单词本管理模块

#### 功能特性
- 创建、编辑、删除单词本（软删除）
- 单词本主题标签分类
- 单词本统计信息（词性分布、单词数量）
- 从文本批量导入单词（AI 分析）
- 批量删除单词

#### 核心组件
- [`WordBookPage`](src/pages/WordBookPage.tsx): 单词本列表页面
- [`CreateWordBookPageV2`](src/pages/CreateWordBookPageV2.tsx): 创建单词本页面
- [`WordBookDetailPage`](src/pages/WordBookDetailPage.tsx): 单词本详情页面
- [`WordBookHeader`](src/components/WordBookHeader/WordBookHeader.tsx): 单词本头部组件
- [`WordBookStats`](src/components/WordBookStats/WordBookStats.tsx): 单词本统计组件

#### 数据结构
```typescript
interface WordBook {
  id: Id;
  title: string;
  description: string;
  icon: string;
  icon_color: string;
  total_words: number;
  linked_plans: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_used: Timestamp;
  deleted_at?: Timestamp;
  status: string;
  theme_tags?: ThemeTag[];
}
```

#### API 端点
- `get_word_books`: 获取单词本列表
- `get_word_book_detail`: 获取单词本详情
- `create_word_book`: 创建单词本
- `update_word_book`: 更新单词本
- `delete_word_book`: 删除单词本（软删除）
- `get_word_book_statistics`: 获取单词本统计

### 2. 单词管理模块

#### 功能特性
- 添加、编辑、删除单词
- 单词详细信息管理（音标、音节、自然拼读、词性、含义等）
- AI 自然拼读分析
- 单词搜索和过滤（按词性、关键词）
- 批量导入单词

#### 核心组件
- [`WordList`](src/components/WordList/WordList.tsx): 单词列表组件
- [`WordGrid`](src/components/WordGrid/WordGrid.tsx): 单词网格组件
- [`WordCard`](src/components/WordCard/WordCard.tsx): 单词卡片组件
- [`WordDetail`](src/components/WordDetail/WordDetail.tsx): 单词详情组件
- [`AddWords`](src/components/AddWords/AddWords.tsx): 添加单词组件
- [`TextImport`](src/components/TextImport/TextImport.tsx): 文本导入组件
- [`WordImporter`](src/components/WordImporter/WordImporter.tsx): 单词导入器

#### 数据结构
```typescript
interface Word {
  id: Id;
  word: string;
  meaning: string;
  description?: string;
  ipa?: string;
  syllables?: string;
  phonics_segments?: string;
  part_of_speech?: string;
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
  word_book_id?: Id;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

#### API 端点
- `get_words_by_book`: 获取单词本中的单词（支持分页、搜索、过滤）
- `add_word_to_book`: 添加单词到单词本
- `update_word`: 更新单词
- `delete_word`: 删除单词
- `create_word_book_from_analysis`: 从分析结果创建单词本

### 3. 学习计划管理模块

#### 功能特性
- 创建学习计划（支持 AI 智能规划）
- 学习计划状态管理（Draft → Pending → Active → Completed/Terminated）
- 学习计划日程安排（每日学习计划）
- 学习进度追踪和统计
- 学习计划编辑和重新开始

#### 状态机设计
```
    ┌───────┐
    │ Draft │
    └───┬───┘
        ↓ publish
    ┌───────┐
    │Pending│
    └───┬───┘
        ↓ start
    ┌───────┐
    │ Active │
    └───┬───┘
        ├────→ complete → Completed
        └────→ terminate → Terminated
```

#### 核心组件
- [`StudyPlansPage`](src/pages/StudyPlansPage.tsx): 学习计划列表页面
- [`CreatePlanPageV2`](src/pages/CreatePlanPageV2.tsx): 创建学习计划页面
- [`PlanDetailPage`](src/pages/PlanDetailPage.tsx): 学习计划详情页面
- [`StartStudyPlanPage`](src/pages/StartStudyPlanPage.tsx): 开始学习页面
- [`StudyPlanCard`](src/components/StudyPlanCard/StudyPlanCard.tsx): 学习计划卡片
- [`PlanPreview`](src/components/PlanPreview/PlanPreview.tsx): 计划预览组件
- [`PlanningProgress`](src/components/PlanningProgress/PlanningProgress.tsx): 规划进度组件

#### 数据结构
```typescript
interface StudyPlan {
  id: Id;
  name: string;
  description: string;
  status: 'normal' | 'draft' | 'deleted';
  unified_status: 'Draft' | 'Pending' | 'Active' | 'Completed' | 'Terminated' | 'Deleted';
  total_words: number;
  mastery_level: number;
  intensity_level?: 'easy' | 'normal' | 'intensive';
  study_period_days?: number;
  review_frequency?: number;
  start_date?: string;
  end_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  actual_terminated_date?: string;
  ai_plan_data?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

#### API 端点
- `get_study_plans`: 获取学习计划列表
- `get_study_plan`: 获取学习计划详情
- `create_study_plan`: 创建学习计划
- `update_study_plan_basic_info`: 更新学习计划基本信息
- `start_study_plan`: 开始学习计划
- `complete_study_plan`: 完成学习计划
- `terminate_study_plan`: 终止学习计划
- `restart_study_plan`: 重新开始学习计划
- `edit_study_plan`: 编辑学习计划（转为草稿）
- `publish_study_plan`: 发布学习计划
- `delete_study_plan`: 删除学习计划
- `get_study_plan_status_history`: 获取状态变更历史

### 4. AI 学习规划模块

#### 功能特性
- AI 智能生成学习计划日程
- 根据学习强度、周期、复习频率自动安排
- 新单词和复习单词的智能分配
- 单词难度和优先级评估

#### 核心组件
- [`AIModelSelector`](src/components/AIModelSelector/AIModelSelector.tsx): AI 模型选择器

#### 数据结构
```typescript
interface StudyPlanScheduleRequest {
  name: string;
  description: string;
  intensityLevel: 'easy' | 'normal' | 'intensive';
  studyPeriodDays: number;
  reviewFrequency: number;
  startDate: string;
  wordbookIds: Id[];
  modelId?: number;
}

interface StudyPlanAIResult {
  planMetadata: StudyPlanMetadata;
  dailyPlans: DailyStudyPlan[];
}

interface DailyStudyPlan {
  day: number;
  date: string;
  words: DailyStudyWord[];
}
```

#### API 端点
- `generate_study_plan_schedule`: 生成学习计划 AI 规划
- `create_study_plan_with_schedule`: 创建带 AI 规划的学习计划
- `update_study_plan_with_schedule`: 更新学习计划和日程

### 5. 单词练习模块

#### 功能特性
- **三步练习法**:
  1. Step 1: 显示完整信息（单词+音标+中文+音节+拼读）
  2. Step 2: 隐藏英文原文（音标+中文+音节+拼读）
  3. Step 3: 仅中文+音节+拼读+发音
- 练习会话管理（开始、暂停、恢复、完成）
- 练习结果统计（正确率、用时、困难单词）
- 拼写练习功能

#### 核心组件
- [`WordPracticePage`](src/pages/WordPracticePage.tsx): 单词练习页面
- [`SpellingPractice`](src/components/SpellingPractice/SpellingPractice.tsx): 拼写练习组件
- [`PracticeResultPage`](src/pages/PracticeResultPage.tsx): 练习结果页面
- [`FinishStudyPlanPage`](src/pages/FinishStudyPlanPage.tsx): 完成学习计划页面

#### 数据结构
```typescript
enum WordPracticeStep {
  STEP_1 = 1, // 显示完整信息
  STEP_2 = 2, // 隐藏英文原文
  STEP_3 = 3  // 仅中文+音节+拼读+发音
}

interface WordPracticeState {
  wordId: number;
  planWordId: number;
  wordInfo: PracticeWordInfo;
  currentStep: WordPracticeStep;
  stepResults: boolean[];
  stepAttempts: number[];
  stepTimeSpent: number[];
  completed: boolean;
  passed: boolean;
  startTime: string;
  endTime?: string;
}

interface PracticeSession {
  sessionId: string;
  planId: number;
  scheduleId: number;
  scheduleDate: string;
  startTime: string;
  endTime?: string;
  totalTime: number;
  activeTime: number;
  pauseCount: number;
  wordStates: WordPracticeState[];
  completed: boolean;
}

interface PracticeResult {
  sessionId: string;
  planId: number;
  scheduleId: number;
  totalWords: number;
  passedWords: number;
  totalSteps: number;
  correctSteps: number;
  stepAccuracy: number;
  wordAccuracy: number;
  totalTime: number;
  activeTime: number;
  pauseCount: number;
  averageTimePerWord: number;
  difficultWords: WordPracticeState[];
  passedWordsList: WordPracticeState[];
  completedAt: string;
}
```

#### API 端点
- `start_practice_session`: 开始练习会话
- `submit_step_result`: 提交步骤结果
- `pause_practice_session`: 暂停练习会话
- `resume_practice_session`: 恢复练习会话
- `complete_practice_session`: 完成练习会话
- `cancel_practice_session`: 取消练习会话
- `get_incomplete_practice_sessions`: 获取未完成的练习会话
- `get_practice_session_detail`: 获取练习会话详情
- `get_plan_practice_sessions`: 获取学习计划的练习会话列表
- `get_practice_statistics`: 获取练习统计数据

### 6. AI 服务模块

#### 功能特性
- AI 模型管理（提供商、模型配置）
- 自然拼读分析（Phonics Analysis）
- 学习计划智能规划
- 支持多种 AI 提供商（OpenAI、Anthropic、本地模型等）

#### 核心组件
- [`AIModelSelector`](src/components/AIModelSelector/AIModelSelector.tsx): AI 模型选择器

#### 数据结构
```typescript
interface AIProvider {
  id: Id;
  name: string;
  display_name: string;
  base_url: string;
  api_key: string;
  description?: string;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface AIModel {
  id: Id;
  provider_id: Id;
  name: string;
  display_name: string;
  model_id: string;
  description?: string;
  max_tokens: number;
  temperature: number;
  is_active: boolean;
  is_default: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface AnalyzedWord {
  word: string;
  meaning: string;
  phonetic?: string;
  part_of_speech?: string;
  ipa?: string;
  syllables?: string;
  pos_abbreviation?: string;
  pos_english?: string;
  pos_chinese?: string;
  phonics_rule?: string;
  analysis_explanation?: string;
}
```

#### API 端点
- `get_ai_providers`: 获取 AI 提供商列表
- `get_ai_models`: 获取 AI 模型列表
- `get_default_ai_model`: 获取默认 AI 模型
- `set_default_ai_model`: 设置默认 AI 模型
- `create_ai_provider`: 创建 AI 提供商
- `update_ai_provider`: 更新 AI 提供商
- `delete_ai_provider`: 删除 AI 提供商
- `create_ai_model`: 创建 AI 模型
- `update_ai_model`: 更新 AI 模型
- `delete_ai_model`: 删除 AI 模型
- `analyze_phonics_with_model`: 使用 AI 模型进行自然拼读分析
- `get_analysis_progress`: 获取分析进度
- `clear_analysis_progress`: 清除分析进度
- `cancel_analysis`: 取消分析

### 7. 文本转语音（TTS）模块

#### 功能特性
- 多种 TTS 提供商支持
- 语音选择和配置
- 音频缓存管理
- 单词发音播放

#### 核心组件
- [`VoiceSelector`](src/components/VoiceSelector/VoiceSelector.tsx): 语音选择器

#### API 端点
- `text_to_speech`: 文本转语音
- `get_tts_voices`: 获取可用语音列表
- `get_default_tts_voice`: 获取默认语音
- `set_default_tts_voice`: 设置默认语音
- `get_tts_providers`: 获取 TTS 提供商
- `clear_tts_cache`: 清除 TTS 缓存
- `get_elevenlabs_config`: 获取 ElevenLabs 配置
- `update_elevenlabs_config`: 更新 ElevenLabs 配置

### 8. 日历视图模块

#### 功能特性
- 月度学习日历展示
- 学习计划可视化
- 学习进度统计
- 连续学习天数追踪

#### 核心组件
- [`CalendarPage`](src/pages/CalendarPage.tsx): 日历页面
- [`StudyCalendar`](src/components/StudyCalendar/StudyCalendar.tsx): 学习日历组件

#### 数据结构
```typescript
interface CalendarDayData {
  date: string;
  is_today: boolean;
  is_in_plan: boolean;
  status: 'not-started' | 'in-progress' | 'completed' | 'overdue';
  new_words_count: number;
  review_words_count: number;
  total_words_count: number;
  completed_words_count: number;
  progress_percentage: number;
  study_time_minutes?: number;
  study_plans?: CalendarStudyPlan[];
  study_sessions?: CalendarStudySession[];
}

interface CalendarMonthlyStats {
  total_days: number;
  study_days: number;
  completed_days: number;
  total_words_learned: number;
  total_study_minutes: number;
  average_accuracy: number;
  streak_days: number;
  active_plans_count: number;
}
```

#### API 端点
- `get_calendar_month_data`: 获取日历月度数据
- `get_today_study_schedules`: 获取今日学习日程
- `get_study_plan_calendar_data`: 获取学习计划日历数据
- `diagnose_calendar_data`: 诊断日历数据

### 9. 统计分析模块

#### 功能特性
- 学习统计（总学习单词数、平均准确率、连续天数）
- 学习计划统计（进度、准确率、逾期率）
- 练习统计（会话数、完成率、用时）
- 性能分析图表

#### 核心组件
- [`StatsOverview`](src/components/StatsOverview/StatsOverview.tsx): 统计概览组件
- [`PerformanceAnalysis`](src/components/PerformanceAnalysis/PerformanceAnalysis.tsx): 性能分析组件
- [`StudyStatistics`](src/components/StudyStatistics/StudyStatistics.tsx): 学习统计组件
- [`StudyProgress`](src/components/StudyProgress/StudyProgress.tsx): 学习进度组件
- [`VocabProgress`](src/components/VocabProgress/VocabProgress.tsx): 词汇进度组件

#### 数据结构
```typescript
interface StudyStatistics {
  total_words_learned: number;
  average_accuracy: number;
  streak_days: number;
  completion_rate: number;
  weekly_progress: number[];
}

interface StudyPlanStatistics {
  average_daily_study_minutes: number;
  time_progress_percentage: number;
  actual_progress_percentage: number;
  average_accuracy_rate: number;
  overdue_ratio: number;
  streak_days: number;
  total_days: number;
  completed_days: number;
  overdue_days: number;
  total_words: number;
  completed_words: number;
  total_study_minutes: number;
}
```

#### API 端点
- `get_study_statistics`: 获取学习统计
- `get_study_plan_statistics`: 获取学习计划统计
- `get_practice_statistics`: 获取练习统计

### 10. 数据管理模块

#### 功能特性
- 数据库统计信息
- 用户数据重置
- 选择性数据清理
- 数据导入导出

#### API 端点
- `get_database_statistics`: 获取数据库统计
- `reset_user_data`: 重置用户数据
- `reset_selected_tables`: 重置选定表
- `delete_database_and_restart`: 删除数据库并重启应用

### 11. 系统工具模块

#### 功能特性
- 系统日志查看
- 开发者工具
- 错误日志收集

#### 核心组件
- [`DevTools`](src/components/DevTools/DevTools.tsx): 开发者工具组件
- [`LogViewer`](src/components/LogViewer.tsx): 日志查看器组件
- [`ErrorModal`](src/components/ErrorModal.tsx): 错误模态框

#### API 端点
- `get_system_logs`: 获取系统日志

## 前端架构详解

### 页面路由系统

应用使用简单的状态管理实现页面路由，通过 [`App.tsx`](src/App.tsx) 的 `currentPage` 状态控制页面切换。

```typescript
// 页面路由映射
const pageRoutes = {
  'home': HomePage,
  'plans': StudyPlansPage,
  'create-plan': CreatePlanPageV2,
  'plan-detail': PlanDetailPage,
  'wordbooks': WordBookPage,
  'create-wordbook': CreateWordBookPageV2,
  'wordbook-detail': WordBookDetailPage,
  'start-study-plan': StartStudyPlanPage,
  'word-practice': WordPracticePage,
  'practice-result': PracticeResultPage,
  'finish-study-plan': FinishStudyPlanPage,
  'calendar': CalendarPage,
  'settings': SettingsPage,
};
```

### 组件架构

#### 组件分类
```
src/components/
├── 通用组件/
│   ├── Button/
│   ├── Input/
│   ├── Select/
│   ├── Modal/
│   ├── FormInput/
│   ├── FilterSelect/
│   ├── TextArea/
│   ├── ConfirmDialog/
│   ├── LoadingSpinner/
│   ├── Toast/
│   ├── ErrorBoundary/
│   ├── Header/
│   ├── Breadcrumb/
│   └── DevTools/
├── 单词本相关/
│   ├── WordBookHeader/
│   ├── WordBookStats/
│   ├── WordBookFilter/
│   ├── WordBookSelector/
│   └── CreateWordBookPreview/
├── 学习计划相关/
│   ├── StudyPlanCard/
│   ├── StudyPlanSection/
│   ├── PlanPreview/
│   ├── PlanningProgress/
│   ├── EditPlanModal/
│   └── IncompletePracticeModal/
├── 练习相关/
│   ├── WordCard/
│   ├── PracticeWordCard/
│   ├── SpellingPractice/
│   └── ActionButtons/
├── 统计相关/
│   ├── StatsOverview/
│   ├── PerformanceAnalysis/
│   ├── StudyStatistics/
│   ├── StudyProgress/
│   ├── VocabProgress/
│   ├── StatCard/
│   └── StudyCompletionHeader/
├── 单词管理/
│   ├── WordList/
│   ├── WordGrid/
│   ├── WordDetail/
│   ├── AddWords/
│   ├── TextImport/
│   ├── WordImporter/
│   ├── WordImporterModal/
│   ├── EditWordModal/
│   └── BatchDeleteModal/
├── 日历相关/
│   ├── StudyCalendar/
│   └── StudyRecordsSidebar/
└── 其他/
    ├── AIModelSelector/
    ├── VoiceSelector/
    ├── ThemeSelector/
    ├── Achievements/
    └── CongratulationsBanner/
```

### 服务层架构

服务层封装了与后端 API 交互的逻辑，所有服务继承自 [`BaseService`](src/services/baseService.ts)。

```typescript
// 服务基类
export abstract class BaseService {
  protected client: TauriApiClient;
  
  constructor(client: TauriApiClient) {
    this.client = client;
  }
  
  protected async executeWithLoading<T>(
    operation: () => Promise<ApiResult<T>>,
    setLoading?: (state: LoadingState) => void
  ): Promise<ApiResult<T>> {
    // 统一的加载状态管理
  }
}
```

#### 服务列表
- [`AIModelService`](src/services/aiModelService.ts): AI 模型管理服务
- [`CalendarService`](src/services/calendarService.ts): 日历服务
- [`DataManagementService`](src/services/dataManagementService.ts): 数据管理服务
- [`PracticeService`](src/services/practiceService.ts): 练习服务
- [`StatisticsService`](src/services/statisticsService.ts): 统计服务
- [`StudyService`](src/services/studyService.ts): 学习服务
- [`TTSService`](src/services/ttsService.ts): 文本转语音服务
- [`WordbookService`](src/services/wordbookService.ts): 单词本服务

### 状态管理

应用使用 React Hooks 进行状态管理，不使用外部状态管理库（如 Redux、Zustand）。

```typescript
// 状态管理示例
const [state, setState] = useState<StateType>(initialState);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

### 自定义 Hooks

```typescript
// src/hooks/
├── useAsyncData.ts      // 异步数据获取
├── useAudioPlayer.ts    // 音频播放器
├── useErrorHandler.ts   // 错误处理
└── useTheme.ts         // 主题管理
```

## 后端架构详解

### 模块组织

```
src-tauri/src/
├── lib.rs              // 应用入口和命令注册
├── main.rs             // 主函数
├── handlers.rs         // 主要命令处理器（5000+ 行）
├── error.rs            // 错误类型定义
├── logger.rs           // 日志系统
├── database/
│   └── mod.rs         // 数据库管理器
├── types/
│   ├── common.rs       // 通用类型
│   ├── wordbook.rs     // 单词本类型
│   ├── study.rs        // 学习相关类型
│   └── ai_model.rs     // AI 模型类型
├── ai_service.rs       // AI 服务
├── ai_model_handlers.rs // AI 模型处理器
├── tts_service.rs      // TTS 服务
├── tts_handlers.rs     // TTS 处理器
└── test_statistics.rs  // 测试统计
```

### 数据库设计

#### 数据库表结构

1. **ai_providers**: AI 提供商表
2. **ai_models**: AI 模型表
3. **theme_tags**: 主题标签表
4. **word_books**: 单词本表
5. **word_book_theme_tags**: 单词本主题标签关联表
6. **words**: 单词表
7. **study_plans**: 学习计划表
8. **study_plan_words**: 学习计划单词关联表
9. **study_plan_schedules**: 学习计划日程表
10. **study_plan_schedule_words**: 学习计划日程单词表
11. **study_plan_status_history**: 学习计划状态历史表
12. **study_sessions**: 学习会话表
13. **practice_sessions**: 练习会话表
14. **word_practice_records**: 单词练习记录表
15. **practice_pause_records**: 练习暂停记录表
16. **study_timer_records**: 学习计时器记录表

#### 数据库迁移

迁移脚本位于 `src-tauri/migrations/` 目录，使用 SQLx 的迁移系统。

```rust
// 数据库管理器
pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(database_url: &str) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);
        
        let pool = SqlitePool::connect_with(options).await?;
        Ok(Self { pool })
    }
    
    pub async fn migrate(&self) -> AppResult<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }
}
```

### API 命令注册

所有 Tauri 命令在 [`lib.rs`](src-tauri/src/lib.rs) 中注册：

```rust
.invoke_handler(tauri::generate_handler![
    // 单词本相关
    get_word_books,
    get_word_book_detail,
    create_word_book,
    update_word_book,
    delete_word_book,
    
    // 单词相关
    get_words_by_book,
    add_word_to_book,
    update_word,
    delete_word,
    
    // 学习计划相关
    get_study_plans,
    create_study_plan,
    start_study_plan,
    complete_study_plan,
    terminate_study_plan,
    
    // 练习相关
    start_practice_session,
    submit_step_result,
    pause_practice_session,
    resume_practice_session,
    complete_practice_session,
    
    // AI 相关
    get_ai_models,
    analyze_phonics_with_model,
    generate_study_plan_schedule,
    
    // TTS 相关
    text_to_speech,
    get_tts_voices,
    
    // ... 更多命令
])
```

### 错误处理

统一的错误类型定义在 [`error.rs`](src-tauri/src/error.rs)：

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    DatabaseError(String),
    
    #[error("Validation error: {0}")]
    ValidationError(String),
    
    #[error("Not found: {0}")]
    NotFound(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}

pub type AppResult<T> = Result<T, AppError>;
```

### 日志系统

自定义日志系统在 [`logger.rs`](src-tauri/src/logger.rs)：

```rust
pub struct Logger {
    app_data_dir: PathBuf,
}

impl Logger {
    pub fn new(app_data_dir: &Path) -> AppResult<Self> {
        // 初始化日志系统
    }
    
    pub fn info(&self, category: &str, message: &str) {
        // 记录信息日志
    }
    
    pub fn error(&self, category: &str, message: &str, detail: Option<&str>) {
        // 记录错误日志
    }
    
    pub fn api_request(&self, command: &str, params: Option<&str>) {
        // 记录 API 请求
    }
    
    pub fn api_response(&self, command: &str, success: bool, message: Option<&str>) {
        // 记录 API 响应
    }
}
```

## 数据流架构

### 前端数据流

```
Page Component
    ↓ (调用 Service)
Service Layer
    ↓ (调用 API Client)
API Client (TauriApiClient)
    ↓ (invoke 命令)
Tauri Backend
    ↓ (返回结果)
API Client
    ↓ (返回 ApiResult)
Service Layer
    ↓ (处理结果)
Page Component
    ↓ (更新 State)
UI Update
```

### 后端数据流

```
Tauri Command Handler
    ↓ (参数验证)
Service Layer
    ↓ (业务逻辑)
Repository Layer
    ↓ (SQL 查询)
Database (SQLite)
    ↓ (返回数据)
Repository Layer
    ↓ (返回实体)
Service Layer
    ↓ (返回结果)
Command Handler
    ↓ (返回 AppResult)
Frontend
```

## 开发规范

### 数据库迁移规范

#### 迁移脚本管理规则
1. **只能添加新迁移**: 任何数据库变更需求只能通过添加新的迁移脚本实现，严禁修改已存在的历史迁移文件
2. **序号连续性**: 迁移脚本文件名必须保持序号连续性（001, 002, 003...），不得跳号或重复
3. **禁止删库重建**: 任何代码重构或问题修复都不能使用删除数据库的方式解决，必须通过新增迁移脚本修复
4. **向前兼容**: 新迁移必须与现有数据兼容，避免破坏性变更

#### 迁移脚本命名规范
```
src-tauri/migrations/
├── 001_initial.sql              # 初始化表结构
├── 002_create_ai_models.sql     # AI模型相关表
├── 003_insert_ai_data.sql       # 默认AI数据
└── 004_add_new_feature.sql      # 新功能相关变更
```

### 前后端接口数据结构规范

#### 统一响应格式 (ApiResult)

所有 API 接口必须返回统一的 `ApiResult<T>` 格式：

```typescript
// TypeScript 前端
type ApiResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: string;
};
```

```rust
// Rust 后端
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResult<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}
```

#### 参数命名转换规则

Tauri 会自动在前后端之间进行参数名称转换：
- **前端 → 后端**: `camelCase` → `snake_case`
- **后端 → 前端**: `snake_case` → `camelCase`

| 前端 (TypeScript) | 后端 (Rust) | 说明 |
|------------------|-------------|------|
| `modelId` | `model_id` | ID 类型参数 |
| `extractionMode` | `extraction_mode` | 枚举/字符串参数 |
| `displayName` | `display_name` | 显示名称 |
| `baseUrl` | `base_url` | URL 参数 |
| `apiKey` | `api_key` | API 密钥 |
| `isActive` | `is_active` | 布尔值参数 |

#### 参数类型规范

**推荐的参数类型**:
```rust
String                    // 字符串
Option<String>           // 可选字符串
i64                      // 整数 ID
Option<i64>             // 可选整数 ID
bool                     // 布尔值
Option<bool>            // 可选布尔值
Vec<String>             // 字符串数组
```

**避免的参数类型**:
```rust
Option<Id>              // 自定义类型别名
CustomStruct            // 自定义结构体
enum CustomEnum         // 自定义枚举
```

### Tauri 命令接口规范

#### 后端命令定义 (Rust)
```rust
// ✅ 正确的命令定义
#[tauri::command]
pub async fn command_name(
    app: AppHandle,
    param1: String,
    param2: Option<i64>,
    param3: Option<String>,
) -> AppResult<ReturnType> {
    // 命令实现
}

// ❌ 错误的命令定义
#[tauri::command]
pub async fn command_name(
    app: AppHandle,
    param1: String,
    param2: Option<Id>,  // 避免使用自定义类型
    param3: Option<String>,
) -> Result<ReturnType, String> {  // 必须使用 AppResult<T>
    // 命令实现
}
```

#### 前端调用规则 (TypeScript)
```typescript
// ✅ 正确的调用方式
const result = await this.client.invoke<ReturnType>('command_name', {
  param1: value1,
  param2: value2 || null,  // 使用驼峰命名
  param3: value3
});

// ❌ 错误的调用方式
const result = await this.client.invoke<ReturnType>('command_name', {
  param_1: value1,  // 前端不应使用下划线命名
  param_2: value2,
  param_3: value3
});
```

### React/TypeScript 代码规范

- 使用函数组件 + Hooks
- 优先使用 TypeScript 类型安全
- 组件使用 PascalCase 命名
- 导出使用 named export，避免 default export
- 使用 CSS Modules 进行样式隔离
- 使用 CSS 变量而非硬编码样式值

### Rust 代码规范

- 遵循 Rust 官方代码规范
- 使用 `cargo fmt` 格式化
- 使用 `cargo clippy` 进行代码检查
- 使用 `#[tauri::command]` 宏定义命令
- 使用 `AppResult<T>` 作为统一返回类型

### 页面布局规范

#### 页面结构标准
1. **页面容器**: `.page` 类，统一的页面基础样式
2. **主内容区域**: `.main` 类，统一的内容容器规范（最大宽度 1400px）
3. **页面头部**: `.pageHeader` 类，统一的页面标题区域

#### 响应式布局标准
- **桌面端**: `max-width: 1400px`，内边距 `var(--spacing-2xl) var(--spacing-lg)`
- **平板端** (≤768px): 内边距 `var(--spacing-lg) var(--spacing-md)`
- **手机端** (≤480px): 内边距 `var(--spacing-md) var(--spacing-sm)`

#### 面包屑导航规范
- 所有页面必须包含 Header 和 Breadcrumb 组件
- Header 后紧跟 Breadcrumb，然后是页面主要内容

## 开发命令

### 开发模式
```bash
npm run tauri:dev
```

### 构建应用
```bash
# 构建当前平台
npm run build:current

# 构建 Windows
npm run build:win

# 构建 macOS (通用版本)
npm run build:mac-universal

# 构建 Linux
npm run build:linux

# 构建所有平台
npm run build:all
```

### 构建安装包
```bash
# Windows 安装包 (MSI + NSIS)
npm run bundle:win

# macOS 安装包 (APP + DMG)
npm run bundle:mac

# Linux 安装包 (DEB + AppImage)
npm run bundle:linux

# 所有平台安装包
npm run bundle:all
```

### 代码检查
```bash
npm run lint
cargo clippy
```

## 开发测试规范

### 测试策略
1. **算法类功能**: 使用自动化测试用例辅助调试，确保代码质量
2. **UI 功能验证**: 需要前后端同时启动，要求手工测试并反馈问题信息
3. **数据库操作**: 通过迁移脚本测试确保数据一致性
4. **AI 服务集成**: 使用模拟数据和真实 API 分别测试

### 测试流程
1. **单元测试**: 核心业务逻辑和工具函数
2. **集成测试**: 前后端 API 调用和数据库操作
3. **手工测试**: UI 交互、用户体验和完整流程
4. **回归测试**: 确保新功能不影响现有功能

## 性能优化

- 使用 React.memo 避免不必要重渲染
- 懒加载路由和组件
- 图片资源优化
- Tauri bundle 体积优化
- 数据库查询优化（索引、分页）

## 安全规范

- 严格的 CSP 配置
- API 端点权限控制
- 敏感操作需要确认
- 输入验证和清理
- API Key 安全存储

## 代码生成规则

### 组件生成
- 新组件必须包含 TypeScript 接口定义
- 创建对应的 CSS Module 文件 `ComponentName.module.css`
- 包含基本的 props 验证和默认值
- 添加 JSDoc 注释说明组件用途
- 遵循项目的文件命名和目录结构
- 使用 CSS 变量而非硬编码样式值

### API 层生成
- Tauri 命令必须有对应的前端 TypeScript 类型
- 包含错误处理和加载状态管理
- 添加 JSDoc 注释描述 API 功能和参数

### 工具函数生成
- 纯函数优先，避免副作用
- 必须包含完整的 TypeScript 类型注解
- 添加使用示例和文档注释

## 重构规则

### 重构触发条件
- 函数超过 50 行代码
- 组件 props 超过 10 个
- 代码重复超过 3 次
- 圈复杂度过高（> 10）
- 测试覆盖率低于 80%

### 重构策略
- **提取组件**: 大组件拆分为小组件
- **提取 hooks**: 复用状态逻辑
- **提取工具函数**: 复用业务逻辑
- **合并相似功能**: 避免重复代码
- **优化数据结构**: 提升性能和可读性

## 未来优化方向

### 功能增强
1. **社交功能**: 学习计划分享、好友挑战
2. **多语言支持**: 界面国际化
3. **云同步**: 跨设备数据同步
4. **离线模式**: 完全离线使用
5. **更多 AI 功能**: 智能推荐、个性化学习路径

### 性能优化
1. **虚拟滚动**: 大列表性能优化
2. **缓存策略**: 数据缓存和预加载
3. **懒加载**: 按需加载组件和数据
4. **数据库优化**: 查询优化、索引优化

### 用户体验
1. **动画效果**: 平滑的过渡动画
2. **主题定制**: 更多主题选项
3. **快捷键支持**: 键盘快捷操作
4. **通知提醒**: 学习提醒和成就通知

## 项目维护

### 日志位置
- **应用数据目录**: `~/.local/share/pindu-app/` (Linux)
- **日志文件**: `logs/app.log`

### 数据库位置
- **数据库文件**: `vocabulary.db` (在应用数据目录)

### 配置文件
- **Tauri 配置**: `src-tauri/tauri.conf.json`
- **Vite 配置**: `vite.config.ts`
- **TypeScript 配置**: `tsconfig.json`

## 总结

RedLark 是一个功能完善的单词学习应用，采用现代化的技术栈和清晰的架构设计。系统包含单词本管理、学习计划、AI 辅助、练习系统、统计分析等核心功能，支持跨平台部署。通过严格的开发规范和完善的测试流程，确保代码质量和系统稳定性。

系统的核心优势在于：
1. **科学的学习方法**: 三步练习法和 AI 智能规划
2. **完善的数据管理**: 本地 SQLite 数据库，数据安全可控
3. **跨平台支持**: Tauri 框架，一套代码多平台运行
4. **良好的架构设计**: 前后端分离，模块化设计
5. **完善的开发规范**: 统一的代码风格和接口规范

通过持续的功能增强和性能优化，RedLark 将成为更加强大和易用的单词学习工具。
