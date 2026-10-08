# 安装「拼读」

到 [GitHub Releases](https://github.com/abbish/pindu/releases) 下载对应系统的安装包，装好就能用。以后有新版本时，应用里会提示，点一下就能更新。

装好之后，在应用里填上 AI 服务的 API Key 就能开始用（见[第 2 节](#2-首次使用配置-ai-与发音)）。

> 想参与开发、在自己电脑上编译打包？看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 1. 下载安装包

到 [Releases 页面](https://github.com/abbish/pindu/releases)，在最新版本下面选对应的文件：

| 系统 | 文件 | 安装方式 |
|---|---|---|
| macOS（Apple 芯片和 Intel 通用） | `Pindu_<版本>_universal.dmg` | 打开 dmg，把「拼读」拖进「应用程序」 |
| Windows | `Pindu_<版本>_x64-setup.exe` | 双击安装 |
| Linux | `Pindu_<版本>_amd64.AppImage` | `chmod +x` 后直接运行（支持应用内更新） |
| Debian / Ubuntu | `Pindu_<版本>_amd64.deb` | `sudo apt install ./Pindu_*.deb` |
| Fedora 等 | `Pindu_<版本>_x86_64.rpm` | `sudo dnf install ./Pindu_*.rpm` |

应用没有做苹果和微软的开发者签名，所以**第一次打开**时系统会拦一下：

- **macOS**：提示“无法验证开发者”时，到「系统设置 → 隐私与安全性」底部点「仍要打开」；或者在终端执行一次
  `xattr -dr com.apple.quarantine "/Applications/拼读.app"`。
- **Windows**：SmartScreen 提示时点「更多信息 → 仍要运行」。

放行一次以后就不会再问了。之后的版本通过应用内更新安装，也不会再拦。

## 2. 首次使用：配置 AI 与发音

应用本身不带任何账号或密钥。手动建单词本、按计划练习、日历与统计不需要联网；
拼读分析、例句、讲解、AI 写短文、导入材料翻译等功能需要你自己的大模型 API Key，单词和句子发音需要语音合成服务。

**AI 模型**（设置 → AI 模型）

1. 选一个提供商：内置了 OpenRouter、MiniMax、月之暗面（Kimi）、DeepSeek，也可以从目录里添加其它提供商，或填任意 OpenAI 兼容接口的地址。
2. 填入该提供商的 API Key，点「同步模型」读取可用模型并添加。
3. 把一个模型设为默认，点「测试」确认能连通。
4. 可选：在「设置 → AI 助手」给不同任务（拼读分析、讲解、短文等）指定不同模型，并按学习者（小学生 / 中学生 / 成人）调整讲解风格。

**语音合成**（设置 → 语音合成）

发音使用[火山引擎豆包语音合成](https://www.volcengine.com/product/tts)。在火山引擎控制台开通后，填入 API Key（或 AppID + Access Token），选一个英文音色并试听。
合成过的音频会缓存在本机，同一个词不会重复请求。

## 3. 升级

**应用内更新**：应用启动后和之后每天会检查一次 GitHub 上有没有新版本。有的话，窗口顶部会出现提示，点「立即更新」，下载完再点「立即重启」就好。想手动查，到「设置 → 通用 → 更新」点「检查更新」（macOS 菜单里也有「检查更新…」）。不想让它自动检查，在同一个地方把「自动检查更新」关掉。

更新包下载后会先用应用内置的公钥校验签名，校验不通过就不安装，所以不用担心被替换成别人的程序。用 deb / rpm 安装的 Linux 系统不支持应用内更新，提示出来后请到 Releases 下载新的安装包重新安装（覆盖安装即可，不用先卸载）。

**数据会怎样**：新版本第一次启动时会自动升级数据库，单词本和学习记录都会保留。升级之前，应用会先把整个数据库备份到数据目录下的 `backups/` 文件夹，并保留最近 5 份。万一升级出了问题，应用不会新建一个空库把数据「藏起来」，而是打开一个说明页，写清原因、数据目录和备份所在的位置。

还有两种情况，应用会拒绝打开数据，数据本身都还在：

- **数据来自更新的版本**：用新版本打开过这份数据，又装回了旧版本。安装最新版本就好。
- **数据库升级脚本和记录不一致**：用的不是官方发布的版本，而是改过已发布升级脚本的自编版本。换回 Releases 上的官方版本即可。

## 4. 数据位置、备份与卸载

单词本、学习记录、设置（含 API Key）都保存在本机，重新安装或升级不会丢失：

| 系统 | 目录 |
|---|---|
| macOS | `~/Library/Application Support/com.redlark.pindu-app/` |
| Windows | `%APPDATA%\com.redlark.pindu-app\` |
| Linux | `~/.local/share/com.redlark.pindu-app/` |

其中 `vocabulary.db` 是数据库，`backups/` 是升级前和「删除数据库」前的自动备份，`logs/` 是运行日志。想自己备份，就在退出应用后复制整个目录。
发音音频缓存在系统缓存目录（macOS `~/Library/Caches/com.redlark.pindu-app/`，Windows `%LOCALAPPDATA%\com.redlark.pindu-app\`，Linux `~/.cache/com.redlark.pindu-app/`），删掉只会让发音重新下载。

**用备份恢复数据**：先退出应用，把数据目录里的 `vocabulary.db`（以及同名的 `-wal`、`-shm` 文件，如果有）挪到别处，再把 `backups/` 里想要恢复的那份复制回来，改名为 `vocabulary.db`，然后重新打开应用。

**卸载**：按系统常规方式删除应用，数据目录会保留，以后再装还能接着用。Windows 卸载程序里有一个「删除应用数据」的选项，只有确定不要数据时才勾选。如果也不要数据了，再手动删除上面的数据目录。

## 5. 常见问题

**检查更新失败。** 应用要能访问 github.com。网络不通时更新会静默跳过，不影响正常使用；也可以直接到 Releases 页面下载新的安装包覆盖安装。

**AI 功能报错或一直没有结果。** 到「设置 → AI 模型」对默认模型点「测试」，确认 API Key 和余额；
遇到限流（429）可以在「设置 → AI 助手」调小批量分析的每批词数和并发数。更多细节在「设置 → 通用 → 诊断」的系统日志里。

**还是解决不了。** 到 [Issues](https://github.com/abbish/pindu/issues) 反馈，附上系统版本和系统日志（日志不会记录 API Key）。
