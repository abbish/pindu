---
name: sdd-work
description: "统一开发入口：用户要端到端推进 RedLark 的新功能、缺陷修复、重构或质量改进（feature / bugfix / refactor / improvement）时触发。收敛目标、范围、验收标准、未知项和下一步 owner，再按实际缺口进入 sdd-plan、sdd-analyze、sdd-implement 或 sdd-verify。不用于发布新版本（sdd-release，仅显式）、单纯恢复/续跑（harness-context-memory）或已经规划好的窄实现批次（sdd-implement）。Keywords: implement feature, fix bug, refactor, improve, 加功能, 修 bug, 重构, end-to-end, SDD."
---

# SDD Work

本 Skill 是普通开发工作的统一入口。任务类型只改变要保护的约束，不选择一套固定阶段流程。

## 先读

- `CLAUDE.md`（根规则：架构、目录地图、硬性规范、已知债务、典型改动路径）。
- 需要跨批次或跨会话恢复时，读 `../harness-context-memory/references/work-item-contract.md`。
- 工作触达 `src-tauri/src/prompts/*.md`、AI 输出解析或分析进度时，同时读 `../deliver-ai-prompt/SKILL.md`。
- 工作触达表结构时，先看 `../deliver-backend-rust/references/sqlx-migration-standards.md` 的“Plan”节判断迁移批次形状。
- 工作要写用户会看到的内容（界面文案、更新说明、用户文档）时，读 `references/user-facing-writing.md`：用户是普通学习者，只写他能感知的变化和要做的事，不写技术细节。

## 输入

- 用户目标、现有证据和明确约束
- 相关 live owner（页面 / service / 命令 / handler / service / repository / 表）、调用方和验证入口
- 已存在的 `brief.md`、`plan.md`、`progress.md` 或 `evidence.md`

## 负责什么

- 确认要解决的用户结果、成功标准、范围和非目标
- 区分 confirmed / inferred / unknown，只追问会改变范围、方案或验收的 blocker
- 判断下一步应是规划、因果分析、执行、验证、暂停还是结束
- 只有需要持续恢复时创建或续用最小 work item（`.claude/work/<work-id>/`）

## 工作判断

1. **Shape**：目标、范围、验收、owner 和关键未知项是否足够支撑下一决策。
2. **Plan**：改动面（哪几层）、IPC contract、迁移、批次、验证和回退是否足够支撑一个连贯实现批次。
3. **Execute**：当前批次是否已准备好；准备好才交给 `sdd-implement`。
4. **Accept**：证据是否覆盖接受条件；不足则回到最近的真实 owner，不机械补阶段。

下一步由当前决定需要什么来确定：

- 用户结果、owner 和当前 contract 已清楚 → 直接进入 plan 或 implement。
- 多个候选原因会导向不同 owner 或不同改法 → 进入 analyze 区分。
- live surface 已存在重复 owner、冲突 contract 或无 consumer 的结构（CLAUDE.md §8 列有已知项）→ 可据此规划收敛；对行为影响的因果主张仍需证据。
- 只补会改变下一步、接受条件或结论边界的证据。

按工作类型补充判断：

- **feature**：用户在桌面端看到的结果、流程和验收标准明确；默认走 CLAUDE.md §9 的“加一个新后端命令并在前端使用”或“改表结构”路径，先判断是否真的需要新命令、新表或新页面。
- **bugfix**：症状与违反的当前 contract 明确；原因不清时先进入 `sdd-analyze`，不带猜测修改 production。RedLark 常见症状类（命令找不到 / 参数反序列化失败 / 迁移 panic / 状态机不一致 / AI JSON 解析失败）见 `../sdd-analyze/references/redlark-diagnostic-map.md`。
- **refactor**：默认行为不变，允许变化必须写清并可验证；触达 `handlers/diagnostics.rs` 等已知债务时，先确认本批只收口哪一块。
- **improvement**：核对适用条件、live owner、consumer 和当前证据，选择能独立验收的最小连贯批次。
- **AI 提示词 / 规划质量 improvement**：使用 `deliver-ai-prompt` 判断 owner（提示词 / 解析结构 / 调用参数）与验证层；单次模型输出不能单独证明问题或修复。

## 从改动到发布

每个改动在 Shape 时就判断它对发布的影响，到收口时兑现，这样发版时不用再翻提交历史：

- **用户可见**（新功能、行为变化、修复用户碰到的问题）：验收通过后，在 `docs/releases/UNRELEASED.md` 加一行，按 `references/user-facing-writing.md` 写普通用户能看懂的话（不写路径、组件、机制等技术细节）；发版时它就是这一版的更新说明。纯重构、测试、文档、开发工具类改动不记。
- **数据**：要加迁移的，遵守 `CLAUDE.md` §7.1（只增、登记 `migrations.lock`、能在上一版的真实数据上升级）；不能为了省事改已发布的迁移。
- **升级与更新链路**：触达 identifier、数据目录、启动升级、更新配置或打包发版的，验收必须走 `../sdd-verify/references/release-and-update-verification.md`。
- **提交与 CI**：按批次提交到 `main`（作者与署名遵循仓库约定），推送后看 CI（`gh run list --branch main`）；CI 不绿就算没完成。
- **发版**：不在本入口发布。攒够要发的改动后，由用户显式 `/sdd-release`。

## 不负责

- 编写完整技术方案或批次列表；归 `sdd-plan`
- 直接实现领域代码；归 `sdd-implement` 和对应 `deliver-*`
- 用流程文件数量代替决策充分性
- 发布新版本；归 `sdd-release`（用户显式 /sdd-release）

## 规则

- 用户明确只要 plan、analysis、implementation 或 verification 时，直接进入对应 Skill，不先绕本入口。
- 开始前执行 `git status --short`，保护用户留下的未提交改动；不回滚、覆盖或顺手整理无关文件。
- 当前会话能闭环的窄任务不创建 work item。
- blocker 只指会实质改变范围、方案、不可逆结果（如迁移、删数据）或验收的缺失；其余风险显式携带前进。
- 当前计划只表达仍有效的实现路径；新事实推翻旧批次时替换或删除旧内容，不在末尾追加第二条路线。
- 发现计划与 live owner 不一致时回到 `sdd-plan` 或 `sdd-analyze`，不边改边重写目标。
- 收口时更新 `progress.md` 和必要的 `evidence.md`；一次性任务由最终回复承担等价交接。

## 输出形态

Shape 结论按下面的块交付：一次性任务写在回复里，持续任务写入 `brief.md` 与 `progress.md`。

```text
目标：<用户在应用中得到的结果，一句>
范围 / 非目标：<触达的层：前端页面 / service / IPC 命令 / handler / service / repository / 迁移 / 提示词> / <…>
验收：<可核验条件，1–3 条>
已确认 / 推断 / 未知：<…> / <…> / <只列会改变范围、方案或验收的项>
发布影响：用户可见（进 UNRELEASED.md）/ 不可见；迁移 有 / 无；触达升级或更新链路 是 / 否
下一步：plan | analyze | implement | verify | 暂停 —— 缺什么：<当前决定缺的信息>
work item：不创建 | 续用 <work-id> | 新建 <work-id>
```

## 完成条件

- 目标、范围、验收和关键未知项足以支撑下一决策
- 下一 owner 与动作明确，或 blocker 已明确暴露
- 没有为流程完整制造未被消费的 artifact
- 收口时：用户可见的改动已记入 UNRELEASED.md，提交已推送且 CI 为绿
