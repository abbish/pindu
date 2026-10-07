# Skill 审查清单

对单个 Skill 逐项检查；每条 finding 写 问题 / 证据（文件:行或引用）/ 影响 / 建议。

## 触发

- [ ] description 的触发条件与其它 Skill 不重叠；重叠处写明了“归谁”。
- [ ] 含用户会说的中文与英文触发词。
- [ ] 写明不适用场景与替代 Skill。
- [ ] explicit-only 时有 `disable-model-invocation: true` 且 README 标注。

## 身份与 owner

- [ ] 一段定位说清它是 workflow / domain capability / evidence / governance 中的哪类。
- [ ] “负责什么 / 不负责什么” 边界与 catalog group 一致。
- [ ] 不复述 CLAUDE.md 事实；引用用 “以 CLAUDE.md §N 为准”。

## 资源

- [ ] 每个 reference 在 SKILL.md 中有条件化读取说明（“触达 X 时读”）。
- [ ] 没有被引用的 reference / asset（`validate-skills.sh` 检查引用存在性，不检查反向；人工确认）。
- [ ] 模板说明“可删减”，没有变成必填清单。
- [ ] 相对路径用反引号包裹（`references/x.md`、`../other/SKILL.md`），校验脚本靠它提取。

## 行为有效性

- [ ] 输出形态是执行者能直接填写的块，不是抽象要求。
- [ ] 完成条件可核验。
- [ ] 规则条目能对应到真实失败模式（RedLark：命令未注册、参数名、serde 形状、迁移改历史、单次 AI 输出归因），不是泛泛原则。
- [ ] 与 hook / 脚本一致：Skill 说“禁止”的事，若可机械判定，hook 已拦。

## 维护

- [ ] catalog.yaml 的 summary 与 description 第一句一致。
- [ ] README 列出并归到正确分组。
- [ ] `bash scripts/validate-skills.sh` 通过。
