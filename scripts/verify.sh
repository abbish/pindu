#!/usr/bin/env bash
# RedLark 一键验证：静态检查 + 测试，全部运行后汇总；当前机器缺少的工具记为“未运行”，不算通过。
# 用法:
#   bash scripts/verify.sh                 # 全部
#   bash scripts/verify.sh --quick         # 跳过 cargo clippy / cargo test
#   bash scripts/verify.sh --work <id>     # 日志写入 .claude/work/<id>/logs/（默认取最近修改的 work item）
# 规范：.claude/skills/sdd-verify/references/verification-methods.md「验证环境矩阵」
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0; WORK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) QUICK=1 ;;
    --work) WORK="$2"; shift ;;
    *) echo "未知参数 $1" >&2; exit 2 ;;
  esac
  shift
done
if [[ -z "$WORK" && -d .claude/work ]]; then
  WORK="$(ls -t .claude/work 2>/dev/null | head -1)"
fi
LOG_DIR=".claude/logs"; [[ -n "$WORK" ]] && LOG_DIR=".claude/work/$WORK/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/verify-$(date +%Y%m%d-%H%M%S).log"

declare -a NAMES STATUS
run() {  # run <名称> <命令...>
  local name="$1"; shift
  echo -e "\n===== $name =====\n\$ $*" | tee -a "$LOG"
  local start=$SECONDS
  if "$@" >>"$LOG" 2>&1; then
    NAMES+=("$name"); STATUS+=("PASS ($((SECONDS-start))s)")
  else
    NAMES+=("$name"); STATUS+=("FAIL ($((SECONDS-start))s)")
  fi
  tail -n 15 "$LOG" | sed 's/^/  | /'
}
skip() { NAMES+=("$1"); STATUS+=("未运行：$2"); echo -e "\n===== $1 =====\n未运行：$2" | tee -a "$LOG"; }

{
  echo "# verify.sh $(date '+%F %T')  host=$(uname -sm)  quick=$QUICK"
  echo "# git: $(git rev-parse --short HEAD 2>/dev/null) ; 未提交文件数: $(git status --short 2>/dev/null | wc -l | tr -d ' ')"
  command -v cargo >/dev/null && echo "# $(cargo --version)"; echo "# node $(node --version 2>/dev/null)"
} | tee "$LOG"

if command -v python3 >/dev/null; then
  run "check-release-invariants（数据目录标识 / 库文件名 / 已发布迁移不变）" python3 scripts/check-release-invariants.py
  run "check-sql（SQL 对迁移终态 schema）" python3 scripts/check-sql.py
  run "check-ipc-contract（invoke ↔ 注册 ↔ 签名）" python3 scripts/check-ipc-contract.py
  run "check-type-sync（Rust serde 键 ↔ TS 接口字段）" python3 scripts/check-type-sync.py
  run "check-css-vars（var(--x) 引用均有定义）" python3 scripts/check-css-vars.py
  run "check-time（时间约定棘轮：后端取时 / 迁移 DEFAULT）" python3 scripts/check-time.py
else
  skip "check-release-invariants" "缺少 python3"; skip "check-sql" "缺少 python3"; skip "check-ipc-contract" "缺少 python3"; skip "check-type-sync" "缺少 python3" ; skip "check-css-vars" "缺少 python3"; skip "check-time" "缺少 python3"
fi

if [[ -x node_modules/.bin/tsc || -f node_modules/typescript/bin/tsc ]]; then
  run "tsc --noEmit" node node_modules/typescript/bin/tsc --noEmit
  run "eslint 棘轮" node scripts/lint-ratchet.mjs
  run "前端测试（node --test）" npm test --silent
else
  skip "前端检查" "node_modules 未安装（npm install）"
fi

if [[ -d agent/node_modules ]]; then
  run "agent tsc（sidecar 类型检查）" node agent/node_modules/typescript/bin/tsc -p agent/tsconfig.json
  run "agent 测试（node --test）" bash -c "cd agent && npm test --silent"
  # tauri-build 要求 externalBin 存在：缺失时先编译当前平台 sidecar
  if ! ls src-tauri/binaries/redlark-agent-* >/dev/null 2>&1; then
    run "agent sidecar 编译（缺失时）" node agent/scripts/build.mjs
  fi
else
  skip "agent 检查" "agent/node_modules 未安装（npm run agent:install）"
fi

if command -v cargo >/dev/null; then
  run "cargo fmt --check" bash -c "cd src-tauri && cargo fmt --check"
  run "cargo check --all-targets" bash -c "cd src-tauri && cargo check --all-targets --message-format short"
  if [[ $QUICK -eq 0 ]]; then
    # 2026-10-06 起 clippy 警告为 0：任何新警告都视为失败
    run "cargo clippy --all-targets -D warnings" bash -c "cd src-tauri && cargo clippy --all-targets --message-format short -- -D warnings"
    run "cargo test" bash -c "cd src-tauri && cargo test"
  else
    skip "cargo clippy / cargo test" "--quick"
  fi
else
  skip "Rust（fmt/check/clippy/test）" "未安装 cargo"
fi

echo -e "\n===== 汇总 =====" | tee -a "$LOG"
fail=0
for i in "${!NAMES[@]}"; do
  printf '%-44s %s\n' "${NAMES[$i]}" "${STATUS[$i]}" | tee -a "$LOG"
  [[ "${STATUS[$i]}" == FAIL* ]] && fail=1
done
echo "日志：$LOG" | tee -a "$LOG"
exit $fail
