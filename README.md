# 自然拼读（RedLark）

[English](./README.en.md) · [安装](./INSTALL.md) · [参与开发](./CONTRIBUTING.md) · [安全与隐私](./SECURITY.md)

一款开源的桌面英语单词学习应用，面向孩子和自学的成人：用 AI 做自然拼读拆解、讲解和例句，用记忆曲线安排复习，再用 AI 写的短文和你自己的阅读材料把单词放回语境里练阅读与听力。

支持 macOS、Windows、Linux。学习数据保存在本机的 SQLite 数据库里，不需要注册账号；AI 和发音用你自己的 API Key。

## 功能

**单词本**

- 三种建本方式：手动录入；用一句话描述想学什么，让 AI 生成；从自己的材料（txt / md / srt / vtt / docx / pdf，或直接粘贴）里提取生词。
- AI 自然拼读分析：音标、音节切分、拼读规则、释义和由浅到深的例句，可以补充或重新生成。
- 单词讲解与 AI 老师：每个词一份讲解（含记忆方法），不懂的地方可以继续追问。

**学习计划与练习**

- 选好单词本和每天新词数，自动排出日程；复习按记忆等级（1 / 3 / 7 / 14 / 30 天）每天动态安排，答错的词会更早再出现。
- 三步练习法：看完整信息 → 隐藏英文 → 只给中文、音节和发音来拼写。
- 计划可以暂停、继续（日程自动顺延）、追加单词本、随时调整每天新词数。
- 首页学习热力图、日历视图、计划统计与练习记录。

**短文**

- AI 写短文：从单词本或计划里挑目标词，AI 先规划内容（一篇或拆成几篇），再写成适合水平的短文，附逐句翻译。
- 导入自己的材料：课文、字幕、文章等原文不改，AI 只做逐句翻译、起标题、估难度、标出重点词；材料里的生词可以一键整理成新单词本。
- 阅读理解题：完形填空、选择、判断、开放题，客观题自动判分，开放题由 AI 评分并给出改进示例。
- 阅读或听力两种练法，逐句朗读，「聚焦朗读」模式只突出当前句。
- 短文可以加入学习计划，按间隔天数排进每日任务。

**个性化**

- 学习者档案：小学生 / 中学生 / 成人预设，可调英语水平、讲解语言、音标体系、讲解详略和答疑风格。
- 不同任务可以用不同模型；浅色 / 深色 / 跟随系统主题。

## 安装

应用没有做开发者签名，所以不提供现成的安装包，请在自己的电脑上一条命令构建：

```bash
git clone https://github.com/abbish/redlark.git
cd redlark
./build.sh            # macOS / Linux
build.cmd             # Windows（也可双击）
```

需要先装好 Node.js 20+、Rust 和各系统的编译工具，`npm run package:check` 会检查并告诉你缺什么。
安装包生成在 `release/` 目录。完整步骤、首次配置 AI 与发音、升级和常见问题见 **[INSTALL.md](./INSTALL.md)**。

## 需要准备的服务

| 用途 | 服务 | 必需吗 |
|---|---|---|
| 拼读分析、例句、讲解、写短文、翻译、出题评分 | 任意 OpenAI 兼容的大模型接口（内置 OpenRouter、MiniMax、月之暗面、DeepSeek 等预设） | AI 功能需要 |
| 单词和句子发音 | [火山引擎豆包语音合成](https://www.volcengine.com/product/tts) | 发音需要 |

不配置也能手动建单词本、建计划、练习和查看统计。

## 隐私

- 单词本、学习记录、设置都保存在本机的应用数据目录（位置见 [INSTALL.md](./INSTALL.md#7-升级与卸载)），没有服务器，也不收集任何使用数据。
- 用到 AI 或发音时，相关内容（单词、句子、你导入的材料、作答文字）会直接发给**你配置的**服务商，按对方的隐私政策处理。
- API Key 以明文保存在本机数据库里，不会出现在日志中。详见 [SECURITY.md](./SECURITY.md)。

## 开发

```bash
npm install
npm run agent:install   # 内置 AI 助手（agent sidecar）的依赖，首次需要
npm run tauri:dev       # 开发模式：前端热更新 + Rust 自动重编译
npm run verify          # 提交前的一键验证：静态检查 + 前后端测试
```

技术栈：

| 层 | 技术 |
|---|---|
| 界面 | React 19 · TypeScript · Vite · shadcn/ui · Tailwind CSS v4 |
| 桌面壳 | Tauri 2 |
| 后端 | Rust · tokio · SQLite（sqlx，启动时自动迁移） |
| AI | 内置 agent（[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) RPC sidecar，Bun 编译成单文件），模型输出经工具校验后交给 Rust 再校正 |
| 发音 | 火山引擎豆包语音合成，音频本地缓存 |

目录结构、分层约定、数据库与 AI 任务的说明见 [CLAUDE.md](./CLAUDE.md)（同时也是 AI 编码助手的工程说明）；
内置 agent 的设计见 [docs/agent-harness/](./docs/agent-harness/DESIGN.md)。参与开发前请读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 参与

- 发现问题或有想法：到 [Issues](https://github.com/abbish/redlark/issues) 提出。
- 想改代码：先看 [CONTRIBUTING.md](./CONTRIBUTING.md)，较大的改动建议先开 issue 讨论。
- 安全问题请不要公开提 issue，按 [SECURITY.md](./SECURITY.md) 私下报告。

## 许可证

[MIT](./LICENSE) © 2023-2026 abbish and RedLark contributors
