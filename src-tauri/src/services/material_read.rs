//! 素材阅读（多模态素材 B2，D52）：非文本素材（PDF、图片、Word）交给 pi 自主处理。
//!
//! 我们只做两头：
//! - 准备：把素材放进本次任务的工作目录（Word 先取出文字与内嵌图片），写出随应用分发的 pi skills，
//!   按模型能力告诉工具能不能看图；
//! - 核对：pi 用 `submit_material` 交回的内容按输入校正——有文字层时，逐句检查英文确实出现在文件里，
//!   找不到的句子标为待核对（不悄悄入库）；词组必须出现在某个句子里。
//!
//! 中间怎么读（看图还是读文字层、版面怎么对应）由 pi 按 skills 自己决定。

use crate::agent::catalog::{self, provider_models};
use crate::agent::config::TaskWorkspace;
use crate::agent::protocol::AgentEvent;
use crate::agent::{tasks, AgentPaths};
use crate::error::{AppError, AppResult};
use crate::logger::Logger;
use crate::prompts::{PromptProfile, MATERIAL_SKILLS};
use crate::services::passage_import_files::{docx_text, pdf_text};
use crate::services::{passage_import, passage_rules};
use crate::types::ai_model::AIModelConfig;
use crate::types::material::{
    MaterialContent, MaterialPassage, MaterialPhrase, MaterialSentence, MaterialVocab,
};
use crate::types::passage::{ImportPreview, ImportPreviewItem, ImportSentence, ImportWord};
use crate::types::word_analysis::ExtractedWord;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 交给 pi 处理的素材类型（文本类 txt / md / srt / vtt 仍由我们自己的算法预处理）
pub const PI_MATERIAL_TYPES: [&str; 7] = ["pdf", "png", "jpg", "jpeg", "webp", "gif", "docx"];

/// 素材的用途：决定提示里强调什么
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MaterialPurpose {
    /// 导入为短文（也收词组与词汇表）
    Passage,
    /// 提取单词（重点是词汇表）
    Words,
}

fn io(e: std::io::Error) -> AppError {
    AppError::InternalError(format!("准备素材失败：{}", e))
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn is_pi_material(path: &Path) -> bool {
    PI_MATERIAL_TYPES.contains(&extension(path).as_str())
}

/// 写出 skills（每次运行前覆盖，随应用版本更新），返回各 skill 目录
pub fn write_skills(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut dirs = Vec::new();
    for (name, body) in MATERIAL_SKILLS {
        let dir = root.join("skills").join(name);
        std::fs::create_dir_all(&dir).map_err(io)?;
        std::fs::write(dir.join("SKILL.md"), body).map_err(io)?;
        dirs.push(dir);
    }
    Ok(dirs)
}

/// 准备工作目录：素材文件放进去；Word 另取出 `document.txt` 与内嵌图片（pi 用 read_text / view_image 读）
pub fn prepare_workspace(dir: &Path, source: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dir).map_err(io)?;
    let ext = extension(source);
    let bytes = std::fs::read(source)
        .map_err(|e| AppError::ValidationError(format!("无法读取文件：{}", e)))?;
    if ext == "docx" {
        std::fs::write(dir.join("document.txt"), docx_text(&bytes)?).map_err(io)?;
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).map_err(|_| {
            AppError::ValidationError("Word 文件读取失败：文件可能已损坏".to_string())
        })?;
        for i in 0..archive.len() {
            let Ok(mut entry) = archive.by_index(i) else {
                continue;
            };
            let Ok(name) = entry.name().map(|n| n.to_string()) else {
                continue;
            };
            let Some(file) = name.strip_prefix("word/media/") else {
                continue;
            };
            let lower = file.to_ascii_lowercase();
            if file.contains('/')
                || !["png", "jpg", "jpeg", "gif", "webp"]
                    .iter()
                    .any(|e| lower.ends_with(e))
            {
                continue;
            }
            let mut data = Vec::new();
            if entry.read_to_end(&mut data).is_ok() {
                std::fs::write(dir.join(format!("image-{}", file)), data).map_err(io)?;
            }
        }
    } else {
        std::fs::write(dir.join(format!("material.{}", ext)), bytes).map_err(io)?;
    }
    Ok(())
}

/// 只能看图才读得出来的素材（照片、海报、扫描图片）
pub fn is_image(file_name: &str) -> bool {
    matches!(
        extension(Path::new(file_name.trim())).as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif"
    )
}

