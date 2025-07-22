# RedLark 构建命令指南

## 🚀 快速构建命令

### 基础命令

```bash
# 开发模式
npm run tauri:dev

# 构建当前平台
npm run build:current
```

## 🎯 平台特定构建

### Windows 构建

```bash
# 构建 Windows 可执行文件
npm run build:win

# 构建 Windows 安装包 (MSI + NSIS)
npm run bundle:win
```

**产物位置**:
- 可执行文件: `src-tauri/target/x86_64-pc-windows-msvc/release/redlark-app.exe`
- MSI 安装包: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/`
- NSIS 安装包: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`

### macOS 构建

```bash
# 构建 Intel Mac
npm run build:mac

# 构建 Apple Silicon Mac
npm run build:mac-arm

# 构建通用版本 (Intel + Apple Silicon)
npm run build:mac-universal

# 构建 Mac 安装包 (APP + DMG)
npm run bundle:mac
```

**产物位置**:
- 应用程序: `src-tauri/target/universal-apple-darwin/release/bundle/macos/`
- DMG 安装包: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`

### Linux 构建

```bash
# 构建 Linux 可执行文件
npm run build:linux

# 构建 Linux 安装包 (DEB + AppImage)
npm run bundle:linux
```

**产物位置**:
- 可执行文件: `src-tauri/target/x86_64-unknown-linux-gnu/release/redlark-app`
- DEB 包: `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/`
- AppImage: `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/`

## 🌍 跨平台构建

### 构建所有平台

```bash
# 构建所有平台的可执行文件
npm run build:all

# 构建所有平台的安装包
npm run bundle:all
```

## 📋 构建前准备

### 通用要求

1. **Node.js** (版本 18+)
2. **Rust** (最新稳定版)
3. **Tauri CLI**:
   ```bash
   cargo install tauri-cli
   ```

### 平台特定要求

#### Windows
- **Visual Studio Build Tools** 或 **Visual Studio Community**
- **Windows SDK**

#### macOS
- **Xcode Command Line Tools**:
  ```bash
  xcode-select --install
  ```

#### Linux
- **构建工具**:
  ```bash
  # Ubuntu/Debian
  sudo apt update
  sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

  # Fedora
  sudo dnf install webkit2gtk3-devel openssl-devel curl wget libappindicator-gtk3-devel librsvg2-devel
  ```

## 🔧 高级构建选项

### 自定义构建

```bash
# 指定特定目标
tauri build --target <target-triple>

# 启用调试信息
tauri build --debug

# 指定配置文件
tauri build --config custom-config.json

# 指定特定的 bundle 格式
tauri build --bundles msi,nsis
```

### 支持的目标平台

- `x86_64-pc-windows-msvc` - Windows 64位
- `x86_64-apple-darwin` - Intel Mac
- `aarch64-apple-darwin` - Apple Silicon Mac
- `universal-apple-darwin` - 通用 Mac (Intel + Apple Silicon)
- `x86_64-unknown-linux-gnu` - Linux 64位

### 支持的 Bundle 格式

#### Windows
- `msi` - Windows Installer
- `nsis` - NSIS 安装程序
- `wix` - WiX 工具集安装程序

#### macOS
- `app` - macOS 应用程序包
- `dmg` - macOS 磁盘映像

#### Linux
- `deb` - Debian 包
- `rpm` - Red Hat 包
- `appimage` - AppImage 便携应用

## 🐛 故障排除

### 常见问题

1. **构建失败 - 缺少依赖**:
   ```bash
   # 清理并重新安装
   cargo clean
   rm -rf node_modules
   npm install
   ```

2. **跨平台构建失败**:
   ```bash
   # 添加目标平台
   rustup target add x86_64-pc-windows-msvc
   rustup target add x86_64-apple-darwin
   rustup target add aarch64-apple-darwin
   ```

3. **权限问题 (macOS)**:
   - 在系统偏好设置中允许应用运行
   - 配置代码签名证书

4. **网络问题**:
   - 配置代理或使用国内镜像
   - 检查防火墙设置

### 性能优化

```bash
# 启用 LTO 优化
RUSTFLAGS="-C lto=fat" npm run build:current

# 减小二进制大小
RUSTFLAGS="-C strip=symbols" npm run build:current
```

## 📦 发布流程

1. **更新版本号**: 修改 `package.json` 和 `src-tauri/Cargo.toml`
2. **构建所有平台**: `npm run bundle:all`
3. **测试安装包**: 在各平台测试安装和运行
4. **创建发布**: 上传到 GitHub Releases 或其他分发平台
