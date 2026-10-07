#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit) 守卫：CLAUDE.md「数据库迁移只增不改」的可执行 gate。
# 已存在的 src-tauri/migrations/NNN_*.sql 不允许被 Edit/Write 修改；新建文件放行。
# 退出码 2 = 阻断并把 stderr 反馈给模型；0 = 放行。
set -uo pipefail

input="$(cat)"
extract() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c "import json,sys
d=json.load(sys.stdin); ti=d.get('tool_input',{})
for k in ('file_path','path','notebook_path'):
    if ti.get(k): print(ti[k]); break" 2>/dev/null
  fi
}
path="$(extract '.tool_input.file_path')"
[[ -n "$path" ]] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$path" in
  */src-tauri/migrations/*.sql|src-tauri/migrations/*.sql)
    abs="$path"; [[ "$abs" = /* ]] || abs="$root/$path"
    if [[ -f "$abs" ]]; then
      printf '已拦截：禁止修改已存在的迁移文件 %s\n规则：CLAUDE.md §7.1 迁移只增不改。请新建下一序号的迁移脚本（见 deliver-backend-rust/references/sqlx-migration-standards.md）。\n' "$path" >&2
      exit 2
    fi
    ;;
esac
exit 0
