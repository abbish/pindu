//! 推荐追问：讲解与答疑的回答末尾附一段追问（`FOLLOW_UP_MARKER` 之后每行一个），
//! 这里把它从正文里拆出来、校正，并在流式输出时挡住标记之后的内容。

/// 正文与追问之间的分隔行（提示词要求模型原样输出）
pub const FOLLOW_UP_MARKER: &str = "<<<追问>>>";
/// 最多保留几个追问
pub const MAX_FOLLOW_UPS: usize = 3;
/// 单个追问的长度上限（字符）
const MAX_FOLLOW_UP_CHARS: usize = 30;

/// 去掉标点与空白后比较，用于去重
fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// 一行追问：去掉列表符号、编号与引号，太长或为空返回 None
fn clean_line(line: &str) -> Option<String> {
    let mut text = line.trim();
    text = text.trim_start_matches(['-', '*', '•', '·', ' ']);
    let digits = text.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 {
        let rest = &text[digits..];
        if let Some(stripped) = rest
            .strip_prefix('.')
            .or_else(|| rest.strip_prefix('、'))
            .or_else(|| rest.strip_prefix(')'))
        {
            text = stripped;
        }
    }
    let text = text
        .trim()
        .trim_matches(|c| matches!(c, '"' | '“' | '”' | '「' | '」' | '*' | '`'))
        .trim();
    let count = text.chars().count();
    (count > 0 && count <= MAX_FOLLOW_UP_CHARS).then(|| text.to_string())
}

/// 分隔行去掉加粗、行内代码与空白后剩下的部分
fn marker_body(line: &str) -> &str {
    line.trim_matches(|c: char| c.is_whitespace() || matches!(c, '*' | '`'))
}

/// 一整行是不是分隔行：完整的 `<<<追问>>>`，或模型偶尔只写的 `<<<`、`<<<追问`、`<<< 追问 >>>`
fn is_marker_line(line: &str) -> bool {
    let body = marker_body(line);
    body.starts_with("<<<")
        && body
            .chars()
            .all(|c| c.is_whitespace() || matches!(c, '<' | '>' | '追' | '问'))
}

/// 还没写完的一行可能会成为分隔行（流式输出时先不转发）
fn may_become_marker_line(line: &str) -> bool {
    let body = marker_body(line);
    if body.len() < 3 {
        return "<<<".starts_with(body);
    }
    is_marker_line(body)
}

/// 分隔行的位置：（正文结束处，追问开始处）。完整标记在哪里都算；只写了 `<<<` 之类的要独占一行
fn find_marker(text: &str) -> Option<(usize, usize)> {
    if let Some(pos) = text.find(FOLLOW_UP_MARKER) {
        return Some((pos, pos + FOLLOW_UP_MARKER.len()));
    }
    let mut start = 0;
    for line in text.split_inclusive('\n') {
        if is_marker_line(line) {
            return Some((start, start + line.len()));
        }
        start += line.len();
    }
    None
}

/// 把模型输出拆成正文与追问：没有分隔行时追问为空；`asked` 是学习者已经问过的问题（不再推荐）
pub fn split(text: &str, asked: &[&str]) -> (String, Vec<String>) {
    let Some((pos, after)) = find_marker(text) else {
        return (text.trim().to_string(), Vec::new());
    };
    // 模型偶尔把分隔行加粗或放进行内代码：去掉正文末尾残留的符号
    let content = text[..pos]
        .trim_end()
        .trim_end_matches(['*', '`'])
        .trim_end()
        .to_string();
    let mut seen: Vec<String> = asked.iter().map(|q| normalize(q)).collect();
    let mut follow_ups = Vec::new();
    for line in text[after..].lines() {
        let Some(item) = clean_line(line) else {
            continue;
        };
        let key = normalize(&item);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key);
        follow_ups.push(item);
        if follow_ups.len() == MAX_FOLLOW_UPS {
            break;
        }
    }
    (content, follow_ups)
}

/// 流式输出闸门：转发分隔行之前的文字，分隔行（含可能是它开头的半截）之后的不再转发
#[derive(Default)]
pub struct StreamGate {
    buffer: String,
    emitted: usize,
    closed: bool,
}

impl StreamGate {
    /// 收到一段增量，返回这次可以转发给前端的文字（可能为空）
    pub fn push(&mut self, delta: &str) -> String {
        if self.closed {
            return String::new();
        }
        self.buffer.push_str(delta);
        let end = match self.marker_start() {
            Some(pos) => {
                self.closed = true;
                pos
            }
            None => self.buffer.len() - self.pending_len(),
        };
        let out = self.buffer[self.emitted..end].to_string();
        self.emitted = end;
        out
    }

