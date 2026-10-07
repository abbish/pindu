# evidence

## 自动化（2026-10-06）
- `bash scripts/verify.sh --work tts-volcengine-and-model-refresh`：check-sql 首次失败（测试 SQL 中 URL 的 `//` 被脚本当注释）→ 改为绑定参数后 0 失败；其余 10 项 PASS。
- Rust 测试 67 个通过，新增：
  - 迁移 033：`database::seed_migration_tests`（新装、用户自选默认保留、下架默认迁移、可重复执行）
  - 同步模型：`parses_openai_compatible_model_list`、`parses_bare_array_and_rejects_garbage`、未知提供商 NotFound
  - 豆包 TTS：配置脱敏（两种鉴权）、非法更新拒绝（含请求头注入式音色 ID）、预置/自定义音色、资源 ID 推断、NDJSON/SSE 拼接、错误 code+message+提示（含实测 401 响应体 `{"header":{"code":45000010,...}}`）
- 迁移在“已有库”上的验证：本机**没有**用户真实库（`~/Library/Application Support/com.redlark.pindu-app` 不存在），改用隔离 e2e 库副本（已跑到 032、含测试改动）启动应用迁移到 034：
  words 12 / plans 1 / schedules 3 / practice_sessions 2 行数不变；3 个下架模型停用；默认 → gemini-3.8-flash；gemini-2.5-pro / kimi-k2-preview max_tokens → 16000；新增火山方舟。
- 外部接口实测（无密钥探测）：豆包 `/api/v3/tts/unidirectional` 无效 Key → HTTP 401 `{"header":{"reqid","code":45000010,"message":"Invalid X-Api-Key"}}`（据此修正解析）；
  OpenRouter `/models` 无 Key 返回 464 个模型；Moonshot `/models` 无 Key → 401，界面显示可读错误与“可手动添加”提示。

## 实机（隔离 HOME，debug 构建）
- 迁移到 035；设置页显示火山方舟提供商、各提供商「同步模型」按钮、默认模型 Gemini 3.8 Flash（16000 / 0.01）。
- 同步模型：OpenRouter 列表加载成功（日志 Returned 464）；Moonshot 无 Key 失败提示可读。
- TTS 设置页：未配置状态、编辑弹窗（鉴权二选一、预置音色、自定义 ID、语速、资源 ID）渲染正常；未配置时 text_to_speech 返回校验错误。
- 走查途中检测到有人同时在操作应用窗口（出现非 agent 打开的弹窗），agent 停止 UI 操作，未完成：勾选并添加同步模型、保存 TTS 配置的点击流程。
- 日志中未出现密钥明文（grep 0 条）。

## 未验证 / 残留风险
- 真实豆包密钥下的发音（需用户填 Key 试听）；英文音色仅 tim（美式）/ dacey（英式）有公开资料，其余音色 ID 需在控制台确认后自定义填写。
- 火山方舟 `/models` 是否可用未知（失败时界面提示手动添加）。
- 真实用户库迁移：本机无真实库，用 e2e 库副本代替。

## 用户真实 Key 验收（2026-10-06）
- 用户报 403 `45000030 [resource_id=volc.seedtts.default] requested resource not granted`。
- 用同一 Key 探测（文本 "hi"，不输出 Key）：seed-tts-2.0 / seed-tts-1.0 / seed-tts-1.0-concurr / volc.service_type.10029 / seed-icl-2.0 全部 403 45000030；
  `/api/v3/tts/create` + `seed-audio-1.0` → 200，JSON `{audio(base64), duration, original_duration, url}`，"elephant" 约 1.9s。
- 结论：Key 有效，但只开通了 seed-audio（音频生成），未开通语音合成大模型；代码无需改。用户决定在控制台开通语音合成 2.0。
- 顺带修正：HTTP 403 提示由“鉴权失败”改为“密钥有效但未开通该资源”（401 仍为鉴权失败）。
- 用户开通语音合成 2.0 后复测：首次 tim 403 / dacey 200（权限生效有延迟），约 1 分钟后 tim、dacey、zh_female_vv、zh_male_m191（seed-tts-2.0）全部 200，NDJSON 以 `code 20000000 OK` 结束；单词合成耗时约 1.4s。

## 练习页自动朗读节奏（2026-10-06，用户反馈：首次等待生成后，第 1、2 遍间隔过短）
- 根因：`clearAutoPlay` 只清定时器、不终止进行中的 `playSequence`；初始化期间 effect 多次触发 → 多条序列并发，各自请求并播放，第 1/2 遍挤在一起；被替换的音频 Promise 永不结束；每遍都重新走 IPC 取音频。
- 修复：`utils/repeatPlayback.ts`（纯函数调度 + AbortSignal，4 个 node 测试，虚拟时钟断言“间隔从上一遍结束算起”）；`useAudioPlayer` 支持 signal、页面内音频缓存与并发去重、被打断以 false 结束、`prefetch`、返回值 useMemo；
  练习页：进入即预取、0.6s 后开始、3 遍、每遍后停顿 1.5s，读完预取下一个单词；手动点喇叭结束本轮；“自动进入下一步”定时器与朗读分开管理。
- verify 11/11 PASS；前端 17 个测试。实机节奏待用户在练习页确认（已通过 vite HMR 推送到运行中的应用）。

## 种子提供商收敛为四个（2026-10-06，用户要求：OpenRouter / MiniMax / Moonshot / DeepSeek）
- 无密钥探测：四家 `/models` 均返回 401（需 Key），MiniMax 不存在的路径返回 404 → `/v1/models` 端点存在；OpenRouter 无 Key 返回 200。
- 迁移 036：新增 deepseek（https://api.deepseek.com）、minimax（https://api.minimaxi.com/v1）；034 的火山方舟仅在占位 Key 且无模型时删除。测试覆盖：新装恰好四个、未配置的方舟被删、填过 Key 或有模型的方舟保留、可重复执行。
- e2e 库副本迁移 035→036：提供商变为四个，words 12 行不变。
- 同步模型：解析兼容 `{"models":[...]}` 与 `model` 字段；401/403/404 分别给出“先填 Key / Key 无效 / 地址不支持”的提示。
- check-sql 支持 raw_sql 多语句（按分号拆分逐条 EXPLAIN）。verify 11/11 PASS，Rust 测试 68 个。
- 未验证：MiniMax / DeepSeek / Moonshot 带真实 Key 时 `/models` 的实际返回（需用户填 Key 后点「同步模型」）。

## 模型生成参数（2026-10-06，用户反馈：Kimi K3 设温度 1 仍报 only 1 is allowed）
- 根因：提词（extraction.rs）与批量拼读（phonics.rs 批量）写死 temperature 0.1 / max_tokens 2000、8000，忽略模型配置；其余三处各自取默认值（0.7 / 0.1 / 0.3）。
- 修复：`AIService` 从模型配置携带 max_tokens / temperature，`apply_generation_params` 为 5 个调用点唯一出口；未填写 = 不发送；max_tokens 截到 65535（async-openai 0.20 为 u16）。
  模型配置可清空温度/输出上限（`clear_temperature` / `clear_max_tokens`），范围校验 1–65535、0–2；同步添加的模型不再预设温度；迁移 037 把 033 种子 kimi-k3 的 0.01 改为 1。
- 测试：生成参数 3 个单测（K3 温度 1 原样发送、未填不发送且 JSON 无 temperature 字段、上限截断）+ 服务层清空/范围校验 + 迁移 037 断言；Rust 72 个，verify 11/11。
- 用户库中 K3：moonshot 官方、temperature 1.0、max 32000、默认模型——重启后提词将发送 temperature = 1。