/// 开始读取前检查：图片只能看图读，模型不能看图时直接告诉用户换模型，不白跑一趟。
/// `task_label` 是「设置 → AI 助手」里这项任务的名字
pub async fn check_can_read(
    paths: &AgentPaths,
    model: &AIModelConfig,
    file_name: &str,
    task_label: &str,
) -> AppResult<()> {
    if is_image(file_name) && !model_sees_images(paths, model).await {
        return Err(AppError::ValidationError(format!(
            "现在用的模型「{}」不能看图片。请在「设置 → AI 助手」给「{}」换一个能看图片的模型（模型列表里带图片图标的）",
            model.display_name, task_label
        )));
    }
    Ok(())
}

/// 读取进度：把 pi 的工具调用换成给用户看的阶段（读到第几页、正在整理）
#[derive(Default)]
pub struct ReadProgress {
    pages: u64,
}

impl ReadProgress {
    pub fn on_event(&mut self, event: &AgentEvent) -> Option<String> {
        let (tool, details) = match event {
            AgentEvent::AutoRetryStart { .. } => return Some("网络不太稳定，正在重试".to_string()),
            AgentEvent::ToolExecutionEnd {
                tool_name,
                details,
                is_error: false,
                ..
            } => (tool_name.as_str(), details),
            _ => return None,
        };
        let refused = details.get("refused").and_then(Value::as_bool) == Some(true);
        match tool {
            "list_material" => {
                self.pages = details
                    .get("files")
                    .and_then(Value::as_array)
                    .map(|files| {
                        files
                            .iter()
                            .filter_map(|f| f.get("pages").and_then(Value::as_u64))
                            .sum()
                    })
                    .unwrap_or(0);
                Some(if self.pages > 0 {
                    format!("共 {} 页，开始阅读", self.pages)
                } else {
                    "开始阅读".to_string()
                })
            }
            "view_pdf_page" if !refused => {
                let page = details.get("page").and_then(Value::as_u64).unwrap_or(0);
                Some(if self.pages > 0 && page >= self.pages {
                    format!("已读完 {} 页，正在整理内容", self.pages)
                } else if self.pages > 0 {
                    format!("已读到第 {} 页，共 {} 页", page, self.pages)
                } else {
                    format!("已读到第 {} 页", page)
                })
            }
            "view_image" if !refused => Some("已看完图片，正在整理内容".to_string()),
            "read_pdf_text" | "read_text" => Some("已读取文字，正在整理内容".to_string()),
            "submit_material" => Some("正在核对内容".to_string()),
            _ => None,
        }
    }
}

/// 这个模型能不能看图：用户设置优先，其次 pi 内置目录；都没有按不能
pub async fn model_sees_images(paths: &AgentPaths, model: &AIModelConfig) -> bool {
    if let Some(v) = model.supports_images {
        return v;
    }
    let Some(pi) = model
        .provider
        .pi_provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return false;
    };
    match catalog::load_catalog(paths).await {
        Ok(c) => provider_models(&c, pi)
            .iter()
            .find(|m| m.id == model.model_id)
            .is_some_and(|m| m.input.iter().any(|i| i == "image")),
        Err(_) => false,
    }
}