    /// 还没转发的部分里分隔行开始的位置：完整标记，或独占一行、已经写完的 `<<<`
    fn marker_start(&self) -> Option<usize> {
        let tail = &self.buffer[self.emitted..];
        if let Some(pos) = tail.find(FOLLOW_UP_MARKER) {
            return Some(self.emitted + pos);
        }
        let mut start = self.emitted;
        for line in tail.split_inclusive('\n') {
            let at_line_start = start == 0 || self.buffer[..start].ends_with('\n');
            if line.ends_with('\n') && at_line_start && is_marker_line(line) {
                return Some(start);
            }
            start += line.len();
        }
        None
    }

    /// 末尾先不转发的长度：可能是完整标记开头的半截，或可能成为分隔行的最后一行（等写完再判断）
    fn pending_len(&self) -> usize {
        let tail = &self.buffer[self.emitted..];
        let prefix = tail
            .char_indices()
            .map(|(i, _)| &tail[i..])
            .find(|suffix| FOLLOW_UP_MARKER.starts_with(suffix))
            .map_or(0, str::len);
        let line_start = self.buffer.rfind('\n').map_or(0, |i| i + 1);
        let last_line =
            if line_start >= self.emitted && may_become_marker_line(&self.buffer[line_start..]) {
                self.buffer.len() - line_start
            } else {
                0
            };
        prefix.max(last_line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_content_and_cleans_follow_ups() {
        let text = "## 讲解\n正文内容。\n\n**<<<追问>>>**\n- 为什么 x 读 /ks/？\n2. 「tax 和 tacks 读音一样吗？」\n- \n- 为什么x读/ks/\n- 这是一个特别特别特别特别特别特别特别特别特别特别特别长的追问问题吗？\n- 我刚问过的问题\n- 能用 tax 造个句吗？\n- 第四个";
        let (content, follow_ups) = split(text, &["我刚问过的问题？"]);
        assert_eq!(content, "## 讲解\n正文内容。");
        assert_eq!(
            follow_ups,
            vec![
                "为什么 x 读 /ks/？",
                "tax 和 tacks 读音一样吗？",
                "能用 tax 造个句吗？"
            ]
        );
        let (content, follow_ups) = split("  只有正文  ", &[]);
        assert_eq!((content.as_str(), follow_ups.len()), ("只有正文", 0));
    }

    #[test]
    fn gate_forwards_text_before_marker_across_chunk_boundaries() {
        let full = "正文 a < b。\n<<<追问>>>\n- 问题？";
        // 按每个字符切成增量，模拟最坏的分片
        let mut gate = StreamGate::default();
        let forwarded: String = full.chars().map(|c| gate.push(&c.to_string())).collect();
        assert_eq!(forwarded, "正文 a < b。\n");
        // 像分隔行开头、其实不是的文字最终会被转发
        let mut gate = StreamGate::default();
        let mut out = gate.push("比较 <<");
        out += &gate.push("< 符号");
        assert_eq!(out, "比较 <<< 符号");
    }

    #[test]
    fn bare_angle_brackets_line_is_the_marker() {
        // 模型只写了 `<<<`（发布回归 R10 实测）
        let full =
            "## 想一想\n试着说一句。\n<<<\n- aisle 的 s 真的不发音吗？\n- 还有哪些座位说法？";
        let (content, follow_ups) = split(full, &[]);
        assert_eq!(content, "## 想一想\n试着说一句。");
        assert_eq!(
            follow_ups,
            vec!["aisle 的 s 真的不发音吗？", "还有哪些座位说法？"]
        );
        for variant in ["**<<<追问**", "<<< 追问 >>>", "`<<<`"] {
            let (content, follow_ups) = split(&format!("正文\n{variant}\n- 问题？"), &[]);
            assert_eq!(
                (content.as_str(), follow_ups.len()),
                ("正文", 1),
                "{variant}"
            );
        }
        // 行中间的 <<< 不是分隔行
        assert_eq!(
            split("比较 <<< 符号\n下一行", &[]).0,
            "比较 <<< 符号\n下一行"
        );
        // 流式：逐字推送，分隔行和后面的追问都不转发
        let mut gate = StreamGate::default();
        let forwarded: String = full.chars().map(|c| gate.push(&c.to_string())).collect();
        assert_eq!(forwarded, "## 想一想\n试着说一句。\n");
        // 以 << 开头、其实不是分隔行的一行照常转发
        let mut gate = StreamGate::default();
        let out: String = "a\n<<b 不是\nc"
            .chars()
            .map(|c| gate.push(&c.to_string()))
            .collect();
        assert_eq!(out, "a\n<<b 不是\nc");
    }
}
