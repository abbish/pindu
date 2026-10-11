# 第三方组件

拼读（Pindu.app）的视频库随应用附带下列开源组件，作为独立程序 `ffmpeg` / `ffprobe` 调用（与主程序同目录）。

| 组件 | 版本 | 许可证 | 源码 |
|---|---|---|---|
| FFmpeg | 9.0.2 | LGPL-2.1-or-later（`ffmpeg-LGPL-2.1.txt`） | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz |
| dav1d | 1.5.4 | BSD-2-Clause（`dav1d-BSD-2-Clause.txt`） | https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz |
| OpenH264（仅 Linux 版） | 2.6.0 | BSD-2-Clause（`openh264-BSD-2-Clause.txt`） | https://github.com/cisco/openh264/archive/refs/tags/v2.6.0.tar.gz |

FFmpeg 按 LGPL 编译（未启用 GPL 与 nonfree 组件），源码未作修改。编译配置与步骤见
https://github.com/abbish/pindu/tree/main/scripts/ffmpeg （`build.sh`、`sources.json`）。
你可以用上述源码与脚本自行编译，并替换应用目录中的 `ffmpeg` / `ffprobe`。

## 词典数据

单词变形识别（went → go、children → child 等）使用 WordNet 的词表与不规则变形表，内置在应用中。

| 数据 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| WordNet | 3.0 | WordNet 3.0 License（`WordNet-3.0-LICENSE.txt`） | https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz |

WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved. 只取用了四个词性的单词表（index.*）与不规则变形表（*.exc），生成方式见 `scripts/lemma/build.mjs`。

## PDF 与图片读取

导入 PDF、图片等素材时，内置 AI 助手用下列组件读取 PDF 文字与渲染页面（编译进 AI 助手程序）。

| 组件 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| PDFium（WebAssembly 版） | 随 @hyzyla/pdfium 3.0.0 | BSD-3-Clause 与 Apache-2.0（`pdfium-LICENSE.txt`） | https://pdfium.googlesource.com/pdfium/ |
| @hyzyla/pdfium | 3.0.0 | MIT（`hyzyla-pdfium-MIT.txt`） | https://github.com/hyzyla/pdfium |
| fast-png | 8.0.0 | MIT（`fast-png-MIT.txt`） | https://github.com/image-js/fast-png |
