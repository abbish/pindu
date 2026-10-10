# 拼读（Pindu.app）

[English](./README.en.md) · [安装](./INSTALL.md) · [参与开发](./CONTRIBUTING.md) · [安全与隐私](./SECURITY.md)

拼读是一款以自然拼读法为核心的英语词汇学习桌面应用，支持 macOS、Windows 和 Linux。单词按拼读块拆分学习（如 luggage → lug · gage），并在短文与视频片段中复习巩固。

- **本地优先**：所有数据保存在本机 SQLite 数据库，无需注册账号。
- **自带密钥**：AI 功能使用用户配置的 OpenAI 兼容接口，语音使用火山引擎豆包语音合成。
- **AI 有校验**：模型输出经工具校验与程序核对后才写入，结构化结果不依赖模型自觉。

![首页](docs/screenshots/home.png)

## 功能

### 词汇本

- 收录单词与词组（短语动词、固定搭配、习语、固定短语），标注词组能否拆分使用。
- 添加方式：
  - 手动录入，可一键 AI 补全；
  - 根据词汇本的场景描述由 AI 生成，AI 会先给出可多选的词汇需求建议；
  - 从文本、字幕或文档（txt、md、srt、vtt、docx、pdf）中提取生词与词组。
- 每个词条自动补全音标、音节、拼读拆分、释义和由易到难的例句。
- 词汇本、短文与视频共用标签，侧边栏按标签汇总相关素材。

![词汇本](docs/screenshots/wordbook.png)

### 学习计划与练习

- 选择词汇本并设定每日新词数后，系统自动生成日程；计划可暂停，恢复后日程顺延。
- 新词采用三步练习：
  1. 完整信息；
  2. 隐藏英文，凭记忆拼写；
  3. 仅提供中文、音节与发音。
- 复习按记忆等级安排，间隔为 1、3、7、14、30 天。答对升级，答错回到第一级；到期的复习自动加入当日任务。

![单词练习](docs/screenshots/practice.png)

![计划详情](docs/screenshots/plan.png)

### AI 老师

- 每张单词卡都可以向 AI 老师提问：释义、拼写规律、同规律词、用法辨析、易混词与记忆方法，支持连续追问。
- 讲解深度按学习者档案（小学生、中学生、成人）调整。
- 短文与视频中的句子也可以单独提问。

![AI 老师](docs/screenshots/tutor.png)

### 短文

- 生成方式：
  - 基于词汇本或学习计划中的单词，由 AI 规划内容并逐篇生成，附逐句译文；
  - 根据主题描述生成。
- 导入英文材料时原文保持不变，仅补充译文、标题、难度与重点词。
- 阅读时：
  - 标出目标词，点击可查看单词卡；
  - 支持逐句朗读与盲听；
  - 原文中选中的单词或词组可直接加入目标词。
- 句子分析：句式、成分、语法点、交际功能、值得学习的词组与发音要点。
- 阅读理解：
  - 选词填空、选择题、判断题自动判分；
  - 开放题由 AI 评分并给出修改建议。
- 短文可以加入学习计划，按固定间隔安排。

![短文阅读](docs/screenshots/passage.png)

![句子分析](docs/screenshots/sentence.png)

### 视频库

- 导入视频与字幕后，AI 整理字幕断句与翻译，并按场景规划切分方案。
- 在剪辑编辑器中可以预览、调整入点与出点、校正字幕时间，确认后按方案精确切分。
- 每个片段提供三种学习方式：逐句台词学习、跟读录音、听句拼写；片段可以加入学习计划。
- 输入英文单词即可检索所有视频中出现过该词的片段。
- 视频处理所需的 ffmpeg 随应用分发，无需另行安装。

![视频片段](docs/screenshots/clips.png)

![剪辑编辑器](docs/screenshots/editor.png)

### 语音朗读

- 内置 15 个英文音色，单词与句子固定按英语朗读，数字和日期也按英语读出。
- 句子朗读风格可选：老师示范、自然口语、讲故事、新闻播报或自定义；语速、音调和音量均可调节。
- 合成结果缓存在本机，相同内容不重复请求。

## 安装

从 [Releases](https://github.com/abbish/pindu/releases) 下载对应系统的安装包：

| 系统 | 安装包 |
|---|---|
| macOS | `.dmg` |
| Windows | `-setup.exe` |
| Linux | AppImage、deb 或 rpm |

安装包未经 Apple 或 Microsoft 开发者签名，首次打开时需要在系统中放行，步骤见 [INSTALL.md](./INSTALL.md#1-下载安装包)。新版本通过应用内更新安装，更新包在安装前会校验签名。

安装后在「设置」中配置以下服务：

- **AI 模型**：支持任意 OpenAI 兼容接口，内置 OpenRouter、MiniMax、月之暗面和 DeepSeek。
- **语音合成**：火山引擎豆包语音合成。

未配置时，手动管理词汇本、练习和统计功能仍可使用。

## 隐私

- 应用没有服务器，不收集使用数据。
- 只有两种情况会联网：
  - 使用 AI 或语音功能时，相关内容直接发送给用户配置的服务商；
  - 检查更新时访问 GitHub，可以在设置中关闭。
- API Key 以明文保存在本机数据库中，不写入日志。

详见 [SECURITY.md](./SECURITY.md)。

## 开发

```bash
npm install
npm run agent:install   # 首次：安装内置 AI 助手的依赖
npm run tauri:dev       # 开发模式
npm run verify          # 提交前检查：静态检查与前后端测试
```

技术栈：

| 部分 | 技术 |
|---|---|
| 界面 | React 19、shadcn/ui、Tailwind CSS v4 |
| 桌面框架 | Tauri 2 |
| 后端 | Rust、SQLite |
| AI | 内置 agent 进程（基于 [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)，由 Bun 编译为单个可执行文件） |

相关文档：

- 架构、数据表、AI 任务与开发规范：[CLAUDE.md](./CLAUDE.md)
- AI 助手设计：[docs/agent-harness/](./docs/agent-harness/DESIGN.md)
- 贡献流程：[CONTRIBUTING.md](./CONTRIBUTING.md)

## 许可证

[MIT](./LICENSE) © 2023-2026 abbish and RedLark contributors

第三方组件的许可证见 [src-tauri/licenses/](./src-tauri/licenses/THIRD_PARTY_NOTICES.md)。

<sub>截图使用演示数据。视频截图来自 *Tears of Steel*（© Blender Foundation，[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，[mango.blender.org](https://mango.blender.org)）。</sub>
