//! 工具调用意图：每个工具多一个必填参数 `reason`，模型用一句话写给学习者看「这一步要做什么」，
//! 界面在工具执行时显示它（取自模型的工具调用参数）；执行前从参数里拿掉，工具本身不用关心。

use rmcp::model::{CallToolRequestParams, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

/// 参数名与说明（与 sidecar 自己的工具一致：agent/src/tools/reason.ts）
pub const REASON: &str = "reason";
const REASON_DESCRIPTION: &str = "One short sentence in Chinese telling the learner what this step is for, e.g. 「查一下你学过的机场英语词」. Shown to the learner as the step's progress text; no ids, tool names or English jargon.";

/// 工具清单：给每个工具的参数加上必填的 `reason`
pub fn with_reason(mut tool: Tool) -> Tool {
    let mut schema = (*tool.input_schema).clone();
    let properties = schema.entry("properties").or_insert_with(|| json!({}));
    if let Value::Object(properties) = properties {
        properties.insert(
            REASON.to_string(),
            json!({ "type": "string", "description": REASON_DESCRIPTION }),
        );
    }
    let required = schema.entry("required").or_insert_with(|| json!([]));
    if let Value::Array(required) = required {
        if !required.iter().any(|r| r == REASON) {
            required.insert(0, json!(REASON));
        }
    }
    schema.entry("type").or_insert_with(|| json!("object"));
    tool.input_schema = Arc::new(schema);
    tool
}

/// 调用前拿掉 `reason`，返回它
pub fn take_reason(request: &mut CallToolRequestParams) -> Option<String> {
    request
        .arguments
        .as_mut()
        .and_then(|args| args.remove(REASON))
        .and_then(|v| v.as_str().map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reason_is_required_and_removed_before_the_call() {
        let schema = json!({ "type": "object", "properties": { "words": { "type": "array" } }, "required": ["words"] });
        let tool = with_reason(Tool::new(
            "lookup_words",
            "Look up words",
            Arc::new(schema.as_object().unwrap().clone()),
        ));
        assert_eq!(tool.input_schema["required"], json!(["reason", "words"]));
        assert_eq!(tool.input_schema["properties"]["reason"]["type"], "string");
        // 没有参数的工具也加上
        let empty = with_reason(Tool::new(
            "list_word_books",
            "List",
            Arc::new(Default::default()),
        ));
        assert_eq!(empty.input_schema["required"], json!(["reason"]));

        let mut request: CallToolRequestParams = serde_json::from_value(json!({
            "name": "lookup_words",
            "arguments": { "reason": "查一下你学过没有", "words": ["itinerary"] }
        }))
        .unwrap();
        assert_eq!(
            take_reason(&mut request).as_deref(),
            Some("查一下你学过没有")
        );
        assert_eq!(
            request.arguments.unwrap(),
            *json!({ "words": ["itinerary"] }).as_object().unwrap()
        );
    }
}