/// 小写英文词序列（只留字母数字与撇号），用于原文核对
fn tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .replace(['’', '‘'], "'")
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '\''))
        .filter(|t| !t.is_empty() && t.chars().any(|c| c.is_ascii_alphanumeric()))
        .map(|t| t.trim_matches('\'').to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

/// 句子的词是否按顺序出现在文字层里。排版讲义的文字层常把注释、译文、整个侧栏插进句子中间：
/// 夹着的零星几个词（注释）不限，大段插入（侧栏、跨栏）最多两处、每处不超过 300 个词——
/// 这样分栏的真句子认得出来，从全文零散凑出的编造句子认不出来
fn appears_in(sentence: &[String], source: &[String]) -> bool {
    const SMALL_GAP: usize = 6;
    const MAX_GAP: usize = 300;
    const MAX_BIG_GAPS: usize = 2;
    if sentence.is_empty() {
        return true;
    }
    source
        .iter()
        .enumerate()
        .filter(|(_, t)| *t == &sentence[0])
        .any(|(start, _)| {
            let (mut next, mut gap, mut big_gaps) = (1, 0, 0);
            for t in &source[start + 1..] {
                if next == sentence.len() {
                    break;
                }
                if *t == sentence[next] {
                    if gap > SMALL_GAP {
                        big_gaps += 1;
                    }
                    next += 1;
                    gap = 0;
                } else {
                    gap += 1;
                    if gap > MAX_GAP || big_gaps >= MAX_BIG_GAPS && gap > SMALL_GAP {
                        break;
                    }
                }
            }
            next == sentence.len()
        })
}

/// 素材的文字层（用于核对）；图片与扫描件没有文字层时为 None
pub fn source_text(source: &Path) -> Option<Vec<String>> {
    let bytes = std::fs::read(source).ok()?;
    let text = match extension(source).as_str() {
        "pdf" => pdf_text(&bytes).ok()?,
        "docx" => docx_text(&bytes).ok()?,
        _ => return None,
    };
    let words = tokens(&text);
    // 文字层太少（扫描件只有页码之类）视为没有
    (words.len() >= 20).then_some(words)
}

fn clean(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// `submit_material` → 核对后的内容：去空、按文字层标出待核对的句子、词组须出现在句子里、词汇去重
pub fn content_from_submission(
    details: &Value,
    source: Option<&[String]>,
    used_images: bool,
) -> MaterialContent {
    let str_of = |v: &Value, k: &str| clean(v.get(k).and_then(Value::as_str));
    let passages: Vec<MaterialPassage> = details
        .get("passages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|p| MaterialPassage {
            title: str_of(p, "title"),
            sentences: p
                .get("sentences")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|s| {
                    let en = str_of(s, "en")?
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ");
                    let unverified = source.is_some_and(|src| !appears_in(&tokens(&en), src));
                    Some(MaterialSentence {
                        en,
                        zh: str_of(s, "zh"),
                        paragraph: s.get("paragraph").and_then(Value::as_i64),
                        unverified,
                    })
                })
                .collect(),
        })
        .filter(|p| !p.sentences.is_empty())
        .collect();

    // 词组须在某个句子里连着出现（照原文写法）
    let sentence_tokens: Vec<Vec<String>> = passages
        .iter()
        .flat_map(|p| &p.sentences)
        .map(|s| tokens(&s.en))
        .collect();
    let in_some_sentence = |phrase: &[String]| {
        !phrase.is_empty()
            && sentence_tokens
                .iter()
                .any(|s| s.windows(phrase.len()).any(|w| w == phrase))
    };
    let mut phrases: Vec<MaterialPhrase> = Vec::new();
    for p in details
        .get("phrases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (Some(text), Some(meaning)) = (str_of(p, "text"), str_of(p, "meaning")) else {
            continue;
        };
        if !in_some_sentence(&tokens(&text))
            || phrases.iter().any(|x| x.text.eq_ignore_ascii_case(&text))
        {
            continue;
        }
        let base = str_of(p, "base").filter(|b| !b.eq_ignore_ascii_case(&text));
        phrases.push(MaterialPhrase {
            text,
            base,
            meaning,
        });
    }

    let mut vocabulary: Vec<MaterialVocab> = Vec::new();
    for v in details
        .get("vocabulary")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(word) = str_of(v, "word") else {
            continue;
        };
        if !word.chars().any(|c| c.is_ascii_alphabetic())
            || vocabulary
                .iter()
                .any(|x| x.word.eq_ignore_ascii_case(&word))
        {
            continue;
        }
        vocabulary.push(MaterialVocab {
            word,
            ipa: str_of(v, "ipa").map(|s| s.trim_matches(['[', ']', '/']).trim().to_string()),
            pos: str_of(v, "pos"),
            meaning: str_of(v, "meaning"),
        });
    }

    MaterialContent {
        title: str_of(details, "title"),
        passages,
        phrases,
        vocabulary,
        note: str_of(details, "note"),
        used_images,
    }
}

