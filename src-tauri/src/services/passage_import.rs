//! 导入材料的确定性预处理（不用 AI，DECISIONS D30）：
//! 读取（编码识别、docx / pdf 取文字）→ 清理（字幕时间轴、Markdown 标记、页码、多余空白、中文行）
//! → 分节（标题行）→ 分段 → 分句 → 按篇幅拆成几篇。
//!
//! 原文一字不改：只去掉格式与空白，句子内容保持原样；后面的翻译只回传译文，英文以这里的句子为准。

use crate::error::{AppError, AppResult};
use crate::services::passage_rules::words_of;
use crate::types::passage::{
    ImportPreview, ImportPreviewItem, ImportSentence, MaterialText, PrepareImportRequest,
};

/// 每篇目标词数范围与默认值
pub const TARGET_WORDS_RANGE: std::ops::RangeInclusive<i64> = 120..=450;
pub const DEFAULT_TARGET_WORDS: i64 = 300;
/// 一次导入的上限
pub const MAX_TOTAL_WORDS: usize = 20_000;
pub const MAX_ITEMS: usize = 20;
pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
/// 单篇最多句数（导入命令也按这个校验）
pub const MAX_SENTENCES_PER_ITEM: usize = 120;
/// 至少多少个英文词
const MIN_WORDS: usize = 10;
/// 一句超过这么多词时按逗号 / 分号再切（没有标点的字幕常见）
const LONG_SENTENCE_WORDS: usize = 50;
const SPLIT_CHUNK_WORDS: usize = 30;
/// 当作标题的行最多几个词
const HEADING_MAX_WORDS: usize = 12;

/// 材料类型：决定清理规则
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Plain,
    Markdown,
    Subtitle,
}

fn word_count(text: &str) -> usize {
    words_of(text).count()
}

pub(crate) fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30FF   // 假名
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xAC00..=0xD7AF // 韩文
        | 0xF900..=0xFAFF
        | 0xFF00..=0xFFEF // 全角标点
        | 0x3000..=0x303F)
}

/// 一行主要是中日韩文字（双语课文里的译文行）
fn mostly_cjk(line: &str) -> bool {
    let cjk = line.chars().filter(|c| is_cjk(*c)).count();
    let latin = line.chars().filter(|c| c.is_ascii_alphabetic()).count();
    cjk > 0 && cjk * 2 >= cjk + latin
}

// ==================== 读取 ====================

/// 按文件名后缀判断材料类型；不支持的格式报错
pub fn kind_of(file_name: Option<&str>) -> AppResult<(SourceKind, &'static str)> {
    let ext = file_name
        .and_then(|n| n.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()))
        .unwrap_or_default();
    Ok(match ext.as_str() {
        "" | "txt" | "text" => (SourceKind::Plain, "txt"),
        "md" | "markdown" => (SourceKind::Markdown, "md"),
        "srt" => (SourceKind::Subtitle, "srt"),
        "vtt" => (SourceKind::Subtitle, "vtt"),
        "docx" => (SourceKind::Plain, "docx"),
        "pdf" => (SourceKind::Plain, "pdf"),
        _ => {
            return Err(AppError::ValidationError(
                "暂不支持这种文件，请选择 .txt、.md、.srt、.vtt、.docx 或 .pdf".to_string(),
            ))
        }
    })
}

/// 文本文件解码：BOM（UTF-8 / UTF-16）→ UTF-8 → UTF-16（无 BOM，按零字节判断）→ GBK
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE
            .decode_without_bom_handling(rest)
            .0
            .into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE
            .decode_without_bom_handling(rest)
            .0
            .into_owned();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    // 英文的 UTF-16 每两个字节有一个 0
    let zeros_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    let zeros_even = bytes.iter().step_by(2).filter(|b| **b == 0).count();
    let half = bytes.len() / 2;
    if half > 0 && zeros_odd * 3 > half {
        return encoding_rs::UTF_16LE
            .decode_without_bom_handling(bytes)
            .0
            .into_owned();
    }
    if half > 0 && zeros_even * 3 > half {
        return encoding_rs::UTF_16BE
            .decode_without_bom_handling(bytes)
            .0
            .into_owned();
    }
    encoding_rs::GBK
        .decode_without_bom_handling(bytes)
        .0
        .into_owned()
}

