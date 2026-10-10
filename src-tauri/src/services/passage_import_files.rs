//! 导入材料：从 Word（.docx）与 PDF 里取出文字（只取文字层；扫描件不做 OCR）。
//! 输出是普通文本：段落之间空一行，交给 `passage_import` 统一清理、分句。

use crate::error::{AppError, AppResult};
use quick_xml::events::Event;
use std::io::Read;

fn unreadable(what: &str) -> AppError {
    AppError::ValidationError(format!("{}读取失败：文件可能已损坏或加了密码", what))
}

/// .docx：读 word/document.xml，每个段落（w:p）一段，w:tab 记为空格，w:br 记为换行
pub fn docx_text(bytes: &[u8]) -> AppResult<String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| unreadable("Word 文件"))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| unreadable("Word 文件"))?
        .read_to_string(&mut xml)
        .map_err(|_| unreadable("Word 文件"))?;

    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut out = String::new();
    let mut paragraph = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == "w:t" => in_text = true,
            Ok(Event::End(e)) if e.name().as_ref() == "w:t" => in_text = false,
            Ok(Event::Text(t)) if in_text => {
                let text = t.xml10_content();
                let text = quick_xml::escape::unescape(&text)
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| text.into_owned());
                paragraph.push_str(&text);
            }
            Ok(Event::GeneralRef(r)) if in_text => {
                // &#34; / &#x2019; 字符引用与 &amp; 一类实体；认不出的原样保留，不丢字
                match r.resolve_char_ref() {
                    Ok(Some(c)) => paragraph.push(c),
                    _ => {
                        let name = r.xml10_content();
                        match quick_xml::escape::resolve_predefined_entity(&name) {
                            Some(c) => paragraph.push_str(c),
                            None => {
                                paragraph.push('&');
                                paragraph.push_str(&name);
                                paragraph.push(';');
                            }
                        }
                    }
                }
            }
            Ok(Event::Empty(e)) if e.name().as_ref() == "w:tab" => paragraph.push(' '),
            Ok(Event::Empty(e)) if e.name().as_ref() == "w:br" => paragraph.push('\n'),
            Ok(Event::End(e)) if e.name().as_ref() == "w:p" => {
                let p = paragraph.trim();
                if !p.is_empty() {
                    out.push_str(p);
                    out.push_str("\n\n");
                }
                paragraph.clear();
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(unreadable("Word 文件")),
            _ => {}
        }
    }
    if out.trim().is_empty() {
        return Err(AppError::ValidationError(
            "这个 Word 文件里没有文字".to_string(),
        ));
    }
    Ok(out)
}

/// PDF：取文字层；没有文字（扫描件）时提示
pub fn pdf_text(bytes: &[u8]) -> AppResult<String> {
    // 第三方解析库遇到少见的 PDF 结构可能 panic：兜住，按“读取失败”处理
    let bytes = bytes.to_vec();
    let text = std::panic::catch_unwind(move || pdf_extract::extract_text_from_mem(&bytes))
        .map_err(|_| unreadable("PDF"))?
        .map_err(|_| unreadable("PDF"))?;
    if text.chars().filter(|c| c.is_alphabetic()).count() < 10 {
        return Err(AppError::ValidationError(
            "这个 PDF 没有可读取的文字（可能是扫描件或图片），请换成文字版 PDF 或直接粘贴文字"
                .to_string(),
        ));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn docx(document_xml: &str) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("word/document.xml", options).unwrap();
            zip.write_all(document_xml.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn docx_character_references_are_kept() {
        let xml = r#"<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
            <w:p><w:r><w:t>They said &#34;Hello&#34; at the caf&#xE9; &amp; it&#x2019;s fine &#xD800; &foo;.</w:t></w:r></w:p>
            </w:body></w:document>"#;
        assert_eq!(
            docx_text(&docx(xml)).unwrap(),
            "They said \"Hello\" at the caf\u{e9} & it\u{2019}s fine &#xD800; &foo;.\n\n"
        );
    }

    #[test]
    fn docx_paragraphs_runs_and_entities() {
        let xml = r#"<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
            <w:p><w:r><w:t>A Day at the Zoo</w:t></w:r></w:p>
            <w:p><w:r><w:t xml:space="preserve">Tom &amp; Amy saw </w:t></w:r><w:r><w:t>a lion.</w:t></w:r><w:r><w:tab/><w:t>It was big.</w:t></w:r></w:p>
            <w:p></w:p>
            </w:body></w:document>"#;
        let text = docx_text(&docx(xml)).unwrap();
        assert_eq!(
            text,
            "A Day at the Zoo\n\nTom & Amy saw a lion. It was big.\n\n"
        );
        // 交给预处理：首段成为标题
        let preview = crate::services::passage_import::prepare(
            &text,
            crate::services::passage_import::SourceKind::Plain,
            "zoo.docx",
            None,
        );
        assert!(preview.is_err(), "不足 10 个词时拒绝");
    }

    #[test]
    fn broken_files_are_rejected_with_user_facing_reasons() {
        assert!(docx_text(b"not a zip").is_err());
        let err = pdf_text(b"%PDF-1.4 garbage").unwrap_err();
        assert!(err.to_string().contains("PDF"));
    }
}
