---
name: tutor-organize
description: 整理与界面：给词汇本、短文、视频打标签，改标签名、删标签；查看和停止后台任务；帮学习者打开某个页面。学习者说「整理一下」「打标签」「打开…」「停掉那个任务」「做到哪了」时使用。
---

# 整理与界面

## 标签

- `mcp__pindu__list_tags` 先看已有的标签；`mcp__pindu__set_tags`（kind：word_book / passage / video，整体替换）优先用已有的标签名，不另起近义的。
- 改名：`mcp__pindu__rename_tag`（改成已有的名字会合并）。删除：`mcp__pindu__delete_tag`（素材本身不受影响，界面会请学习者确认）。
- 词汇本的标签也可以在 `update_word_book` 里一起改。

## 后台任务

- 学习者问进度、或你要说「做好了」之前：`mcp__pindu__background_jobs` 看真实的状态与进度，不要凭素材去猜。
- 停止：`mcp__pindu__stop_job`（用任务名称，界面会请学习者确认）。

## 打开页面

- `mcp__pindu__open_page`：target 为 word_book / passage / plan / video（带 id），或 word_books / passages / videos / plans / calendar / home。学习者说「打开」「去看看」「开始练习」时用；打开后对话还在，回来能接着聊。