/// 素材内容 → 导入预览（与粘贴文本的预览同一结构，复用拆篇、改标题、导入流程）：
/// 每篇正文一项（超长的按句数切开），句子带材料里的译文与待核对标记；
/// 画线词组与词汇表里在这一篇正文中出现的词成为它的词汇
pub fn to_import_preview(content: &MaterialContent, source_label: &str) -> ImportPreview {
    let mut items = Vec::new();
    for (pi, passage) in content.passages.iter().enumerate() {
        let title = passage
            .title
            .clone()
            .or_else(|| (pi == 0).then(|| content.title.clone()).flatten())
            .unwrap_or_default();
        let chunks: Vec<&[MaterialSentence]> = passage
            .sentences
            .chunks(passage_import::MAX_SENTENCES_PER_ITEM)
            .collect();
        for (ci, chunk) in chunks.iter().enumerate() {
            let mut prev_paragraph = None;
            let sentences: Vec<ImportSentence> = chunk
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    let paragraph =
                        i == 0 || (s.paragraph.is_some() && s.paragraph != prev_paragraph);
                    prev_paragraph = s.paragraph;
                    ImportSentence {
                        en: s.en.clone(),
                        paragraph,
                        zh: s.zh.clone(),
                        unverified: s.unverified,
                    }
                })
                .collect();
            let full: String = sentences
                .iter()
                .map(|s| s.en.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let mut words: Vec<ImportWord> = Vec::new();
            let mut push = |w: ImportWord| {
                if !words.iter().any(|x| x.word.eq_ignore_ascii_case(&w.word)) {
                    words.push(w);
                }
            };
            for p in &content.phrases {
                let word = p.base.clone().unwrap_or_else(|| p.text.clone());
                let forms: Vec<String> = p
                    .base
                    .as_ref()
                    .map(|_| vec![p.text.clone()])
                    .unwrap_or_default();
                if passage_rules::text_uses_forms(&full, &word, &forms) {
                    push(ImportWord {
                        word,
                        meaning: Some(p.meaning.clone()),
                        forms,
                    });
                }
            }
            for v in &content.vocabulary {
                if passage_rules::text_uses(&full, &v.word) {
                    push(ImportWord {
                        word: v.word.clone(),
                        meaning: v.meaning.clone(),
                        forms: Vec::new(),
                    });
                }
            }
            items.push(ImportPreviewItem {
                title: if chunks.len() > 1 && !title.is_empty() {
                    format!("{}（{}）", title, ci + 1)
                } else {
                    title.clone()
                },
                word_count: full.split_whitespace().count() as i64,
                sentences,
                words,
            });
        }
    }

    let mut warnings = Vec::new();
    if let Some(note) = &content.note {
        warnings.push(note.clone());
    }
    let unverified = content
        .passages
        .iter()
        .flat_map(|p| &p.sentences)
        .filter(|s| s.unverified)
        .count();
    if unverified > 0 {
        warnings.push(format!(
            "有 {} 句没能和文件内容对上，已标出，请对照原材料核对",
            unverified
        ));
    }
    if items.is_empty() {
        warnings.push("这份素材里没有成段的英文文章".to_string());
    }
    ImportPreview {
        source_label: source_label.to_string(),
        total_words: items.iter().map(|i| i.word_count).sum(),
        items,
        warnings,
    }
}

/// 素材里的词汇（词汇表 + 画线词组，词组按原形）→ 提词结果的单词，去重；释义与词性照材料
pub fn to_extracted_words(content: &MaterialContent) -> Vec<ExtractedWord> {
    let mut words: Vec<ExtractedWord> = Vec::new();
    let mut push = |word: String, pos: Option<String>, meaning: Option<String>| {
        let word = word.split_whitespace().collect::<Vec<_>>().join(" ");
        if word.is_empty() || words.iter().any(|w| w.word.eq_ignore_ascii_case(&word)) {
            return;
        }
        words.push(ExtractedWord {
            word,
            frequency: 1,
            part_of_speech: pos,
            meaning,
        });
    };
    for v in &content.vocabulary {
        push(v.word.clone(), v.pos.clone(), v.meaning.clone());
    }
    for p in &content.phrases {
        push(
            p.base.clone().unwrap_or_else(|| p.text.clone()),
            None,
            Some(p.meaning.clone()),
        );
    }
    words
}

