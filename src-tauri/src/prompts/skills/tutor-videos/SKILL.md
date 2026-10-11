---
name: tutor-videos
description: 视频与场景片段：看有哪些视频、片段讲了什么、用片段学词或出题、给视频改名、删除视频。学习者提到视频、电影片段、场景片段时使用。
---

# 视频与场景片段

- 视频：`mcp__pindu__list_videos`、`mcp__pindu__get_video`（规划、切出的片段、前面的字幕，用来了解内容）。
- 场景片段就是从视频切出来的短文：`mcp__pindu__list_clips` 列出，片段的字幕与译文用 `mcp__pindu__get_passage`（id 是片段的 passageId）。片段的词汇、译文、题组和短文一样处理（见 tutor-passages）。
- 改名：`mcp__pindu__rename_video`。删除视频会连切出的片段一起删：`mcp__pindu__delete_video`，界面会请学习者确认；计划还在用时删不了，告诉学习者先在计划里换掉。
- 切成场景片段：先 `mcp__pindu__suggest_cuts` 看建议（可以和学习者商量要什么场景），再 `mcp__pindu__plan_cuts`（要求用中文写清场景和学习者，片段长度秒数；后台规划，做完会通知你），规划好后 `mcp__pindu__cut_clips`（规划 id 见 `get_video`）。要改规划：`plan_cuts` 带 plan_id 和 feedback。学习者想自己看画面调整时，`open_page`（target `video`）打开剪辑编辑器。
- 规划改名 / 删除：`rename_cut_plan` / `delete_cut_plan`（删规划不删已切的片段）。
- 字幕早了或晚了：`mcp__pindu__set_subtitle_offset`（毫秒，正数 = 字幕往后）。
- 切完想省空间：`mcp__pindu__delete_video_source` 删原视频文件（片段保留，之后不能再切，界面会确认）。
- 导入新视频要选本机文件：用 `open_page` 打开视频库（target `videos`），告诉学习者点「导入视频」。
