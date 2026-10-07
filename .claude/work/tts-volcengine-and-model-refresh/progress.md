# progress

状态：B1–B4 已实现并通过 verify；等待用户用真实密钥验收
已完成：
- B1 迁移 033（刷新种子模型）/ 034（火山方舟提供商）+ 4 个迁移测试
- B2 命令 `list_provider_remote_models` + 设置页「同步模型」弹窗（SyncModelsModal）
- B3 迁移 035 `volcengine_tts_config`；TTS 服务改为豆包 V3（NDJSON 解析、资源 ID 推断、两种鉴权）；命令 get/update_tts_config 取代 ElevenLabs 两个命令，删除 get_tts_providers
- B4 设置页 TTS tab 重写（TTSSettings 737→307 行 + TtsConfigModal）；CLAUDE.md / 迁移规范 / 诊断地图同步
最近证据：evidence.md（verify 全过、67 个 Rust 测试、实机走查部分完成）
下一步：
1. 用户在设置页填豆包 API Key → 试听；练习页点发音
2. 用户在 OpenRouter「同步模型」勾选添加一个模型并「测试」
3. 若控制台有更合适的英文音色，回填到 `volcengine_voices()` 预置列表
阻塞：无（Key 已开通 seed-tts-2.0，接口实测可用；待用户在应用内试听确认）
