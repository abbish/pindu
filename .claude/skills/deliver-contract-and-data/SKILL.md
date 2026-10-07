---
name: deliver-contract-and-data
description: "Tauri IPC contract 与数据形状一致性：批次核心是命令名、参数命名（camelCase ↔ snake_case）、serde 输出形状、Rust types ↔ TS types 同步、ApiResult 形状或共享常量的收口时使用，作为前后端实现的横切关注点。不接管某一端的整页/整面功能实现，只负责 contract 一致。Keywords: contract, IPC, invoke, command name, serde, 参数名, 类型同步, data shape, 字段对不上."
---

# Deliver Contract And Data

本 Skill 处理 Tauri IPC 边界上的 contract 和数据结构一致性，而不是整个功能流程。

`references/tauri-ipc-contract.md` 是命令名、参数命名、serde 形状、类型同步与 `ApiResult` 的唯一规范；后端与前端 Skill 只引用它。
涉及任何时间字段（时刻 / 日历日期 / “今天”）时读 `references/time-and-timezone.md`（存储 UTC、展示按本机时区的唯一规范）。

## 输入

- 当前批次目标与 `plan.md` 中的 contract / data 要求
- 涉及的命令（handler 签名 + `lib.rs` 注册）、`types/*.rs`、`src/types/*.ts`、`src/services/*.ts` 调用点

## 负责什么

- 在 contract / data 面完成一个连贯批次
- 明确 producer（Rust handler + types）、consumer（TS service + 页面）、shared owner
- 给出一致性验证建议（六点对账）

## 不负责什么

- 直接接管整个前后端功能实现
- 在页面或 handler 局部拼长期 wire 形状
- 只改单一 producer 而忽略 consumer 和测试

## 规则

- 先确认 contract owner：命令名（`lib.rs` 注册）、参数（handler 签名）、返回形状（`types/*.rs` + serde 属性）、TS 镜像（`src/types/*.ts`）、调用点（`src/services/*.ts`）。
- 多层重复出现的数据结构优先升级为命名类型（Rust struct + TS interface），不用 `serde_json::Value` / `any` 作长期 contract。诊断类命令返回 `Value` 是已知例外，不扩散。
- contract 变动默认检查 producer、consumer、tests 三面；用 `rg "'<command>'" src/` 与 `rg "fn <command>" src-tauri/src/` 找全调用点。
- `src/api/endpoints.ts` 已过时，不以它为准也不往里加；命令名直接写在 service 里。
- 如果 contract 变更引出新的范围或缺失上游决定，先回到 `sdd-plan` 或 `sdd-analyze`。

## 默认执行方式

1. 确认当前批次只覆盖哪些命令 / 类型。
2. 按 `references/tauri-ipc-contract.md` 的检查清单逐项对账并修改。
3. 记录联动面：producer / consumer / tests。
4. 把六点对账与一次 `tauri:dev` 触发作为验证入口交给 `sdd-verify`。

## 完成条件

- 当前 contract / data 批次已完成
- producer / consumer 联动已说明
- 一致性验证入口清楚
