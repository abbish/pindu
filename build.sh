#!/usr/bin/env bash
# 一键构建安装包（macOS / Linux）。参数原样传给 scripts/package.mjs，例如：
#   ./build.sh                       # 本机安装包
#   ./build.sh --target mac-universal
#   ./build.sh --check               # 只检查环境
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请从 https://nodejs.org 安装 20 或更高版本（LTS），然后重新运行 ./build.sh" >&2
  exit 1
fi
exec node scripts/package.mjs "$@"
