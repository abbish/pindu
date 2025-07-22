#!/bin/bash

# RedLark Mac 构建脚本
# 用于在 macOS 上构建 Tauri 应用程序

set -e

echo "🍎 开始 Mac 平台构建..."

# 检查必要的工具
echo "📋 检查构建环境..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js"
    exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装，请先安装 npm"
    exit 1
fi

# 检查 Rust
if ! command -v rustc &> /dev/null; then
    echo "❌ Rust 未安装，请先安装 Rust"
    echo "   可以通过以下命令安装: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# 检查 Tauri CLI
if ! command -v tauri &> /dev/null; then
    echo "⚠️  Tauri CLI 未安装，正在安装..."
    cargo install tauri-cli
fi

echo "✅ 构建环境检查完成"

# 安装依赖
echo "📦 安装前端依赖..."
npm install

echo "📦 安装 Rust 依赖..."
cd src-tauri
cargo fetch
cd ..

# 构建应用
echo "🔨 开始构建应用..."
npm run tauri:build

echo "🎉 构建完成！"
echo ""
echo "📁 构建产物位置:"
echo "   - 应用程序: src-tauri/target/release/bundle/macos/"
echo "   - DMG 安装包: src-tauri/target/release/bundle/dmg/"
echo ""
echo "🚀 可以在 Finder 中打开构建目录查看结果"
