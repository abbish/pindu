#!/usr/bin/env bash
# PreToolUse(Bash) 守卫：把 CLAUDE.md 的硬约束落成可执行 gate。只拦截，不替代说明。
# 退出码 2 = 阻断并把 stderr 反馈给模型；0 = 放行。
set -uo pipefail

input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)"
else
  cmd="$input"
fi
[[ -n "$cmd" ]] || exit 0

deny() { printf '已拦截：%s\n命令：%s\n' "$1" "$cmd" >&2; exit 2; }
S='(^|[;&|]\s*|\$\(\s*)'

# 1) 迁移只增不改：禁止通过 shell 改写/回退已有迁移文件。
if printf '%s' "$cmd" | grep -qE "${S}(sed\s+-i|perl\s+-pi|tee|truncate)\b.*src-tauri/migrations/[0-9]{3}_"; then
  deny "不就地改写 src-tauri/migrations 下的历史迁移；新建下一序号脚本（CLAUDE.md §7.1）"
fi
if printf '%s' "$cmd" | grep -qE "${S}git\s+(checkout|restore)\s+.*src-tauri/migrations/"; then
  deny "不用 git checkout/restore 回退迁移文件；迁移只增不改（CLAUDE.md §7.1）"
fi
if printf '%s' "$cmd" | grep -qE "${S}(rm|unlink|mv)\s+(-[a-zA-Z]+\s+)*\S*src-tauri/migrations/[0-9]{3}_"; then
  deny "不删除或重命名已有迁移脚本（CLAUDE.md §7.1）"
fi

# 2) 禁止删库重建：不删除应用数据库文件，不用 sqlx database drop/reset。
if printf '%s' "$cmd" | grep -qE "${S}(rm|unlink|truncate|shred)\s+.*(vocabulary\.db|redlark\.db|com\.redlark\.pindu-app)"; then
  deny "不删除应用数据库解决问题；通过新增迁移修复（CLAUDE.md §7.1）"
fi
if printf '%s' "$cmd" | grep -qE "${S}(cargo\s+)?sqlx\s+(database\s+(drop|reset)|migrate\s+revert)"; then
  deny "不使用 sqlx database drop/reset 或 migrate revert；迁移只向前"
fi

# 3) 凭据文件不得整文件输出。
if printf '%s' "$cmd" | grep -qE "${S}(cat|less|more|head|tail|bat)\s+.*\.(pem|key|p12|jks)(\s|$)"; then
  deny "不输出私钥/证书文件内容"
fi
if printf '%s' "$cmd" | grep -qE "${S}(cat|less|more|head|tail|bat)\s+\S*\.env(\.[A-Za-z0-9_-]+)?(\s|$)"; then
  deny "不读取完整 .env；只用 grep -E '^KEY=' file | cut -d= -f1 检查 key 是否存在"
fi

exit 0
