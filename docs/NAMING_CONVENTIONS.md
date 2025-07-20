# 前后端命名规范标准

## 基本原则

### 前端命名规范 (TypeScript)
- **变量和属性**: `camelCase` - 如 `bookId`, `modelId`, `wordbookIds`
- **接口和类型**: `PascalCase` - 如 `StudyPlan`, `CreateWordRequest`
- **常量**: `UPPER_SNAKE_CASE` - 如 `API_ENDPOINTS`

### 后端命名规范 (Rust)
- **变量和字段**: `snake_case` - 如 `book_id`, `model_id`, `wordbook_ids`
- **结构体和枚举**: `PascalCase` - 如 `StudyPlan`, `CreateWordRequest`
- **常量**: `UPPER_SNAKE_CASE` - 如 `DEFAULT_TIMEOUT`

## Tauri 命令参数命名转换

### 自动转换机制
Tauri 会自动在前后端之间进行参数名称转换：
- **前端 → 后端**: `camelCase` → `snake_case`
- **后端 → 前端**: `snake_case` → `camelCase`

### 标准化参数映射表

| 前端 (TypeScript) | 后端 (Rust) | 说明 |
|------------------|-------------|------|
| `bookId` | `book_id` | 单词本ID |
| `wordId` | `word_id` | 单词ID |
| `planId` | `plan_id` | 学习计划ID |
| `modelId` | `model_id` | AI模型ID |
| `wordbookIds` | `wordbook_ids` | 单词本ID数组 |
| `wordData` | `word_data` | 单词数据对象 |
| `studyPeriodDays` | `study_period_days` | 学习周期天数 |
| `reviewFrequency` | `review_frequency` | 复习频率 |
| `intensityLevel` | `intensity_level` | 学习强度等级 |
| `startDate` | `start_date` | 开始日期 |
| `endDate` | `end_date` | 结束日期 |
| `aiPlanData` | `ai_plan_data` | AI规划数据 |
| `lifecycleStatus` | `lifecycle_status` | 生命周期状态 |
| `createdAt` | `created_at` | 创建时间 |
| `updatedAt` | `updated_at` | 更新时间 |
| `deletedAt` | `deleted_at` | 删除时间 |

## 命令定义规范

### 后端命令定义模板
```rust
#[tauri::command]
pub async fn command_name(
    app: AppHandle,
    param1: String,
    param2: Option<i64>,
    param3: Option<String>,
) -> AppResult<ReturnType> {
    // 命令实现
}
```

### 前端调用模板
```typescript
const result = await this.client.invoke<ReturnType>('command_name', {
  param1: value1,
  param2: value2,  // 自动转换为 param_2
  param3: value3   // 自动转换为 param_3
});
```

## 验证规则

### 前端验证
1. 所有API调用参数必须使用驼峰命名
2. 不得使用下划线命名
3. 参数名称必须与后端期望的转换结果匹配

### 后端验证
1. 所有命令参数必须使用下划线命名
2. 不得使用驼峰命名
3. 参数类型必须使用基础类型（String, i64, bool等）

## 常见错误和解决方案

### 错误1：参数为 None/null
**原因**: 前端参数命名与后端不匹配
**解决**: 检查命名转换是否正确

### 错误2：类型转换失败
**原因**: 使用了自定义类型作为命令参数
**解决**: 改用基础类型（String, i64, bool等）

### 错误3：命令未找到
**原因**: 命令未在 lib.rs 中注册
**解决**: 在 generate_handler! 宏中添加命令

## 代码生成检查清单

在生成新的API接口时，必须确保：
- [ ] 前端使用驼峰命名
- [ ] 后端使用下划线命名
- [ ] 参数类型使用基础类型
- [ ] 命令已在 lib.rs 中注册
- [ ] 添加了相应的类型定义
- [ ] 包含适当的错误处理
