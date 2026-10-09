//! 素材关联命令：标签（单词本 / 短文（含视频切片）/ 原始视频共用，迁移 060）与单词 ↔ 素材

use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::services::tag::TagService;
use crate::services::word_materials::WordMaterialsService;
use crate::types::material::{MaterialKind, Tag, TagUsage, WordMaterial, WordMaterialCount};
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

fn service(app: &AppHandle) -> TagService {
    TagService::new(Arc::new(app.state::<SqlitePool>().inner().clone()))
}

/// 全部标签与各类素材的数量
#[tauri::command]
pub async fn get_tags(app: AppHandle) -> AppResult<Vec<TagUsage>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_tags", None);
    let result = service(&app).get_tags().await;
    super::finish(&logger, "get_tags", result)
}

/// 新建标签（名称 1–10 个字，同名已存在时返回已有的）
#[tauri::command]
pub async fn create_tag(app: AppHandle, name: String, icon: Option<String>) -> AppResult<Tag> {
    let logger = app.state::<Logger>();
    logger.api_request("create_tag", Some(&format!("name: {name}")));
    let result = service(&app).create_tag(&name, icon.as_deref()).await;
    super::finish(&logger, "create_tag", result)
}

/// 标签改名；与另一个标签同名时合并进那个标签
#[tauri::command]
pub async fn rename_tag(app: AppHandle, tag_id: i64, name: String) -> AppResult<Tag> {
    let logger = app.state::<Logger>();
    logger.api_request("rename_tag", Some(&format!("tag {tag_id} → {name}")));
    let result = service(&app).rename_tag(tag_id, &name).await;
    super::finish(&logger, "rename_tag", result)
}

/// 删除标签（素材不受影响）
#[tauri::command]
pub async fn delete_tag(app: AppHandle, tag_id: i64) -> AppResult<()> {
    let logger = app.state::<Logger>();
    logger.api_request("delete_tag", Some(&format!("tag {tag_id}")));
    let result = service(&app).delete_tag(tag_id).await;
    super::finish(&logger, "delete_tag", result)
}

/// 批量给多个素材加 / 去标签；返回改了几个
#[tauri::command]
pub async fn update_material_tags(
    app: AppHandle,
    kind: String,
    ref_ids: Vec<i64>,
    add_tag_ids: Vec<i64>,
    remove_tag_ids: Vec<i64>,
) -> AppResult<usize> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "update_material_tags",
        Some(&format!(
            "{kind} ×{}: +{add_tag_ids:?} -{remove_tag_ids:?}",
            ref_ids.len()
        )),
    );
    let result = async {
        let kind = MaterialKind::parse(&kind)
            .ok_or_else(|| AppError::ValidationError(format!("未知的素材种类：{kind}")))?;
        service(&app)
            .update_material_tags(kind, &ref_ids, &add_tag_ids, &remove_tag_ids)
            .await
    }
    .await;
    super::finish(&logger, "update_material_tags", result)
}

/// 整体设置一个素材的标签；kind = word_book / passage / video
#[tauri::command]
pub async fn set_material_tags(
    app: AppHandle,
    kind: String,
    ref_id: i64,
    tag_ids: Vec<i64>,
) -> AppResult<Vec<Tag>> {
    let logger = app.state::<Logger>();
    logger.api_request(
        "set_material_tags",
        Some(&format!("{kind} {ref_id}: {tag_ids:?}")),
    );
    let result = async {
        let kind = MaterialKind::parse(&kind)
            .ok_or_else(|| AppError::ValidationError(format!("未知的素材种类：{kind}")))?;
        service(&app)
            .set_material_tags(kind, ref_id, &tag_ids)
            .await
    }
    .await;
    super::finish(&logger, "set_material_tags", result)
}

/// 素材处理的默认值（「设置 → 素材」）
#[tauri::command]
pub async fn get_material_settings(
    app: AppHandle,
) -> AppResult<crate::services::material_settings::MaterialSettings> {
    let logger = app.state::<Logger>();
    logger.api_request("get_material_settings", None);
    let result = crate::services::material_settings::load(app.state::<SqlitePool>().inner()).await;
    super::finish(&logger, "get_material_settings", result)
}

#[tauri::command]
pub async fn save_material_settings(
    app: AppHandle,
    settings: crate::services::material_settings::MaterialSettings,
) -> AppResult<crate::services::material_settings::MaterialSettings> {
    let logger = app.state::<Logger>();
    logger.api_request("save_material_settings", Some(&format!("{settings:?}")));
    let result =
        crate::services::material_settings::save(app.state::<SqlitePool>().inner(), settings).await;
    super::finish(&logger, "save_material_settings", result)
}

/// 一个词出现在哪些短文 / 视频切片里（重点词在前）
#[tauri::command]
pub async fn get_word_materials(
    app: AppHandle,
    word: String,
    word_id: Option<i64>,
) -> AppResult<Vec<WordMaterial>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_word_materials", Some(&format!("word: {word}")));
    let pool = Arc::new(app.state::<SqlitePool>().inner().clone());
    let data = crate::app_paths::dirs(&app).data;
    let url = super::video::url_of(&app);
    let result = WordMaterialsService::new(pool)
        .materials(&word, word_id, &data, &url)
        .await;
    super::finish(&logger, "get_word_materials", result)
}

/// 单词本里每个词出现过的短文数与切片数
#[tauri::command]
pub async fn get_book_word_materials(
    app: AppHandle,
    book_id: i64,
) -> AppResult<Vec<WordMaterialCount>> {
    let logger = app.state::<Logger>();
    logger.api_request("get_book_word_materials", Some(&format!("book: {book_id}")));
    let pool = Arc::new(app.state::<SqlitePool>().inner().clone());
    let result = async {
        let words = crate::repositories::word_repository::WordRepository::new(
            pool.clone(),
            Arc::new(logger.inner().clone()),
        )
        .id_texts_by_book(book_id)
        .await?;
        WordMaterialsService::new(pool).counts(&words).await
    }
    .await;
    super::finish(&logger, "get_book_word_materials", result)
}
