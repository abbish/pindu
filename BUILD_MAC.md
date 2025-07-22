# RedLark Mac 构建指南

## 🍎 Mac 平台构建说明

### 前置要求

1. **macOS 版本**: macOS 10.13 或更高版本
2. **Xcode Command Line Tools**: 
   ```bash
   xcode-select --install
   ```
3. **Node.js**: 版本 18 或更高
   ```bash
   # 使用 Homebrew 安装
   brew install node
   ```
4. **Rust**: 
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```
5. **Tauri CLI**:
   ```bash
   cargo install tauri-cli
   ```

### 快速构建

使用提供的构建脚本：

```bash
# 设置执行权限
chmod +x build-mac.sh

# 运行构建
./build-mac.sh
```

### 手动构建步骤

1. **克隆并进入项目目录**:
   ```bash
   git clone https://github.com/abbish/redlark.git
   cd redlark-app
   ```

2. **安装依赖**:
   ```bash
   npm install
   ```

3. **构建应用**:
   ```bash
   npm run tauri:build
   ```

### 构建产物

构建完成后，您将在以下位置找到构建产物：

- **应用程序包**: `src-tauri/target/release/bundle/macos/RedLark 单词学习.app`
- **DMG 安装包**: `src-tauri/target/release/bundle/dmg/RedLark 单词学习_0.1.0_x64.dmg`

### 开发模式

如果需要在开发模式下运行：

```bash
npm run tauri:dev
```

### 常见问题

#### 1. 权限问题
如果遇到权限问题，可能需要在系统偏好设置中允许应用运行：
- 系统偏好设置 → 安全性与隐私 → 通用 → 允许从以下位置下载的应用

#### 2. 代码签名
如果需要分发应用，建议配置代码签名：
```json
// 在 tauri.conf.json 中配置
"macOS": {
  "signingIdentity": "Developer ID Application: Your Name",
  "providerShortName": "YourTeamID"
}
```

#### 3. 公证
对于 App Store 外分发，可能需要公证：
```bash
# 构建后公证
xcrun notarytool submit "path/to/app.dmg" --keychain-profile "notarytool-profile" --wait
```

### 构建配置

当前配置支持：
- **最低系统版本**: macOS 10.13
- **架构**: x64 (Intel) 和 arm64 (Apple Silicon) 通用构建
- **打包格式**: .app 和 .dmg

### 故障排除

如果构建失败，请检查：

1. **Rust 工具链**:
   ```bash
   rustup update
   ```

2. **清理缓存**:
   ```bash
   cargo clean
   rm -rf node_modules
   npm install
   ```

3. **检查日志**:
   构建过程中的详细日志会显示具体的错误信息。

### 性能优化

为了获得最佳性能，建议：
- 使用 `--release` 模式构建
- 启用 LTO (Link Time Optimization)
- 配置适当的 Rust 编译器优化选项
