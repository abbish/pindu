# plan

## 已核实事实（2026-10-06）
- OpenRouter `/api/v1/models` 实测：`moonshotai/kimi-k2:free`、`deepseek/deepseek-chat-v3-0324:free`、`deepseek/deepseek-r1-0528:free` 已下架；
  `google/gemini-2.5-pro` 仍在。可用：`google/gemini-3.8-flash`、`deepseek/deepseek-v4.1-flash`、`moonshotai/kimi-k3`、`qwen/qwen3.8-flash`、`bytedance-seed/seed-2-1-turbo`。
- `ai_models.max_tokens` 在代码里是**输出上限**（phonics.rs `min(65535)`），003 种子误填了上下文长度（2097152）。
- 豆包 TTS V3：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`；
  头 `X-Api-Key`（新控制台）或 `X-Api-App-Id`+`X-Api-Access-Key`（旧控制台）、`X-Api-Resource-Id`、`X-Api-Request-Id`；
  body `{user:{uid}, req_params:{text, speaker, audio_params:{format, sample_rate, speech_rate}}}`；
  响应 NDJSON：`code:0`+`data`(base64) 累加，`code:20000000` 结束，其它 code 为错误。
  音色与资源须匹配：`*_uranus_bigtts`/`saturn_*` → `seed-tts-2.0`；`*_mars_bigtts`/`*_moon_bigtts`/`ICL_*` → `seed-tts-1.0`；`S_*` → `seed-icl-2.0`（否则 55000000）。
  英文音色有证据的：`en_male_tim_uranus_bigtts`（美式）、`en_female_dacey_uranus_bigtts`（英式）；其余由用户在控制台确认后自定义填写。
  未知：火山方舟 `/models` 是否可用（同步按钮须对失败给出“请手动添加”提示）。

## 批次
- **B1 模型种子刷新**：`033_refresh_seed_ai_models.sql`（新增 5 个 OpenRouter 模型；仅当 model_id 仍为原始值时停用 3 个下架模型；修正种子 max_tokens；默认模型仅在当前默认为下架模型或未改动的 gemini-2.5-pro 种子时切到 gemini-3.8-flash）；
  `034_add_volcengine_ark_provider.sql`（`volcengine_ark`，`https://ark.cn-beijing.volces.com/api/v3`，占位 key，无种子模型）。
  测试：迁移到 032 → 模拟用户改动 → 跑 033/034，断言用户改动保留。
- **B2 同步模型列表**：命令 `list_provider_remote_models(provider_id)`（service 用 reqwest GET `{base_url}/models`，Bearer key，解析 `data[].id/name/context_length`；解析为纯函数 + fixture 测试）→ 前端提供商卡片“同步模型”弹窗，勾选后调用现有 `create_ai_model`。
- **B3 豆包 TTS 后端**：`035_create_tts_config.sql`（单行配置：api_key / app_id / access_key / resource_id(可空=自动) / default_voice_id / speech_rate / sample_rate / format）；
  service 改为豆包实现（NDJSON 解析、resource 推断为纯函数 + 测试）；命令 `get_tts_config`/`update_tts_config` 取代 ElevenLabs 两个命令（返回 `TtsConfigSafe`）；`get_tts_voices` 返回豆包预置音色；删除 `get_tts_providers`（若无其他消费方）。
- **B4 前端 TTS 设置页**：重写 `TTSSettings`（鉴权方式、音色预置+自定义、语速、试听、清缓存），删 ElevenLabs 类型/方法；更新 CLAUDE.md。

## 验证
每批 `npm run verify`；B1 额外：空库首跑 + 用户真实库**副本**迁移（行数不变、默认模型符合规则）；全部完成后隔离 HOME 实机走查；真实密钥试听由用户确认。

## 回退
迁移不可删：回退 = 新增反向迁移。代码回退按批次 git revert。
