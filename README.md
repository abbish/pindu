# RedLark 单词学习应用

基于 Tauri + React + TypeScript 构建的跨平台单词学习应用。

## 🚀 快速开始

### 开发环境

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri:dev
```

### 构建应用

```bash
# 构建当前平台
npm run build:current

# 构建 Windows
npm run build:win

# 构建 macOS (通用版本)
npm run build:mac-universal

# 构建 Linux
npm run build:linux

# 构建所有平台
npm run build:all
```

### 构建安装包

```bash
# Windows 安装包 (MSI + NSIS)
npm run bundle:win

# macOS 安装包 (APP + DMG)
npm run bundle:mac

# Linux 安装包 (DEB + AppImage)
npm run bundle:linux

# 所有平台安装包
npm run bundle:all
```

## 📚 文档

- [构建命令详细说明](./BUILD_COMMANDS.md)
- [Mac 构建指南](./BUILD_MAC.md)

## 🛠 技术栈

- **前端**: React 18 + TypeScript + Vite
- **后端**: Tauri (Rust)
- **数据库**: SQLite + SQLx
- **样式**: CSS Modules + CSS 变量
- **图标**: FontAwesome

## 💻 开发环境要求

- Node.js 18+
- Rust (最新稳定版)
- Tauri CLI: `cargo install tauri-cli`

### 平台特定要求

- **Windows**: Visual Studio Build Tools
- **macOS**: Xcode Command Line Tools
- **Linux**: WebKit2GTK 开发包

## 🏗 项目结构

```text
src/                    # 前端源码
├── components/         # React 组件
├── pages/             # 页面组件
├── services/          # 业务逻辑服务
├── types/             # TypeScript 类型定义
└── utils/             # 工具函数

src-tauri/             # 后端源码
├── src/               # Rust 源码
├── migrations/        # 数据库迁移
└── icons/             # 应用图标
```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
