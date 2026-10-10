# 宣传视频制作与审片工具

现有截图动画制作方式已归入仓库。剧本管理见 [README](README.md)，三个工作流入口见 [Skills 索引](../../.claude/skills/README.md#product-communication)。

## 配置与职责

- 每支视频的 `script.md` 保存内容决定；`subtitles.srt` 保存字幕；`render.json` 是供工具消费的文案、时间轴、素材与检查配置；`render.py` 保存该视频的布局和动画。
- 剧本是内容依据。改剧本后同步字幕、配置和必要的布局，核对后更新 `render.json` 的 `script_sha256`。摘要只防止漏同步，不能证明文案在语义上相同。
- `scripts/video/render.py` 负责调用该视频的布局、生成预览、配乐、编码和封面；`render_support.py` 负责截图卡片、文字与原创配乐。
- `scripts/video/review.py` 检查实际 MP4，并生成实际抽帧、联系表和技术检查记录。视觉和声音检查需单独记录。
- 当前[拼读配置](pindu-product-45s/render.json)和[布局](pindu-product-45s/render.py)对应剧本 1.0 的八段镜头、1920 × 1080 横版。其他画幅或镜头结构需要调整其布局；通用工具不会把它硬套给另一支视频。

## 环境

需要 Python 3.10+、Pillow、NumPy，以及支持 `libx264` 的 FFmpeg。依赖可在独立 Python 环境安装：

```bash
python3 -m pip install -r scripts/video/requirements.txt
```

FFmpeg / ffprobe 优先使用 `PROMO_FFMPEG` / `PROMO_FFPROBE` 指定的可执行文件，其次查找 PATH。没有 PATH 中的 FFmpeg 时可使用 `imageio-ffmpeg` 自带版本；ffprobe 可使用本仓库已准备的对应平台二进制。

应用随附的最小 FFmpeg 不含 `libx264`，可用于部分媒体工作，但本制作工具需要完整编码器。工具发现编码器缺失时会明确停止，不会自动下载或重建应用依赖。

中文字体自动查找本机 PingFang、Noto Sans CJK 或微软雅黑；找不到时设置 `PROMO_FONT_REGULAR`。可另设 `PROMO_FONT_BOLD`、`PROMO_FONT_LATIN`，字体集合可用对应 `*_INDEX` 与 `PROMO_FONT_LATIN_BOLD_INDEX` 指定索引。不同字体可能改变排版，需要查看预览；工具不会下载字体。

以下命令在仓库根目录运行。若使用 Codex 捆绑运行时，将 `python3` 替换为当前运行时工具返回的 Python 路径，避免将某台机器的路径写入配置。

## 预览与导出

先生成关键镜头预览。输出目录必须是新批次，防止覆盖已有产物：

```bash
python3 scripts/video/render.py \
  --config docs/videos/pindu-product-45s/render.json \
  --output docs/videos/pindu-product-45s/exports/layout-preview \
  --preview
```

预览只有源渲染帧和故事板，不表示视频已编码。检查布局后生成成片：

```bash
python3 scripts/video/render.py \
  --config docs/videos/pindu-product-45s/render.json \
  --output docs/videos/pindu-product-45s/exports/new-export
```

生成视频、从实际成片指定帧提取的 `cover.png` / `cover.jpg`、配乐、字幕与剧本快照、配置、素材与工具摘要、编码日志和源预览。`manifest.json` 将视觉检查初始标记为 pending。

输出路径按[归档约定](README.md#保存方式)放在 `exports/`，不纳入 Git。工具不自动更改剧本的“当前成片”，完成审片后再登记采用的批次。

## 实际成片检查

```bash
python3 scripts/video/review.py \
  --config docs/videos/pindu-product-45s/render.json \
  --video docs/videos/pindu-product-45s/exports/new-export/pindu-product.mp4 \
  --cover docs/videos/pindu-product-45s/exports/new-export/cover.png \
  --output docs/videos/pindu-product-45s/exports/new-export/review
```

检查时长、尺寸、帧率、帧数（容器提供时）、配置指定的编码与颜色信息、音频流、全片解码和封面匹配；片尾要求静止时，以 320 × 180 灰度逐帧核对指定停留区间。失败时保存检查记录并返回非零退出码。它不能判断链接文字正确、按钮标注准确、画面可读或音乐好听。

抽帧时间来自当前配置的 `review.sample_times`。有转场或细节变更时先调整时间点，查看实际帧和完整尺寸风险画面。纯局部修改只增加受影响位置的证据。

历史成片没有新工具的导出清单时，报告明确标记为 legacy，不倒填制作来源。新批次同时核对配置快照完整性及制作参数。只调整抽帧列表或封面时间点不要求重新编码；报告保留原剧本版本、当前版本和内容摘要是否相同，语义变化仍需人工对账。

只更换为现有成片中的某帧封面时，可直接用 FFmpeg 提取，再将新封面传给审片工具；无需重新渲染整片。

## 人工审片记录

在导出批次保存简短 `review.md`，按实际检查范围可删减：

- 成片文件、剧本版本与制作批次。
- 查看过的时间点及完整尺寸画面，发现与修正。
- 功能描述与 AI 归因、标注定位、文字可读性、首帧/片尾、链接与署名核对结果。
- 实际播放声音的结果；没有播放则写未验证。
- 技术检查记录入口及未解决问题。

检查规则的唯一来源为[公共质量标准](../../.claude/skills/promo-video-review/references/quality-standard.md)。自动检查通过后仍需据实记录人工审片状态。
