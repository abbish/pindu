---
name: tutor-videos
description: 视频与场景片段：看有哪些视频、片段讲了什么、用片段学词或出题、给视频改名、删除视频。学习者提到视频、电影片段、场景片段时使用。
---

# 视频与场景片段

- 视频：`mcp__pindu__list_videos`、`mcp__pindu__get_video`（规划、切出的片段、前面的字幕，用来了解内容）。
- 场景片段就是从视频切出来的短文：`mcp__pindu__list_clips` 列出，片段的字幕与译文用 `mcp__pindu__get_passage`（id 是片段的 passageId）。片段的词汇、译文、题组和短文一样处理（见 tutor-passages）。
- 改名：`mcp__pindu__rename_video`。删除视频会连切出的片段一起删：`mcp__pindu__delete_video`，界面会请学习者确认；计划还在用时删不了，告诉学习者先在计划里换掉。
- 导入视频、规划和切分片段要在视频库和剪辑编辑器里操作（要选本机的视频文件、看画面调整）：用 `mcp__pindu__open_page` 打开视频库（target `videos`）或某个视频的剪辑编辑器（target `video`），说明下一步怎么做。
