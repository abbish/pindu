# RedLark 典型批次形状

本文件给出五种高频批次的 owner 链、必须联动的点和最窄验证入口。plan 时按形状填充，不复制整段。

## 形状 A：新增 / 修改一个 Tauri 命令

```
repositories/<x>_repository.rs   新增查询方法（唯一 SQL 位置）
services/<x>.rs                  业务方法：校验 → 调 repository →（事务）
handlers/<x>.rs                  #[tauri::command] 薄封装：state → api_request → service → api_response
lib.rs                           generate_handler![ ... 新命令 ]      ← 漏掉 = 前端 "command not found"
types/<x>.rs                     返回/请求结构体（serde）
src/types/<x>.ts                 对应 TS 类型（字段名按 serde 实际输出）
src/services/<x>Service.ts       invoke<'cmd'>(camelCase 参数)
src/pages | components           调用并处理 success === false
```
最窄验证：`cargo check` → 前端 `npm run type-check` → `tauri:dev` 中触发一次并在 `logs/app.log` 看到 `api_request`/`api_response` 成对。

## 形状 B：表结构变更

```
migrations/NNN_<intent>.sql      下一序号，一个 schema 意图；需要改列时按 建新表→拷贝→drop→rename
repositories/*                   Row 映射补字段
types/*.rs → src/types/*.ts      两侧同步
受影响 service / 组件
```
标准见 `../../deliver-backend-rust/references/sqlx-migration-standards.md`。
最窄验证：空库首次启动迁移成功 + 用一份真实 `vocabulary.db` 副本启动迁移成功 + 受影响命令跑通。

## 形状 C：新增页面 / 大改页面

```
src/pages/XxxPage.tsx                 PageHeader + 内容区（AppShell 提供导航与面包屑）；navigation.ts 的 RouteParams / TOP_LEVEL_OF / PAGE_TITLE
src/App.tsx                           新增 case 'xxx'；onNavigate(page, params) 参数契约
src/services/*                        数据来源
组件拆分到 src/components/<Name>/
```
规范见 `../../deliver-frontend-react/references/page-layout-standard.md`。
最窄验证：`npm run type-check && npm run lint` → `tauri:dev` 中走一遍导航 + loading/empty/error 三态。

## 形状 D：学习计划状态机 / 练习流程变化

```
权威字段：study_plans.unified_status（PascalCase 字符串）
后端：services/study_plan.rs（转换与写入 + study_plan_status_history）
前端：src/types/study.ts  canTransitionTo / getAvailableActions / getStatusDisplay
      src/pages/plan-detail/planDetailDisplay.ts（详情页动作分组）
日历 / 统计 consumer：repositories/calendar_repository.rs、statistics_repository.rs
```
plan 必须写出 `前态 → 动作 → 写入 → 关联状态（schedules / sessions）→ 界面终态`。
最窄验证：对每条新增/修改的转换写一条 Rust 单测或集成测试；前端 `canTransitionTo` 同步。

## 形状 E：AI 提示词 / 输出结构变化

```
src-tauri/src/prompts/<agent>.md      include_str! 编译进二进制 → 改完必须重新编译
agent/src/tools/*.ts + agent::tasks   对应 submit_* 工具 schema / 校验 + Rust 结果校正
handlers/word_analysis.rs / services/word_analysis_job.rs / jobs.rs   批量分析任务与进度（如涉及）
```
见 `../../deliver-ai-prompt/SKILL.md`。
最窄验证：固定一组输入，用 `test_ai_model` 或真实 Provider 跑 ≥2 次，确认 JSON 可解析且关键字段齐全；语义质量按 `../../sdd-verify/references/verification-methods.md` 的“AI 语义”层评审，不以单次输出下结论。
