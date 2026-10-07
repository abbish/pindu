# 自然拼读（RedLark）

跨平台桌面英语单词学习应用：AI 自然拼读分析与例句、AI 生成学习日程、三步练习法，数据全部保存在本机。

## 构建安装包

应用不做签名发布，请在自己的电脑上一键构建（macOS / Windows / Linux）：

```bash
./build.sh            # macOS / Linux
build.cmd             # Windows（也可双击）
npm run package       # 任意系统
```

需要先装好 Node.js 20+ 和 Rust，以及各系统的编译工具；`npm run package:check` 会检查并告诉你缺什么。
完整步骤、安装方法与常见问题见 [docs/BUILD.md](./docs/BUILD.md)。

## 开发

```bash
npm install
npm run agent:install   # AI 助手（agent sidecar）依赖，首次
npm run tauri:dev       # 开发模式
npm run verify          # 一键验证：静态检查 + 前后端测试
```

## 技术栈

- 前端：React 19 · TypeScript · Vite · shadcn/ui + Tailwind CSS v4
- 桌面壳：Tauri 2
- 后端：Rust · SQLite（sqlx）
- AI：内置 agent（OpenAI 兼容接口）· 火山引擎豆包语音合成

工程说明见 [CLAUDE.md](./CLAUDE.md)。

## 许可证

MIT License