/// 素材正文（素材没有词汇表时按正文提取）
pub fn passage_text(content: &MaterialContent) -> String {
    content
        .passages
        .iter()
        .map(|p| {
            p.sentences
                .iter()
                .map(|s| s.en.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn purpose_line(purpose: MaterialPurpose) -> &'static str {
    match purpose {
        MaterialPurpose::Passage => "用途：导入为短文。请完整整理正文句子与材料里的逐句翻译，同时收下材料标出的词组和词汇表。",
        MaterialPurpose::Words => "用途：提取单词。重点是材料里的单词与词组（词汇表、海报、生词表、画线词组）；正文句子可以不整理。",
    }
}

/// 保存上传的素材文件（base64）到 `dir`，返回路径；大小上限与导入材料相同
pub fn save_upload(dir: &Path, file_name: &str, data: &str) -> AppResult<PathBuf> {
    use base64::Engine;
    let name = Path::new(file_name.trim());
    if !is_pi_material(name) {
        return Err(AppError::ValidationError(format!(
            "不支持这种文件，可以选择 {}",
            PI_MATERIAL_TYPES.join("、")
        )));
    }
    let too_big = || {
        AppError::ValidationError(format!(
            "文件太大了，请选择 {}MB 以内的文件",
            passage_import::MAX_FILE_BYTES / 1024 / 1024
        ))
    };
    if data.len() / 4 * 3 > passage_import::MAX_FILE_BYTES + 3 {
        return Err(too_big());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| AppError::ValidationError("文件内容读取失败，请重新选择".to_string()))?;
    if bytes.len() > passage_import::MAX_FILE_BYTES {
        return Err(too_big());
    }
    std::fs::create_dir_all(dir).map_err(io)?;
    let path = dir.join(format!(
        "upload-{}.{}",
        uuid::Uuid::new_v4(),
        extension(name)
    ));
    std::fs::write(&path, bytes).map_err(io)?;
    Ok(path)
}

/// 读一份素材：准备工作目录 → pi 自主读取 → 核对。`work_root` 下为本次运行建临时目录，结束后删除
#[allow(clippy::too_many_arguments)]
pub async fn read_material(
    paths: &AgentPaths,
    model: &AIModelConfig,
    profile: &PromptProfile,
    source: &Path,
    purpose: MaterialPurpose,
    logger: &Logger,
    cancelled: impl Fn() -> bool,
    on_stage: impl Fn(String),
) -> AppResult<MaterialContent> {
    if !is_pi_material(source) {
        return Err(AppError::ValidationError(format!(
            "不支持这种文件：{}",
            source.file_name().and_then(|n| n.to_str()).unwrap_or("")
        )));
    }
    let dir = paths
        .root
        .join("materials")
        .join(uuid::Uuid::new_v4().to_string());
    prepare_workspace(&dir, source)?;
    let images = model_sees_images(paths, model).await;
    let workspace = TaskWorkspace {
        dir: dir.clone(),
        skills: write_skills(&paths.root)?,
        env: vec![
            (
                "REDLARK_MATERIAL_DIR".to_string(),
                dir.to_string_lossy().into_owned(),
            ),
            (
                "REDLARK_MODEL_IMAGES".to_string(),
                if images { "1" } else { "0" }.to_string(),
            ),
        ],
    };
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let message = format!("素材文件：{}\n{}", name, purpose_line(purpose));
    let mut progress = ReadProgress::default();
    let result = tasks::read_material(
        paths,
        model,
        profile,
        &workspace,
        &message,
        logger,
        cancelled,
        |event| {
            if let Some(stage) = progress.on_event(event) {
                on_stage(stage);
            }
        },
    )
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    let details = result?;
    Ok(content_from_submission(
        &details,
        source_text(source).as_deref(),
        images,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tool_end(name: &str, details: Value) -> AgentEvent {
        AgentEvent::ToolExecutionEnd {
            tool_call_id: "t".to_string(),
            tool_name: name.to_string(),
            details,
            is_error: false,
            content_text: String::new(),
        }
    }

    #[test]
    fn progress_reports_pages_read() {
        let mut p = ReadProgress::default();
        let files =
            json!({"files": [{"name": "a.pdf", "kind": "pdf", "pages": 8}], "canViewImages": true});
        assert_eq!(
            p.on_event(&tool_end("list_material", files)).as_deref(),
            Some("共 8 页，开始阅读")
        );
        assert_eq!(
            p.on_event(&tool_end(
                "view_pdf_page",
                json!({"refused": false, "file": "a.pdf", "page": 3})
            ))
            .as_deref(),
            Some("已读到第 3 页，共 8 页")
        );
        assert_eq!(
            p.on_event(&tool_end(
                "view_pdf_page",
                json!({"refused": false, "file": "a.pdf", "page": 8})
            ))
            .as_deref(),
            Some("已读完 8 页，正在整理内容")
        );
        // 模型不能看图时看图被拒：不算读到
        assert_eq!(
            p.on_event(&tool_end(
                "view_pdf_page",
                json!({"refused": true, "page": 1})
            )),
            None
        );
        assert_eq!(
            p.on_event(&tool_end("read_pdf_text", json!({"file": "a.pdf"})))
                .as_deref(),
            Some("已读取文字，正在整理内容")
        );
    }

    #[test]
    fn images_are_recognized() {
        assert!(is_image("poster.JPG"));
        assert!(is_image(" a.webp "));
        assert!(!is_image("handout.pdf"));
        assert!(!is_image("notes.docx"));
    }

    #[test]
    fn sentences_not_in_text_layer_are_flagged() {
        // 文字层里英文与中文注释按行交错：核对只比英文词
        // 侧栏词汇（report rɪˈpɔːt）插在句子中间，也要认得出来
        let layer = tokens(
            "The trade body\n行业团体\nAirlines UK report [rɪˈpɔːt] has said\nboth passengers and airlines\ndeserve better\n应得到更好的",
        );
        let details = json!({
            "passages": [{"sentences": [
                {"en": "The trade body Airlines UK has said both passengers and airlines deserve better.", "zh": "行业机构表示……"},
                {"en": "Airlines UK says passengers deserve more."}
            ]}],
            "phrases": [{"text": "trade body", "meaning": "行业团体"}, {"text": "made up", "meaning": "编的"}],
            "vocabulary": [{"word": "airport", "ipa": "[ˈeəpɔːt]", "pos": "n.", "meaning": "机场"}, {"word": "Airport"}, {"word": "  "}]
        });
        let c = content_from_submission(&details, Some(&layer), true);
        let s = &c.passages[0].sentences;
        assert!(!s[0].unverified && s[1].unverified);
        assert_eq!(c.phrases.len(), 1, "词组必须出现在句子里");
        assert_eq!(c.vocabulary.len(), 1, "词汇去重、去空");
        assert_eq!(c.vocabulary[0].ipa.as_deref(), Some("ˈeəpɔːt"));
        assert!(c.used_images);
    }

    #[test]
    fn scattered_words_do_not_make_a_sentence() {
        // 真句子被侧栏隔开能认出；同样的词散落在三处以上（编造的拼凑句）认不出
        let side = vec!["x".to_string(); 120];
        let mut layer = tokens("Nats which runs air traffic control say");
        layer.extend(side.clone());
        layer.extend(tokens("the issues are unrelated though"));
        assert!(appears_in(
            &tokens("Nats, which runs air traffic control, say the issues are unrelated though."),
            &layer
        ));
        let mut scattered = Vec::new();
        for w in ["airlines", "say", "the", "problem", "is", "fixed"] {
            scattered.push(w.to_string());
            scattered.extend(side.clone());
        }
        assert!(!appears_in(
            &tokens("Airlines say the problem is fixed."),
            &scattered
        ));
    }

    #[test]
    fn material_becomes_import_preview_with_words() {
        let content = MaterialContent {
            title: Some("Air traffic".into()),
            passages: vec![MaterialPassage {
                title: None,
                sentences: vec![
                    MaterialSentence {
                        en: "I got through the security check.".into(),
                        zh: Some("我通过了安检。".into()),
                        paragraph: Some(1),
                        unverified: false,
                    },
                    MaterialSentence {
                        en: "Flights were grounded.".into(),
                        zh: None,
                        paragraph: Some(2),
                        unverified: true,
                    },
                ],
            }],
            phrases: vec![MaterialPhrase {
                text: "got through".into(),
                base: Some("get through".into()),
                meaning: "通过".into(),
            }],
            vocabulary: vec![
                MaterialVocab {
                    word: "ground".into(),
                    ipa: None,
                    pos: None,
                    meaning: Some("使停飞".into()),
                },
                MaterialVocab {
                    word: "passenger".into(),
                    ipa: None,
                    pos: None,
                    meaning: Some("乘客".into()),
                },
            ],
            note: Some("最后一句没有中文。".into()),
            used_images: true,
        };
        let preview = to_import_preview(&content, "news.pdf");
        assert_eq!(preview.items.len(), 1);
        let item = &preview.items[0];
        assert_eq!(item.title, "Air traffic");
        assert!(
            item.sentences[0].paragraph && item.sentences[1].paragraph,
            "段落编号变化即新段落"
        );
        assert_eq!(item.sentences[0].zh.as_deref(), Some("我通过了安检。"));
        assert!(item.sentences[1].unverified);
        let words: Vec<&str> = item.words.iter().map(|w| w.word.as_str()).collect();
        assert_eq!(
            words,
            vec!["get through", "ground"],
            "词组按原形、带原文写法；没出现在正文里的词不收"
        );
        assert_eq!(item.words[0].forms, vec!["got through".to_string()]);
        assert_eq!(preview.warnings.len(), 2, "pi 的说明 + 待核对提示");
    }

    #[test]
    fn vocabulary_and_phrases_become_extracted_words() {
        let content = MaterialContent {
            phrases: vec![
                MaterialPhrase {
                    text: "got through".into(),
                    base: Some("get through".into()),
                    meaning: "通过".into(),
                },
                MaterialPhrase {
                    text: "Gate".into(),
                    base: None,
                    meaning: "门".into(),
                },
            ],
            vocabulary: vec![MaterialVocab {
                word: "gate".into(),
                ipa: Some("ɡeɪt".into()),
                pos: Some("n.".into()),
                meaning: Some("大门".into()),
            }],
            ..Default::default()
        };
        let words = to_extracted_words(&content);
        let pairs: Vec<(&str, Option<&str>)> = words
            .iter()
            .map(|w| (w.word.as_str(), w.meaning.as_deref()))
            .collect();
        assert_eq!(
            pairs,
            vec![("gate", Some("大门")), ("get through", Some("通过"))],
            "词汇表优先、词组按原形、去重"
        );
        assert_eq!(words[0].part_of_speech.as_deref(), Some("n."));
    }

    #[test]
    fn without_text_layer_nothing_is_flagged() {
        let details = json!({"passages": [{"sentences": [{"en": "Hello there."}]}], "phrases": [], "vocabulary": []});
        let c = content_from_submission(&details, None, true);
        assert!(!c.passages[0].sentences[0].unverified);
    }

    /// 真实调用：MATERIAL_DB（含模型与密钥的库）、MATERIAL_MODEL（model_id）、MATERIAL_FILE、REDLARK_AGENT_BIN
    /// cargo test real_material_read -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_material_read() {
        use crate::repositories::ai_model_repository::AIModelRepository;
        let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("需要环境变量 {}", k));
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=ro", env("MATERIAL_DB")))
            .await
            .unwrap();
        let logger = crate::test_support::test_logger();
        let repo = AIModelRepository::new(std::sync::Arc::new(pool), logger.clone());
        let wanted = env("MATERIAL_MODEL");
        let model = repo
            .find_models(None, true)
            .await
            .unwrap()
            .into_iter()
            .find(|m| m.model_id == wanted)
            .expect("库里没有这个模型");
        // MATERIAL_NO_IMAGES=1：按「不能看图」运行（测试 pi 自己退化为文字层）
        let mut model = model;
        if std::env::var("MATERIAL_NO_IMAGES").is_ok() {
            model.supports_images = Some(false);
        }
        let root = std::env::temp_dir().join(format!("material-real-{}", uuid::Uuid::new_v4()));
        let paths = AgentPaths {
            program: PathBuf::from(env("REDLARK_AGENT_BIN")),
            root: root.clone(),
        };
        let started = std::time::Instant::now();
        let content = read_material(
            &paths,
            &model,
            &PromptProfile::default(),
            Path::new(&env("MATERIAL_FILE")),
            if std::env::var("MATERIAL_PURPOSE").as_deref() == Ok("words") {
                MaterialPurpose::Words
            } else {
                MaterialPurpose::Passage
            },
            &logger,
            || false,
            |stage| println!("· {stage}"),
        )
        .await
        .unwrap();
        let words = to_extracted_words(&content);
        println!(
            "提词候选 {}：{}",
            words.len(),
            words
                .iter()
                .map(|w| format!("{}={}", w.word, w.meaning.as_deref().unwrap_or("")))
                .collect::<Vec<_>>()
                .join("、")
        );
        let sentences: Vec<_> = content.passages.iter().flat_map(|p| &p.sentences).collect();
        println!(
            "用时 {:.0}s 看图={} 句子 {}（待核对 {}，有译文 {}） 词组 {} 词汇 {} note={:?}",
            started.elapsed().as_secs_f64(),
            content.used_images,
            sentences.len(),
            sentences.iter().filter(|s| s.unverified).count(),
            sentences.iter().filter(|s| s.zh.is_some()).count(),
            content.phrases.len(),
            content.vocabulary.len(),
            content.note
        );
        println!("{}", serde_json::to_string_pretty(&content).unwrap());
    }

    /// 导入短文全流程（真实调用翻译）：保存下来的素材内容 → 预览 → 导入到 MATERIAL_DB 的副本
    /// MATERIAL_DB（会先拷贝）、MATERIAL_JSON（MaterialContent）、REDLARK_AGENT_BIN
    #[tokio::test]
    #[ignore]
    async fn real_material_passage_import() {
        use crate::services::passage_import_service::PassageImportService;
        use crate::types::passage::ImportPassageRequest;
        let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("需要环境变量 {}", k));
        let root = std::env::temp_dir().join(format!("material-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = root.join("copy.db");
        let src = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=ro", env("MATERIAL_DB")))
            .await
            .unwrap();
        sqlx::query(&format!("VACUUM INTO '{}'", db.display()))
            .execute(&src)
            .await
            .unwrap();
        let pool = std::sync::Arc::new(
            sqlx::SqlitePool::connect(&format!("sqlite://{}", db.display()))
                .await
                .unwrap(),
        );
        let content: MaterialContent =
            serde_json::from_str(&std::fs::read_to_string(env("MATERIAL_JSON")).unwrap()).unwrap();
        let preview = to_import_preview(&content, "bbc.pdf");
        let item = &preview.items[0];
        println!(
            "预览：{} 篇，第一篇 {} 句，词汇 {}，提示 {:?}",
            preview.items.len(),
            item.sentences.len(),
            item.words.len(),
            preview.warnings
        );
        let request = ImportPassageRequest {
            title: Some(item.title.clone()).filter(|t| !t.is_empty()),
            sentences: item.sentences.clone(),
            source_label: preview.source_label.clone(),
            book_ids: vec![],
            ai_key_words: false,
            words: item.words.clone(),
        };
        let paths = AgentPaths {
            program: PathBuf::from(env("REDLARK_AGENT_BIN")),
            root: root.join("agent"),
        };
        let svc = PassageImportService::new(pool, crate::test_support::test_logger());
        let passage = svc.import(&request, &paths, &|| false).await.unwrap();
        let same_zh = passage
            .sentences
            .iter()
            .zip(&item.sentences)
            .filter(|(saved, pre)| {
                pre.zh
                    .as_deref()
                    .is_some_and(|z| z.trim() == saved.zh.trim())
            })
            .count();
        println!(
            "已导入「{}」 水平 {} 句子 {}（沿用材料译文 {}） 词汇 {}：{}",
            passage.title,
            passage.level,
            passage.sentences.len(),
            same_zh,
            passage.target_words.len(),
            passage
                .target_words
                .iter()
                .map(|t| t.word.as_str())
                .collect::<Vec<_>>()
                .join("、")
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// 用保存下来的一次真实结果重跑核对：MATERIAL_JSON、MATERIAL_FILE
    #[test]
    #[ignore]
    fn recheck_saved_material() {
        let env = |k: &str| std::env::var(k).unwrap();
        let details: Value =
            serde_json::from_str(&std::fs::read_to_string(env("MATERIAL_JSON")).unwrap()).unwrap();
        let c = content_from_submission(
            &details,
            source_text(Path::new(&env("MATERIAL_FILE"))).as_deref(),
            true,
        );
        for s in c
            .passages
            .iter()
            .flat_map(|p| &p.sentences)
            .filter(|s| s.unverified)
        {
            println!("待核对：{}", s.en);
        }
        println!("词组 {} / 词汇 {}", c.phrases.len(), c.vocabulary.len());
    }

    #[test]
    fn workspace_and_skills_are_prepared() {
        let root = std::env::temp_dir().join(format!("material-test-{}", uuid::Uuid::new_v4()));
        let src = root.join("poster.PNG");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&src, b"png").unwrap();
        assert!(is_pi_material(&src) && !is_pi_material(Path::new("a.srt")));
        let dir = root.join("work");
        prepare_workspace(&dir, &src).unwrap();
        assert!(dir.join("material.png").exists());
        let skills = write_skills(&root).unwrap();
        assert_eq!(skills.len(), 3);
        assert!(skills.iter().all(|d| d.join("SKILL.md").exists()));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