/// 读取一个材料文件：解码 / 取文字 → 按格式清理 → 段落之间空一行的纯文本（标题独占一段）。
/// 单词本「从文本提取」与短文导入共用；空文件、非英文、扫描版 PDF 报错。
pub fn read_material(file_name: &str, data: &str) -> AppResult<MaterialText> {
    use base64::Engine;
    let name = file_name.trim();
    let name = if name.is_empty() { "文件" } else { name };
    let (kind, ext) = kind_of(Some(name))?;
    // 先按 base64 长度估计大小，超限时不解码
    if data.len() / 4 * 3 > MAX_FILE_BYTES + 3 {
        return Err(AppError::ValidationError(
            "文件太大了，请选择 10MB 以内的文件".to_string(),
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| AppError::ValidationError("文件内容读取失败，请重新选择".to_string()))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(AppError::ValidationError(
            "文件太大了，请选择 10MB 以内的文件".to_string(),
        ));
    }
    let raw = match ext {
        "docx" => crate::services::passage_import_files::docx_text(&bytes)?,
        "pdf" => crate::services::passage_import_files::pdf_text(&bytes)?,
        _ => decode_text(&bytes),
    };
    let (sections, cjk_lines) = sections_of(&raw, kind);
    let words: usize = sections
        .iter()
        .flat_map(|(t, ps)| t.iter().chain(ps.iter()))
        .map(|p| word_count(p))
        .sum();
    if words < MIN_WORDS {
        return Err(AppError::ValidationError(if cjk_lines > 0 {
            "这份材料看起来不是英文：目前只支持英文材料".to_string()
        } else if raw.trim().is_empty() {
            "文件里没有读到文字".to_string()
        } else {
            format!("内容太短了，至少需要 {} 个英文单词", MIN_WORDS)
        }));
    }
    let mut blocks: Vec<String> = Vec::new();
    for (title, paragraphs) in sections {
        blocks.extend(title);
        blocks.extend(paragraphs);
    }
    let mut warnings = Vec::new();
    if cjk_lines > 0 {
        warnings.push(format!(
            "已跳过 {} 行中文（例如双语材料里的译文）",
            cjk_lines
        ));
    }
    Ok(MaterialText {
        text: blocks.join("\n\n"),
        source_label: name.to_string(),
        warnings,
    })
}

// ==================== 清理与分节 ====================

/// 页码行：`12`、`- 12 -`、`Page 3`、`Page 3 of 10`
fn is_page_number(line: &str) -> bool {
    let t = line
        .trim()
        .trim_matches(|c| c == '-' || c == '—' || c == ' ');
    if t.is_empty() {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    let rest = lower.strip_prefix("page").map(str::trim).unwrap_or(&lower);
    let mut parts = rest.split(" of ");
    let first = parts.next().unwrap_or("");
    !first.is_empty()
        && first.chars().all(|c| c.is_ascii_digit())
        && parts.all(|p| !p.trim().is_empty() && p.trim().chars().all(|c| c.is_ascii_digit()))
}

/// 字幕：去掉 WEBVTT 头、序号、时间轴、样式标签与 [音效]，连续重复的行只留一行
fn clean_subtitle(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut skip_block = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            skip_block = false;
            continue;
        }
        if skip_block {
            continue;
        }
        if line.starts_with("WEBVTT")
            || line.starts_with("NOTE")
            || line.starts_with("STYLE")
            || line.starts_with("REGION")
        {
            skip_block = true;
            continue;
        }
        if line.contains("-->") || line.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let cleaned = strip_brackets(&strip_tags(line));
        let cleaned = cleaned.trim().trim_start_matches(['-', '–']).trim();
        if cleaned.is_empty() {
            continue;
        }
        if out.last().map(String::as_str) == Some(cleaned) {
            continue;
        }
        out.push(cleaned.to_string());
    }
    out
}

/// 去掉 `<i>`、`<c.yellow>`、`{\an8}` 一类标签
pub(crate) fn strip_tags(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth_angle = false;
    let mut depth_curly = false;
    for c in line.chars() {
        match c {
            '<' => depth_angle = true,
            '>' if depth_angle => depth_angle = false,
            '{' if line.contains("{\\") => depth_curly = true,
            '}' if depth_curly => depth_curly = false,
            _ if depth_angle || depth_curly => {}
            _ => out.push(c),
        }
    }
    out
}

/// 去掉字幕里的 [Music]、(laughs) 一类音效说明
pub(crate) fn strip_brackets(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0usize;
    for c in line.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            _ if depth > 0 => {}
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Markdown 一行：去掉引用、列表、强调、行内代码、链接与图片标记；返回（文本，标题级别，是否列表项）
fn clean_markdown_line(line: &str) -> (String, Option<usize>, bool) {
    let mut t = line.trim();
    let level = t.chars().take_while(|c| *c == '#').count();
    let heading = (1..=6).contains(&level) && t[level..].starts_with(' ');
    if heading {
        t = t[level..].trim();
    }
    while let Some(rest) = t.strip_prefix('>') {
        t = rest.trim_start();
    }
    let mut list = false;
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = t.strip_prefix(marker) {
            t = rest;
            list = true;
            break;
        }
    }
    if !list {
        let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
        // 有序列表 1. / 2) ；四位数（年份 1984. …）不当列表
        if (1..=3).contains(&digits)
            && (t[digits..].starts_with(". ") || t[digits..].starts_with(") "))
        {
            t = t[digits + 2..].trim_start();
            list = true;
        }
    }
    // 图片整个去掉，链接留文字
    let mut out = String::with_capacity(t.len());
    let chars: Vec<char> = t.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if (c == '!' && chars.get(i + 1) == Some(&'[')) || c == '[' {
            let image = c == '!';
            let start = if image { i + 2 } else { i + 1 };
            if let Some(close) = chars[start..].iter().position(|c| *c == ']') {
                let close = start + close;
                if chars.get(close + 1) == Some(&'(') {
                    if let Some(end) = chars[close + 2..].iter().position(|c| *c == ')') {
                        if !image {
                            out.extend(&chars[start..close]);
                        }
                        i = close + 2 + end + 1;
                        continue;
                    }
                }
            }
        }
        match c {
            '*' | '`' => {}
            '_' if chars.get(i + 1) == Some(&'_') => {
                i += 1;
            }
            _ => out.push(c),
        }
        i += 1;
    }
    (out.trim().to_string(), heading.then_some(level), list)
}

