{{#scene}}
{{scene}}

{{/scene}}
必用词（{{required_count}} 个，每个都要用上）：{{required}}
{{#pool}}
候选词（最多挑 {{ai_pick}} 个能让故事更好的词）：{{pool}}
{{pick_prefs}}
{{/pool}}
{{#free_words}}
没有给定单词：请按上面的写作要求，为每篇选 6–10 个值得学的目标词（英文原形，贴合主题和学习者水平，不选太基础的功能词），放进各篇的 words；全部加起来最多 {{free_words}} 个，ai_pick 填 {{free_words}}，required_words 为空数组。
{{/free_words}}
篇幅偏好：{{length}}（short 约 {{short}} 词 / standard 约 {{standard}} 词 / long 约 {{long}} 词，每篇可以不同）
{{#feedback}}

用户对上一版规划的调整意见：{{feedback}}
{{/feedback}}
