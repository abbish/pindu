# Tauri IPC Contract（RedLark）

前后端之间唯一的通信面是 `invoke(command, args)`。本文件是这条边界上命名、形状与类型同步的规范 owner。细节映射表另见 `docs/NAMING_CONVENTIONS.md`。

## 1. 命令名

- Rust：`#[tauri::command] pub async fn snake_case_name(app: AppHandle, ...) -> AppResult<T>`。
- 必须在 `lib.rs` `generate_handler![]` 注册；`handlers/mod.rs` 对 `handlers/*` 做了 `pub use`，`lib.rs` 直接写命令名（全部命令都在 `handlers/` 下）。
- 前端：`this.client.invoke<T>('snake_case_name', { ... })`，命令名字符串与 Rust 函数名完全一致。
- 重命名命令 = 两端同批改 + `rg` 确认无遗留。

## 2. 参数命名转换

Tauri 2 自动把前端 args 的 **camelCase 键** 映射到 Rust 的 **snake_case 参数**。

| 前端传 | Rust 收 |
| --- | --- |
| `bookId` | `book_id` |
| `wordbookIds` | `wordbook_ids` |
| `includeDeleted` | `include_deleted` |

规则：
- 前端 **只写 camelCase**，不写下划线键名（写了会 `missing field`）。
- 单词参数（`id`、`status`）两侧相同。
- Rust 参数类型用基础类型：`String / Option<String> / i64 / Option<i64> / bool / Vec<String> / Vec<i64>`；复杂输入用一个 `request: XxxRequest` 结构体（结构体内部字段遵循第 3 节）。不用 `Option<Id>` 这类别名作顶层参数。
- 前端可选参数传 `undefined` 或省略键都映射为 `None`；传 `null` 也可。

## 3. 返回值 serde 形状

- Rust struct 默认序列化为 **snake_case 字段**（`total_words`、`created_at`）；TS 类型照抄 snake_case。
- 带 `#[serde(rename_all = "camelCase")]` 的结构体（目前 `types/tts.rs` 全部、部分 AI 分析结构）输出 camelCase；TS 类型照抄 camelCase。
- **不混用**：一个结构体要么全 snake_case 要么全 camelCase；新结构体默认不加 `rename_all`，与大多数现有类型一致。加了必须在 plan 中注明。
- `Option<T>` → TS `field?: T` 或 `T | null`（Tauri 序列化为 `null`）；TS 侧用 `?? ` 处理，不假设 undefined。
- 枚举：以字符串输出，大小写看 serde 属性——`UnifiedStudyPlanStatus` 为 PascalCase 变体名，`StudyPlanLifecycleStatus` 为 `rename_all = "lowercase"`；TS 用字面量联合类型镜像。
- Tauri 只把**顶层参数名**从 camelCase 转成 snake_case；嵌套在 `request` / `query` 等结构体里的字段按该结构体的 serde 属性解析，不会自动转换（`AIModelQuery` 因此显式加了 `rename_all = "camelCase"`）。
- `Id = i64` → TS `number`（安全范围内）；`Timestamp = String` → TS `string`。

## 4. ApiResult 与错误 contract

```ts
type ApiResult<T> = { success: true; data: T } | { success: false; error: string; code?: AppErrorCode };
type AppErrorCode = 'DATABASE_ERROR' | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'INTERNAL_ERROR' | 'EXTERNAL_SERVICE_ERROR';
```

**后端错误的 wire 形状**（唯一允许的形状）：

```json
{ "code": "VALIDATION_ERROR", "message": "验证错误: 单词本标题不能为空" }
```

- `AppError` 手写 `Serialize` 输出 `{code, message}`；`message` 等于 `Display`（`#[error(...)]`）文本。**不得** `#[derive(Serialize)]`，那会产生 `{"ValidationError":"..."}` 的外部标签形状，前端无法解析（2026-10 修复前的缺陷）。
- `AppError` 的变体文本前缀只出现一次：`From<sqlx::Error>` 传入变体的应是原始错误信息，不再自行拼接“数据库错误:”。
- `TauriApiClient.invoke` 把 Rust `Ok(T)` 包成 `success: true`；把 `Err` 解析为 `success: false, error: message, code`。遇到非 `{code,message}` 形状时才回退为字符串化，并视为 contract 违反。
- Rust 端 **不要** 自己再包一层 `{ success, data }`；直接返回 `AppResult<T>`。
- 前端 **必须** 判 `success`；`data` 只在 `success === true` 分支有效。需要按错误类别分支时用 `code`，不解析 `error` 文本。
- 测试：`error.rs` 中有序列化单测锁定 wire 形状。

## 5. 类型同步

| Rust | TS |
| --- | --- |
| `types/wordbook.rs` | `src/types/wordbook.ts` |
| `types/study.rs` | `src/types/study.ts` |
| `types/ai_model.rs` | `src/types/ai-model.ts` |
| `types/word_analysis.rs` | `src/types/word-analysis.ts` |
| `types/tts.rs` | `src/services/ttsService.ts` 内联类型 |
| `types/common.rs` | `src/types/common.ts` |

- 改 Rust 字段 → 同批改 TS；反之亦然。
- `src/types/api.ts` 里的 Health/Export/Import 类型没有后端实现，不扩展它。

## 6. 对账检查清单（verify 用）

先运行 `python3 scripts/check-ipc-contract.py` 与 `python3 scripts/check-type-sync.py`（同名 Rust struct ↔ TS interface 的实际 JSON 键对账；前端 DTO 与 `*Safe` 映射在脚本顶部登记）。check-ipc-contract：它静态检查①前端 `invoke('x')` 的命令都已在 `lib.rs` 注册，②已注册命令都有 `#[tauri::command]` 定义，③前端 args 键（camelCase）都能映射到 Rust 参数（snake_case），④Rust 必填参数前端都传了。脚本覆盖不了的项再人工核对：

- [ ] `lib.rs` 注册 —— `rg "<cmd>" src-tauri/src/lib.rs`
- [ ] handler 签名参数均为基础类型或单一 request 结构体
- [ ] `types/*.rs` 返回结构体的 serde 属性已知（默认 snake / 显式 camel）
- [ ] `src/types/*.ts` 字段名与 serde 输出一致（`check-type-sync.py` 0 错误；消费处不用 `as any` 绕过类型——2026-10 的日历月统计、今日日程、计划统计“全 0”都是 `as any` 掩盖的键名不一致）
- [ ] `src/services/*.ts` 调用：命令名一致、args 键为 camelCase、泛型为正确 TS 类型
- [ ] 页面消费处判 `success`
- [ ] `tauri:dev` 触发一次，`app.log` 有成对 `api_request` / `api_response`，前端拿到的字段非 undefined

## 7. 已知偏差（不要扩散）

- 诊断命令返回 `serde_json::Value`。
- `types/tts.rs` 使用 camelCase 而其它类型 snake_case。
- `StudyPlanScheduleRequest` / `CreateStudyPlanWithScheduleRequest` 是前端内部 DTO（camelCase），由 `studyService` 在发送前显式转为 snake_case 的 `request`；新增请求类型优先直接用 Rust 的键名，不再新增这种转换层。