/// 一行像不像标题：独占一段、词不多、不以句末标点结尾
fn looks_like_heading(line: &str) -> bool {
    let t = line.trim();
    let words = word_count(t);
    words > 0
        && words <= HEADING_MAX_WORDS
        && !t.ends_with([
            '.', ',', ';', ':', '!', '?', '"', '\'', '\u{201D}', '\u{2019}', '…', ')', ']', '—',
            '-',
        ])
        && t.chars()
            .next()
            .is_some_and(|c| c.is_uppercase() || c.is_ascii_digit())
}

/// 把一段里的多行连成一段文字（行尾连字符直接接上）
fn join_lines(lines: &[String]) -> String {
    let mut out = String::new();
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // 行尾连字符（inter-\nnational）直接接上；空格隔开的破折号（paused -）不接
        let hyphenated =
            out.ends_with('-') && out.chars().rev().nth(1).is_some_and(|c| c.is_alphabetic());
        if hyphenated && line.chars().next().is_some_and(|c| c.is_lowercase()) {
            out.push_str(line);
        } else {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(line);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 清理后的行 → 节与段落（段落还未分句）。返回（节，去掉的中文行数）
/// 一节：可选标题 + 段落文字（还没分句）
pub type SectionText = (Option<String>, Vec<String>);

pub fn sections_of(text: &str, kind: SourceKind) -> (Vec<SectionText>, usize) {
    let text = text
        .trim_start_matches('\u{FEFF}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace(['\u{00A0}', '\t', '\u{2009}', '\u{202F}'], " ");
    let mut cjk_lines = 0;

    // 逐行整理成「块」：Some(行) 为内容，None 为段落分隔；标题行单独标出
    enum Line {
        Text(String),
        Break,
        Heading(String),
    }
    let mut lines: Vec<Line> = Vec::new();
    match kind {
        SourceKind::Subtitle => {
            // 字幕没有段落：整段连续文字，按句子再拆篇
            for l in clean_subtitle(&text) {
                if mostly_cjk(&l) {
                    cjk_lines += 1;
                } else {
                    lines.push(Line::Text(l));
                }
            }
        }
        SourceKind::Markdown => {
            let mut in_code = false;
            for raw in text.lines() {
                let trimmed = raw.trim();
                if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                    in_code = !in_code;
                    lines.push(Line::Break);
                    continue;
                }
                if in_code
                    || trimmed.starts_with('|')
                    || trimmed.trim_matches(['-', '*', '_', ' ']).is_empty() && !trimmed.is_empty()
                {
                    // 代码块、表格、分隔线
                    lines.push(Line::Break);
                    continue;
                }
                if trimmed.is_empty() {
                    lines.push(Line::Break);
                    continue;
                }
                let (t, heading, list) = clean_markdown_line(trimmed);
                if t.is_empty() {
                    continue;
                }
                if mostly_cjk(&t) {
                    cjk_lines += 1;
                    continue;
                }
                if heading.is_some() {
                    lines.push(Line::Heading(t));
                } else {
                    if list {
                        lines.push(Line::Break);
                    }
                    lines.push(Line::Text(t));
                    if list {
                        lines.push(Line::Break);
                    }
                }
            }
        }
        SourceKind::Plain => {
            for raw in text.lines() {
                let t = raw.split_whitespace().collect::<Vec<_>>().join(" ");
                if t.is_empty() {
                    lines.push(Line::Break);
                } else if is_page_number(&t) {
                    continue;
                } else if mostly_cjk(&t) {
                    cjk_lines += 1;
                    // 双语材料里中文行也起分段作用
                    lines.push(Line::Break);
                } else {
                    lines.push(Line::Text(t));
                }
            }
        }
    }

    // 块：连续的内容行
    let mut blocks: Vec<Vec<String>> = Vec::new();
    let mut headings_at: Vec<(usize, String)> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    for line in lines {
        match line {
            Line::Text(t) => current.push(t),
            Line::Break => {
                if !current.is_empty() {
                    blocks.push(std::mem::take(&mut current));
                }
            }
            Line::Heading(h) => {
                if !current.is_empty() {
                    blocks.push(std::mem::take(&mut current));
                }
                headings_at.push((blocks.len(), h));
            }
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }

    // 纯文本没有空行、却每行都以句末标点结尾：一行一段
    let has_breaks = blocks.len() > 1;
    if kind == SourceKind::Plain && !has_breaks && blocks.len() == 1 && blocks[0].len() > 1 {
        let ends = blocks[0]
            .iter()
            .filter(|l| l.trim_end().ends_with(['.', '!', '?', '"', '\u{201D}']))
            .count();
        if ends * 10 >= blocks[0].len() * 6 {
            let first = blocks.remove(0);
            blocks = first.into_iter().map(|l| vec![l]).collect();
        }
    }

    // 纯文本：独占一块的短行当标题
    let mut sections: Vec<(Option<String>, Vec<String>)> = Vec::new();
    let mut heading_iter = headings_at.into_iter().peekable();
    let mut section: (Option<String>, Vec<String>) = (None, Vec::new());
    let heading_like: Vec<bool> = blocks
        .iter()
        .map(|b| b.len() == 1 && looks_like_heading(&b[0]))
        .collect();
    for (i, block) in blocks.into_iter().enumerate() {
        while heading_iter.peek().is_some_and(|(at, _)| *at == i) {
            let (_, h) = heading_iter.next().unwrap();
            if !section.1.is_empty() || section.0.is_some() {
                sections.push(std::mem::take(&mut section));
            }
            section.0 = Some(h);
        }
        // 标题：独占一块的短行，且后面紧跟正文段落（连续几行短句是诗歌 / 对白，留在正文里）
        if kind != SourceKind::Subtitle
            && heading_like[i]
            && heading_like.get(i + 1) == Some(&false)
        {
            if !section.1.is_empty() || section.0.is_some() {
                sections.push(std::mem::take(&mut section));
            }
            section.0 = Some(block[0].clone());
            continue;
        }
        let paragraph = join_lines(&block);
        if !paragraph.is_empty() {
            section.1.push(paragraph);
        }
    }
    if !section.1.is_empty() {
        sections.push(section);
    } else if section.0.is_some() && sections.is_empty() {
        // 只有一行“标题”：当正文
        let title = section.0.take().unwrap();
        sections.push((None, vec![title]));
    }
    (sections, cjk_lines)
}

// ==================== 分句 ====================

const ABBREVIATIONS: [&str; 30] = [
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "e.g", "i.e", "a.m",
    "p.m", "u.s", "u.k", "u.n", "no", "vol", "fig", "jan", "feb", "aug", "sept", "oct", "nov",
    "dec", "inc", "ltd",
];

/// 句末标点之后的位置是否是句子边界
fn is_boundary(chars: &[char], end: usize, term: char) -> bool {
    // end：句末标点（含其后的引号 / 括号）之后的下标
    if end >= chars.len() {
        return true;
    }
    if !chars[end].is_whitespace() {
        return false;
    }
    let next = chars[end..].iter().find(|c| !c.is_whitespace());
    let Some(&next) = next else { return true };
    if term == '.' || term == '…' {
        // 省略号后接小写：句子没完
        if next.is_lowercase() {
            return false;
        }
    } else if next.is_lowercase() && term != '!' && term != '?' {
        return false;
    }
    // ! ? 之后接小写一般是引语里的感叹（"Wow!" she said.）
    if (term == '!' || term == '?') && next.is_lowercase() {
        return false;
    }
    true
}

/// 句号前的词是不是缩写 / 首字母（Mr. / U.S. / J. K. / 3.14 不在这里切）
fn is_abbreviation(chars: &[char], dot: usize) -> bool {
    let mut start = dot;
    while start > 0 && (chars[start - 1].is_alphanumeric() || chars[start - 1] == '.') {
        start -= 1;
    }
    let word: String = chars[start..dot].iter().collect::<String>().to_lowercase();
    if word.is_empty() {
        return false;
    }
    // 单个大写字母（人名首字母）；I 是代词（So did I. Then …）
    if word.chars().count() == 1 && chars[start].is_uppercase() {
        return chars[start] != 'I';
    }
    // No. 只在后面跟数字时是缩写（No. 5）；否则是 “no.”（The answer was no. She left.）
    if word == "no" {
        return chars[dot + 1..]
            .iter()
            .find(|c| !c.is_whitespace())
            .is_some_and(|c| c.is_ascii_digit());
    }
    ABBREVIATIONS.contains(&word.as_str()) || (word.contains('.') && word.len() <= 6)
}

/// 规则分句：句末 . ! ? …（可带收尾引号 / 括号），避开缩写、首字母、小数、省略号后的小写
pub fn split_sentences(paragraph: &str) -> Vec<String> {
    let chars: Vec<char> = paragraph.chars().collect();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if matches!(c, '.' | '!' | '?' | '…') {
            // 连续的句末标点（... / ?! ）
            let mut end = i + 1;
            while end < chars.len() && matches!(chars[end], '.' | '!' | '?' | '…') {
                end += 1;
            }
            let ellipsis = c == '…' || end - i >= 3;
            let term = if ellipsis { '…' } else { chars[end - 1] };
            // 小数 3.14
            if c == '.'
                && end == i + 1
                && i > 0
                && chars[i - 1].is_ascii_digit()
                && chars.get(end).is_some_and(|c| c.is_ascii_digit())
            {
                i = end;
                continue;
            }
            // 收尾的引号、括号
            while end < chars.len()
                && matches!(chars[end], '"' | '\'' | '\u{201D}' | '\u{2019}' | ')' | ']')
            {
                end += 1;
            }
            let abbreviation = c == '.' && !ellipsis && end - i <= 2 && is_abbreviation(&chars, i);
            if !abbreviation && is_boundary(&chars, end, term) {
                let s: String = chars[start..end]
                    .iter()
                    .collect::<String>()
                    .trim()
                    .to_string();
                if !s.is_empty() {
                    out.push(s);
                }
                start = end;
            }
            i = end;
            continue;
        }
        i += 1;
    }
    let rest: String = chars[start..].iter().collect::<String>().trim().to_string();
    if !rest.is_empty() {
        out.push(rest);
    }
    // 没有字母的片段（“1984.”、“3.”）并进下一句（最后一段则并进上一句），原文一个字不丢
    let mut merged: Vec<String> = Vec::new();
    let mut carry = String::new();
    for piece in out {
        if !piece.chars().any(|c| c.is_alphabetic()) {
            carry.push_str(&piece);
            carry.push(' ');
            continue;
        }
        merged.push(format!("{}{}", carry, piece));
        carry.clear();
    }
    let carry = carry.trim();
    if !carry.is_empty() {
        match merged.last_mut() {
            Some(last) => {
                last.push(' ');
                last.push_str(carry);
            }
            None => merged.push(carry.to_string()),
        }
    }
    // 太长的“句子”（没有标点的字幕）按逗号 / 分号再切，仍太长按词数切
    merged.into_iter().flat_map(split_long).collect()
}

fn split_long(sentence: String) -> Vec<String> {
    if word_count(&sentence) <= LONG_SENTENCE_WORDS {
        return vec![sentence];
    }
    let mut pieces: Vec<String> = Vec::new();
    let mut current = String::new();
    for part in sentence.split_inclusive([',', ';']) {
        if !current.is_empty() && word_count(&current) + word_count(part) > SPLIT_CHUNK_WORDS {
            pieces.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(part);
    }
    if !current.trim().is_empty() {
        pieces.push(current.trim().to_string());
    }
    pieces
        .into_iter()
        .flat_map(|p| {
            if word_count(&p) <= LONG_SENTENCE_WORDS {
                return vec![p];
            }
            let words: Vec<&str> = p.split_whitespace().collect();
            words
                .chunks(SPLIT_CHUNK_WORDS)
                .map(|c| c.join(" "))
                .collect()
        })
        .collect()
}

// ==================== 拆篇 ====================

/// 标题兜底：文件名去后缀，或首句前几个词
fn fallback_title(source_label: &str, first_sentence: &str) -> String {
    if source_label != "粘贴的文本" {
        let stem = source_label
            .rsplit_once('.')
            .map(|(s, _)| s)
            .unwrap_or(source_label)
            .replace(['_', '-'], " ");
        let stem = stem.split_whitespace().collect::<Vec<_>>().join(" ");
        if !stem.is_empty() {
            return stem;
        }
    }
    let words: Vec<&str> = first_sentence.split_whitespace().collect();
    if words.len() <= 6 {
        first_sentence.trim_end_matches(['.', '!', '?']).to_string()
    } else {
        format!(
            "{}…",
            words[..6].join(" ").trim_end_matches([',', ';', ':'])
        )
    }
}

/// 节 → 篇：按段落累计到目标词数附近换篇，超长段落按句子切，末尾太短的并进上一篇
fn items_of_section(paragraphs: &[Vec<String>], target: usize) -> Vec<Vec<ImportSentence>> {
    let max = target * 13 / 10;
    let mut items: Vec<Vec<ImportSentence>> = Vec::new();
    let mut current: Vec<ImportSentence> = Vec::new();
    let mut words = 0usize;
    let flush = |items: &mut Vec<Vec<ImportSentence>>,
                 current: &mut Vec<ImportSentence>,
                 words: &mut usize| {
        if !current.is_empty() {
            items.push(std::mem::take(current));
            *words = 0;
        }
    };
    for paragraph in paragraphs {
        let pw: usize = paragraph.iter().map(|s| word_count(s)).sum();
        if words > 0 && words + pw > max && words >= target / 2 {
            flush(&mut items, &mut current, &mut words);
        }
        for (i, sentence) in paragraph.iter().enumerate() {
            let sw = word_count(sentence);
            // 超长段落：在句子处换篇
            if words > 0 && (words + sw > max || current.len() >= MAX_SENTENCES_PER_ITEM) {
                flush(&mut items, &mut current, &mut words);
            }
            current.push(ImportSentence {
                en: sentence.clone(),
                paragraph: i == 0 || current.is_empty(),
            });
            words += sw;
        }
    }
    flush(&mut items, &mut current, &mut words);
    // 末尾太短（不到目标的 30%）并进上一篇
    if items.len() >= 2 {
        let last_words: usize = items
            .last()
            .unwrap()
            .iter()
            .map(|s| word_count(&s.en))
            .sum();
        let prev_len = items[items.len() - 2].len();
        if last_words * 10 < target * 3
            && prev_len + items.last().unwrap().len() <= MAX_SENTENCES_PER_ITEM
        {
            let last = items.pop().unwrap();
            items.last_mut().unwrap().extend(last);
        }
    }
    items
}

/// 预处理：清理 → 分节分段分句 → 拆篇 → 预览
pub fn prepare(
    text: &str,
    kind: SourceKind,
    source_label: &str,
    target_words: Option<i64>,
) -> AppResult<ImportPreview> {
    let target = target_words
        .unwrap_or(DEFAULT_TARGET_WORDS)
        .clamp(*TARGET_WORDS_RANGE.start(), *TARGET_WORDS_RANGE.end()) as usize;
    let mut warnings = Vec::new();
    if text.trim().is_empty() {
        return Err(AppError::ValidationError(
            "没有读到文字：请粘贴英文内容，或换一个文件".to_string(),
        ));
    }
    let (sections, cjk_lines) = sections_of(text, kind);
    let english_words: usize = sections
        .iter()
        .flat_map(|(_, ps)| ps.iter())
        .map(|p| word_count(p))
        .sum();
    if english_words < MIN_WORDS {
        return Err(AppError::ValidationError(if cjk_lines > 0 {
            "这份材料看起来不是英文：目前只支持导入英文材料".to_string()
        } else {
            format!("内容太短了，至少需要 {} 个英文单词", MIN_WORDS)
        }));
    }
    if cjk_lines > 0 {
        warnings.push(format!(
            "已跳过 {} 行中文（例如双语材料里的译文），导入后会重新翻译",
            cjk_lines
        ));
    }

    // 分句，并在总词数上限处截断
    let mut total = 0usize;
    let mut truncated = false;
    let mut split_sections: Vec<(Option<String>, Vec<Vec<String>>)> = Vec::new();
    'outer: for (title, paragraphs) in sections {
        let mut ps: Vec<Vec<String>> = Vec::new();
        for paragraph in paragraphs {
            let mut sentences = Vec::new();
            for s in split_sentences(&paragraph) {
                if !s.chars().any(|c| c.is_ascii_alphabetic()) {
                    continue;
                }
                let w = word_count(&s);
                if total + w > MAX_TOTAL_WORDS {
                    truncated = true;
                    if !sentences.is_empty() {
                        ps.push(sentences);
                    }
                    split_sections.push((title, ps));
                    break 'outer;
                }
                total += w;
                sentences.push(s);
            }
            if !sentences.is_empty() {
                ps.push(sentences);
            }
        }
        if !ps.is_empty() {
            split_sections.push((title, ps));
        }
    }
    if truncated {
        warnings.push(format!(
            "材料超过 {} 个单词，只导入了前面的部分",
            MAX_TOTAL_WORDS
        ));
    }

    let mut items: Vec<ImportPreviewItem> = Vec::new();
    let doc_title = split_sections.first().and_then(|(t, _)| t.clone());
    for (title, paragraphs) in &split_sections {
        let parts = items_of_section(paragraphs, target);
        let count = parts.len();
        for (i, sentences) in parts.into_iter().enumerate() {
            let base = title
                .clone()
                .or_else(|| doc_title.clone())
                .unwrap_or_else(|| fallback_title(source_label, &sentences[0].en));
            let title = if count > 1 {
                format!("{} ({})", base, i + 1)
            } else {
                base
            };
            let word_count = sentences.iter().map(|s| word_count(&s.en)).sum::<usize>() as i64;
            items.push(ImportPreviewItem {
                title,
                sentences,
                word_count,
            });
        }
    }
    if items.len() > MAX_ITEMS {
        warnings.push(format!(
            "材料拆成了 {} 篇，一次最多导入 {} 篇，只保留了前 {} 篇",
            items.len(),
            MAX_ITEMS,
            MAX_ITEMS
        ));
        items.truncate(MAX_ITEMS);
    }
    let total_words = items.iter().map(|i| i.word_count).sum();
    Ok(ImportPreview {
        source_label: source_label.to_string(),
        items,
        total_words,
        warnings,
    })
}

/// 命令入口：有文件时先读取（同 `read_material`）；只有文本时按已清理的纯文本处理，
/// 来源名取 `fileName`（先读过文件再编辑的情况）或「粘贴的文本」
pub fn prepare_request(request: &PrepareImportRequest) -> AppResult<ImportPreview> {
    if let Some(data) = request.file_base64.as_deref().filter(|d| !d.is_empty()) {
        let material = read_material(request.file_name.as_deref().unwrap_or(""), data)?;
        let mut preview = prepare(
            &material.text,
            SourceKind::Plain,
            &material.source_label,
            request.target_words,
        )?;
        let mut warnings = material.warnings;
        warnings.append(&mut preview.warnings);
        preview.warnings = warnings;
        return Ok(preview);
    }
    let label = request
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("粘贴的文本");
    prepare(
        request.text.as_deref().unwrap_or(""),
        SourceKind::Plain,
        label,
        request.target_words,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sentences_but_not_abbreviations_decimals_or_initials() {
        let s = split_sentences(
            "Mr. Smith paid $3.50 at 9 a.m. today. J. K. Rowling wrote it! Did you know? \"Yes,\" she said. Wait... it was late. The U.S. team won.",
        );
        assert_eq!(
            s,
            vec![
                "Mr. Smith paid $3.50 at 9 a.m. today.",
                "J. K. Rowling wrote it!",
                "Did you know?",
                "\"Yes,\" she said.",
                "Wait... it was late.",
                "The U.S. team won.",
            ]
        );
        // 收尾引号跟着句子走；感叹后接小写不切
        assert_eq!(
            split_sentences("\"Run!\" he shouted. \"Wow!\" said Tom. It's fine."),
            vec!["\"Run!\" he shouted.", "\"Wow!\" said Tom.", "It's fine."]
        );
        assert_eq!(
            split_sentences("No punctuation at the end"),
            vec!["No punctuation at the end"]
        );
        assert_eq!(
            split_sentences("The answer was no. She left. So did I. Then we saw No. 5 bus."),
            vec![
                "The answer was no.",
                "She left.",
                "So did I.",
                "Then we saw No. 5 bus."
            ]
        );
    }

    #[test]
    fn long_unpunctuated_text_is_cut_into_readable_pieces() {
        let long = (0..70)
            .map(|i| format!("word{}", i % 7))
            .collect::<Vec<_>>()
            .join(" ");
        let pieces = split_sentences(&long);
        assert!(pieces.len() >= 2);
        assert!(pieces.iter().all(|p| word_count(p) <= LONG_SENTENCE_WORDS));
        // 原文的词一个不少
        assert_eq!(pieces.join(" "), long);
    }

    #[test]
    fn plain_text_keeps_title_paragraphs_and_original_words() {
        let text = "The Lost Kite\n\nTom had a red kite. It flew\nvery high in the sky.\n\n12\n\nThen the wind\nstopped. The kite fell into a tree.\n";
        let preview = prepare(text, SourceKind::Plain, "粘贴的文本", None).unwrap();
        assert_eq!(preview.items.len(), 1);
        let item = &preview.items[0];
        assert_eq!(item.title, "The Lost Kite");
        let en: Vec<&str> = item.sentences.iter().map(|s| s.en.as_str()).collect();
        assert_eq!(
            en,
            [
                "Tom had a red kite.",
                "It flew very high in the sky.",
                "Then the wind stopped.",
                "The kite fell into a tree.",
            ]
        );
        assert_eq!(
            item.sentences
                .iter()
                .map(|s| s.paragraph)
                .collect::<Vec<_>>(),
            [true, false, true, false]
        );
        assert_eq!(item.word_count, 22);
        assert!(preview.warnings.is_empty());
    }

    #[test]
    fn one_sentence_per_line_text_becomes_paragraphs_and_chinese_lines_are_skipped() {
        let text = "I like apples.\n我喜欢苹果。\nShe has a cat.\n她有一只猫。\nWe go to school every day.\n";
        let preview = prepare(text, SourceKind::Plain, "lesson-3.txt", None).unwrap();
        let item = &preview.items[0];
        assert_eq!(item.title, "lesson 3");
        assert_eq!(item.sentences.len(), 3);
        assert!(item.sentences.iter().all(|s| s.paragraph));
        assert_eq!(preview.warnings.len(), 1);
    }

    #[test]
    fn markdown_headings_split_sections_and_markup_is_removed() {
        let text = "# My Trip\n\nWe went to **Paris** and saw the [Eiffel Tower](https://x.y).\n\n![photo](a.png)\n\n## Day Two\n\n- We ate `bread`.\n- We took a boat.\n\n```\ncode here\n```\n";
        let preview = prepare(text, SourceKind::Markdown, "trip.md", None).unwrap();
        assert_eq!(preview.items.len(), 2);
        assert_eq!(preview.items[0].title, "My Trip");
        assert_eq!(
            preview.items[0].sentences[0].en,
            "We went to Paris and saw the Eiffel Tower."
        );
        assert_eq!(preview.items[1].title, "Day Two");
        let en: Vec<&str> = preview.items[1]
            .sentences
            .iter()
            .map(|s| s.en.as_str())
            .collect();
        assert_eq!(en, ["We ate bread.", "We took a boat."]);
    }

    #[test]
    fn subtitles_drop_timing_tags_and_repeats() {
        let srt = "1\n00:00:01,000 --> 00:00:03,000\n<i>Hello there, my friend.</i>\n\n2\n00:00:03,500 --> 00:00:05,000\n[Music]\nHello there, my friend.\nHow are you\n\n3\n00:00:05,500 --> 00:00:07,000\ntoday? I am fine, thank you.\n";
        let preview = prepare(srt, SourceKind::Subtitle, "talk.srt", None).unwrap();
        let en: Vec<&str> = preview.items[0]
            .sentences
            .iter()
            .map(|s| s.en.as_str())
            .collect();
        assert_eq!(
            en,
            [
                "Hello there, my friend.",
                "How are you today?",
                "I am fine, thank you."
            ]
        );
        let vtt = "WEBVTT\n\nNOTE comment\nignored\n\n00:00.000 --> 00:02.000\n- Where is the station?\n\n00:02.000 --> 00:04.000\n- It is next to the bank, on the left.\n";
        let preview = prepare(vtt, SourceKind::Subtitle, "a.vtt", None).unwrap();
        assert_eq!(preview.items[0].sentences.len(), 2);
    }

    #[test]
    fn long_material_is_split_into_items_near_target_words() {
        // 12 段，每段 50 词左右
        let paragraph =
            "The little fox ran across the green field and looked for food near the old farm. "
                .repeat(3);
        let text = (0..12)
            .map(|_| paragraph.trim().to_string())
            .collect::<Vec<_>>()
            .join("\n\n");
        let preview = prepare(&text, SourceKind::Plain, "粘贴的文本", Some(200)).unwrap();
        assert!(preview.items.len() >= 3, "{}", preview.items.len());
        for item in &preview.items {
            assert!(item.word_count <= 260, "{}", item.word_count);
            assert!(item.sentences[0].paragraph);
        }
        assert!(preview.items[0].title.ends_with("(1)"));
        assert_eq!(
            preview.total_words,
            preview.items.iter().map(|i| i.word_count).sum::<i64>()
        );
    }

    #[test]
    fn short_lines_stay_in_the_text_unless_they_head_a_paragraph() {
        // 对白与诗行（连续短行、或以引号 / 省略号结尾）不能被当成标题吃掉
        let text = "\u{2018}Come here,\u{2019} said Mum\u{2019}\n\nAnd then it was gone\u{2026}\n\nRoses are red\n\nViolets are blue\n\nThe garden was quiet that night, and nobody spoke at all.\n";
        let preview = prepare(text, SourceKind::Plain, "粘贴的文本", None).unwrap();
        let en: Vec<&str> = preview.items[0]
            .sentences
            .iter()
            .map(|s| s.en.as_str())
            .collect();
        assert!(
            en.contains(&"\u{2018}Come here,\u{2019} said Mum\u{2019}"),
            "{en:?}"
        );
        assert!(en.contains(&"And then it was gone\u{2026}"), "{en:?}");
        assert!(en.contains(&"Roses are red"), "{en:?}");
        // 年份开头的 Markdown 行不当有序列表；空格隔开的破折号不与下一行连写
        let md = "1984. That year we moved to a new town by the sea.\n";
        let preview = prepare(md, SourceKind::Markdown, "a.md", None).unwrap();
        assert!(preview.items[0].sentences[0].en.starts_with("1984."));
        let dash = "He paused -\nand left the room without a word that day.\n";
        let preview = prepare(dash, SourceKind::Plain, "粘贴的文本", None).unwrap();
        assert_eq!(
            preview.items[0].sentences[0].en,
            "He paused - and left the room without a word that day."
        );
    }

    #[test]
    fn rejects_empty_short_and_non_english_material() {
        assert!(prepare("   ", SourceKind::Plain, "粘贴的文本", None).is_err());
        assert!(prepare("Hello world.", SourceKind::Plain, "粘贴的文本", None).is_err());
        let err = prepare(
            "今天天气很好。\n我们去公园玩。",
            SourceKind::Plain,
            "粘贴的文本",
            None,
        )
        .unwrap_err();
        assert!(err.to_string().contains("不是英文"));
    }

    #[test]
    fn decodes_utf16_and_gbk_text() {
        let text = "Hello, world. 你好";
        let mut utf16: Vec<u8> = vec![0xFF, 0xFE];
        for u in text.encode_utf16() {
            utf16.extend(u.to_le_bytes());
        }
        assert_eq!(decode_text(&utf16), text);
        let (gbk, _, _) = encoding_rs::GBK.encode(text);
        assert_eq!(decode_text(&gbk), text);
        assert_eq!(decode_text(text.as_bytes()), text);
    }

    #[test]
    fn read_material_cleans_files_and_prepare_reuses_it() {
        use base64::Engine;
        let encode = |s: &str| base64::engine::general_purpose::STANDARD.encode(s.as_bytes());
        let srt = "1\n00:00:01,000 --> 00:00:03,000\nWhere is the station?\n\n2\n00:00:03,000 --> 00:00:05,000\nIt is next to the bank, on the left side.\n";
        let m = read_material("talk.srt", &encode(srt)).unwrap();
        assert_eq!(
            m.text,
            "Where is the station? It is next to the bank, on the left side."
        );
        assert_eq!(m.source_label, "talk.srt");
        let md =
            "# My Trip\n\nWe went to **Paris** and saw the tower.\n\nIt was a sunny day in June.\n";
        let m = read_material("trip.md", &encode(md)).unwrap();
        assert_eq!(
            m.text,
            "My Trip\n\nWe went to Paris and saw the tower.\n\nIt was a sunny day in June."
        );
        // 读过再编辑：{ text, fileName } 按纯文本处理，来源名用文件名；标题行仍当标题
        let preview = prepare_request(&PrepareImportRequest {
            text: Some(m.text.clone()),
            file_name: Some("trip.md".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(preview.source_label, "trip.md");
        assert_eq!(preview.items[0].title, "My Trip");
        assert_eq!(preview.items[0].sentences.len(), 2);
        assert!(read_material("a.exe", &encode("x")).is_err());
        assert!(read_material("a.txt", &encode("今天天气很好。")).is_err());
    }

    #[test]
    fn file_kinds_and_page_numbers() {
        assert_eq!(kind_of(Some("a.SRT")).unwrap().0, SourceKind::Subtitle);
        assert!(kind_of(Some("a.exe")).is_err());
        assert!(is_page_number("12"));
        assert!(is_page_number("Page 3 of 10"));
        assert!(is_page_number("- 7 -"));
        assert!(!is_page_number("3 cats"));
    }
}
