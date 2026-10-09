//! 素材处理的默认值（「设置 → 素材」）：单词本、短文、视频、学习计划里各种处理参数的默认值，
//! 各页面打开时以它为默认，当次仍可修改。整体存在 app_settings 的 `material.defaults`（JSON），缺的字段用默认值，越界的夹回范围。

use crate::error::AppResult;
use crate::repositories::settings_repository::SettingsRepository;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

const KEY: &str = "material.defaults";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MaterialSettings {
    // ---- 单词本 ----
    /// AI 生成单词的数量
    pub word_ai_count: i64,
    /// 从材料提取单词：focus 重点词 / all 全部
    pub word_extract_mode: String,
    // ---- 短文 ----
    /// AI 写短文的篇幅：short / standard / long
    pub passage_length: String,
    /// AI 挑词的数量
    pub passage_pick_count: i64,
    /// AI 挑词的难度：easy / medium / hard / any
    pub passage_pick_difficulty: String,
    /// AI 挑词的常用程度：common / advanced / any
    pub passage_pick_frequency: String,
    /// 导入材料时每篇大约多少词（拆篇）
    pub import_target_words: i64,
    /// 导入材料时让 AI 挑重点词
    pub import_key_words: bool,
    /// 阅读理解题难度：auto 按短文水平 / basic / standard / advanced
    pub question_difficulty: String,
    // ---- 视频 ----
    /// 导入时自动整理字幕（AI 断句、补中文）；关掉时等到 AI 规划或切分前再整理
    pub video_auto_prepare: bool,
    /// 切分每段时长（秒）：AI 规划与按字幕自动切分的默认值
    pub video_min_seconds: i64,
    pub video_max_seconds: i64,
    // ---- 学习计划 ----
    /// 每天新词数
    pub plan_daily_new_words: i64,
    /// 短文任务每几天一篇
    pub plan_passage_interval_days: i64,
    /// 用 AI 排学习顺序
    pub plan_ai_order: bool,
}

impl Default for MaterialSettings {
    fn default() -> Self {
        Self {
            word_ai_count: 20,
            word_extract_mode: "focus".into(),
            passage_length: "standard".into(),
            passage_pick_count: 10,
            passage_pick_difficulty: "medium".into(),
            passage_pick_frequency: "common".into(),
            import_target_words: 300,
            import_key_words: true,
            question_difficulty: "auto".into(),
            video_auto_prepare: true,
            video_min_seconds: 30,
            video_max_seconds: 120,
            plan_daily_new_words: 10,
            plan_passage_interval_days: 2,
            plan_ai_order: true,
        }
    }
}

fn pick(value: &str, allowed: &[&str], fallback: &str) -> String {
    if allowed.contains(&value) {
        value
    } else {
        fallback
    }
    .to_string()
}

impl MaterialSettings {
    /// 越界的夹回范围，不认识的取值回到默认
    pub fn normalized(self) -> Self {
        let d = Self::default();
        let video_min_seconds = self.video_min_seconds.clamp(5, 900);
        Self {
            word_ai_count: self.word_ai_count.clamp(5, 50),
            word_extract_mode: pick(
                &self.word_extract_mode,
                &["focus", "all"],
                &d.word_extract_mode,
            ),
            passage_length: pick(
                &self.passage_length,
                &["short", "standard", "long"],
                &d.passage_length,
            ),
            passage_pick_count: self.passage_pick_count.clamp(1, 20),
            passage_pick_difficulty: pick(
                &self.passage_pick_difficulty,
                &["easy", "medium", "hard", "any"],
                &d.passage_pick_difficulty,
            ),
            passage_pick_frequency: pick(
                &self.passage_pick_frequency,
                &["common", "advanced", "any"],
                &d.passage_pick_frequency,
            ),
            import_target_words: self.import_target_words.clamp(100, 1000),
            import_key_words: self.import_key_words,
            question_difficulty: pick(
                &self.question_difficulty,
                &["auto", "basic", "standard", "advanced"],
                &d.question_difficulty,
            ),
            video_auto_prepare: self.video_auto_prepare,
            video_min_seconds,
            video_max_seconds: self.video_max_seconds.clamp(5, 900).max(video_min_seconds),
            plan_daily_new_words: self.plan_daily_new_words.clamp(1, 100),
            plan_passage_interval_days: self.plan_passage_interval_days.clamp(1, 30),
            plan_ai_order: self.plan_ai_order,
        }
    }
}

pub async fn load(pool: &SqlitePool) -> AppResult<MaterialSettings> {
    Ok(SettingsRepository::get(pool, KEY)
        .await?
        .and_then(|raw| serde_json::from_str::<MaterialSettings>(&raw).ok())
        .unwrap_or_default()
        .normalized())
}

/// 整体保存（前端传完整的一份）
pub async fn save(pool: &SqlitePool, settings: MaterialSettings) -> AppResult<MaterialSettings> {
    let settings = settings.normalized();
    let mut tx = pool.begin().await?;
    SettingsRepository::set(
        &mut tx,
        KEY,
        Some(&serde_json::to_string(&settings).unwrap_or_default()),
    )
    .await?;
    tx.commit().await?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn defaults_save_and_normalize() {
        let pool = crate::test_support::memory_pool().await;
        assert_eq!(load(&pool).await.unwrap(), MaterialSettings::default());
        let saved = save(
            &pool,
            MaterialSettings {
                word_ai_count: 30,
                video_min_seconds: 200,
                video_max_seconds: 100,
                passage_length: "huge".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // 最多不小于最少；不认识的篇幅回到默认
        assert_eq!(
            (saved.video_min_seconds, saved.video_max_seconds),
            (200, 200)
        );
        assert_eq!(saved.passage_length, "standard");
        assert_eq!(load(&pool).await.unwrap().word_ai_count, 30);
        // 旧版本存的只有部分字段时，缺的用默认
        sqlx::query("UPDATE app_settings SET value = '{\"wordAiCount\":50}' WHERE key = 'material.defaults'")
            .execute(pool.as_ref())
            .await
            .unwrap();
        let partial = load(&pool).await.unwrap();
        assert_eq!(
            (partial.word_ai_count, partial.plan_daily_new_words),
            (50, 10)
        );
        crate::time::assert_instants_canonical(&pool).await;
    }
}
