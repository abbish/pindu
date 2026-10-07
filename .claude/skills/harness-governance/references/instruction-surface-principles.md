# 指令面分层原则

## 三层

| 层 | 放什么 | 不放什么 |
| --- | --- | --- |
| `CLAUDE.md` | 所有任务都需要的事实与硬约束：技术栈、命令、目录地图、三层架构与规范、迁移/IPC 三条硬规则、已知债务、典型改动路径、harness 入口 | 多步骤流程、单一场景细节、当前任务计划、易漂移的版本清单 |
| `.claude/skills/<id>/SKILL.md` | 某类工作的判断流程、owner 边界、输出形态、完成条件 | 复述 CLAUDE.md 的事实；业务代码细节大全 |
| `references/` `assets/` | 条件化读取的专项标准（迁移、IPC contract、验证方法、诊断地图）与可删减模板 | 没有 Skill 引用的孤儿文档 |
| hooks / scripts | 必须强制且可机械判定的约束 | 需要判断的软规则 |

## 判断一条规则归哪里

1. 是否每个任务都要知道？是 → `CLAUDE.md`。
2. 是否只在某类工作中用到？是 → 对应 Skill；如果篇幅大且只在部分批次用到 → 该 Skill 的 reference，并在 SKILL.md 写明“触达 X 时读”。
3. 是否可以用正则/文件存在性/命令退出码判定？是，且违反代价高 → hook 或 validate 脚本，CLAUDE.md 保留一句规则并指向 hook。
4. 是否是当前任务的决定？是 → `.claude/work/<id>/`，不进指令面。

## 写 description 的要求

frontmatter `description` 决定 Skill 是否被选中：
- 第一句说清“什么情况下触发”，含用户常用的中英文说法；
- 明确“不用于什么”并指出替代 Skill；
- 末尾 `Keywords:` 列 6–10 个触发词；
- explicit-only 的 Skill 加 `disable-model-invocation: true`。

## 多客户端

当前只服务 Claude Code，`CLAUDE.md` 是根入口。若要同时服务 Codex：
- 把 `.claude/skills/` 搬到 `.agents/skills/` 作 canonical，`.claude/skills/<id>` 改为符号链接（ai4se 的 `sync-claude-skills.sh` 模式）；
- 根入口改为 `AGENTS.md` 并删除 `CLAUDE.md`（两者并存时 Claude Code 只读 CLAUDE.md，会形成双入口）。
只做一次整体迁移，不长期双写。

## 反模式

- 为了“完整”给每个 Skill 配齐 references/assets。
- 在多个文件复制同一条规则的不同措辞。
- 把一次性的排障经验写成永久规则（应进 `redlark-diagnostic-map.md` 的症状表或直接留在 evidence）。
- 用长篇说明代替一个 10 行的 hook。
