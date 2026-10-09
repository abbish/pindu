请为这个视频规划场景切分。视频总长 {{duration}}，共 {{count}} 条字幕。
{{#part}}
视频较长，分几部分规划，这次只规划{{part}}。只用这部分的字幕编号；其余部分另外规划。
{{/part}}
每段时长尽量在 {{min_seconds}}–{{max_seconds}} 秒之间。
{{#requirements}}
学习者的要求：{{requirements}}
{{/requirements}}
{{^requirements}}
学习者没有特别的要求：覆盖全片中适合学习的部分。
{{/requirements}}
{{#tags}}
已有的标签（先从这里选，意思相同或相近就用这里的名称，不要另起近义的）：{{tags}}
{{/tags}}
{{#current}}

当前的规划（第几条字幕到第几条）：
{{current}}

修改意见：{{feedback}}
{{/current}}

字幕（编号. [开始–结束] 英文 / 中文）：
{{cues}}
