#!/usr/bin/env bash
# 校验 .claude/skills 结构：catalog ↔ 目录一致、frontmatter name/description、相对引用存在、README 覆盖、hook 可执行。
# 只证明结构正确，不证明真实路由或行为。用法：bash scripts/validate-skills.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SK="$ROOT/.claude/skills"
CATALOG="$SK/catalog.yaml"
errors=0
err() { echo "✗ $*" >&2; errors=$((errors+1)); }

[[ -f "$CATALOG" ]] || { err "缺少 $CATALOG"; exit 1; }
IDS=()
while IFS= read -r line; do IDS+=("$line"); done < <(sed -nE 's/^  - id: ([A-Za-z0-9._-]+)[[:space:]]*$/\1/p' "$CATALOG")
[[ ${#IDS[@]} -gt 0 ]] || err "catalog.yaml 未解析到任何 skill id"

# 1) catalog 中每个 id 有 SKILL.md，frontmatter name 一致，description 非空，path 正确
for id in "${IDS[@]}"; do
  f="$SK/$id/SKILL.md"
  [[ -f "$f" ]] || { err "$id: 缺少 $f"; continue; }
  fm="$(awk 'NR==1&&$0!="---"{exit} NR>1&&$0=="---"{exit} NR>1{print}' "$f")"
  name="$(printf '%s\n' "$fm" | sed -nE 's/^name:[[:space:]]*"?([^"]+)"?[[:space:]]*$/\1/p' | head -1)"
  desc="$(printf '%s\n' "$fm" | sed -nE 's/^description:[[:space:]]*(.+)$/\1/p' | head -1)"
  [[ "$name" == "$id" ]] || err "$id: frontmatter name='$name' 与目录名不一致"
  [[ -n "$desc" ]] || err "$id: frontmatter 缺少 description"
  grep -qE "^    path: \.claude/skills/$id/SKILL\.md[[:space:]]*$" "$CATALOG" || err "$id: catalog path 应为 .claude/skills/$id/SKILL.md"
  grep -qE "^- \`$id\`" "$SK/README.md" || err "$id: README.md 未列出"
  # 2) 相对引用存在性（references/、assets/、../<skill>/）
  while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    target="$SK/$id/$ref"
    [[ -e "$target" ]] || err "$id: 引用不存在 $ref"
  done < <(grep -oE '`(\.\./[A-Za-z0-9._-]+/|references/|assets/)[A-Za-z0-9._/-]+`' "$f" | tr -d '`' | sort -u)
done

# 3) 目录中每个含 SKILL.md 的 skill 都在 catalog
for d in "$SK"/*/; do
  id="$(basename "$d")"
  [[ -f "$d/SKILL.md" ]] || continue
  printf '%s\n' "${IDS[@]}" | grep -qx "$id" || err "$id: 目录存在但未注册到 catalog.yaml"
done

# 4) disable-model-invocation 的 skill 在 README 中标注“显式”
for id in "${IDS[@]}"; do
  f="$SK/$id/SKILL.md"; [[ -f "$f" ]] || continue
  if grep -qE '^disable-model-invocation:[[:space:]]*true' "$f"; then
    grep -qE "\`$id\`.*显式" "$SK/README.md" || err "$id: 为 explicit-only，但 README 未标注显式调用"
  fi
done

# 5) hooks 可执行且被 settings.json 引用
for h in "$ROOT"/.claude/hooks/*.sh; do
  [[ -x "$h" ]] || err "hook 不可执行: $h"
  grep -q "$(basename "$h")" "$ROOT/.claude/settings.json" || err "hook 未在 settings.json 引用: $(basename "$h")"
done

if [[ $errors -eq 0 ]]; then echo "✓ skills 校验通过（${#IDS[@]} 个 skill）"; else echo "共 $errors 个问题" >&2; exit 1; fi
