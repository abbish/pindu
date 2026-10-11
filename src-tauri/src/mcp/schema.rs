//! 工具参数 schema 给模型之前展开 `$ref`：嵌套的结构体（如计划里的短文 `PlanPassage`）由 schemars 放在 `$defs` 里引用。
//! pi 按 schema 把模型写成字符串的数字转回数字时不跟 `$ref`，部分模型也不认引用（自己编字段名），
//! 嵌套的 id 就过不了校验（"passages.0.passage_id: must be integer"）。展开后每层都是直接的属性。

use rmcp::model::Tool;
use serde_json::{Map, Value};
use std::sync::Arc;

/// 展开的最大层数：自引用的类型到这里就只留 `{"type": "object"}`
const MAX_DEPTH: usize = 8;

/// 工具清单：参数 schema 里的 `$ref` 换成被引用的定义，去掉 `$defs` / `definitions`
pub fn inline_refs(mut tool: Tool) -> Tool {
    let mut schema = (*tool.input_schema).clone();
    let mut defs = Map::new();
    for key in ["$defs", "definitions"] {
        if let Some(Value::Object(d)) = schema.remove(key) {
            defs.extend(d);
        }
    }
    if defs.is_empty() {
        return tool;
    }
    for value in schema.values_mut() {
        inline(value, &defs, 0);
    }
    tool.input_schema = Arc::new(schema);
    tool
}

fn inline(value: &mut Value, defs: &Map<String, Value>, depth: usize) {
    match value {
        Value::Object(obj) => {
            let target = obj
                .get("$ref")
                .and_then(Value::as_str)
                .and_then(|r| {
                    r.strip_prefix("#/$defs/")
                        .or_else(|| r.strip_prefix("#/definitions/"))
                })
                .map(str::to_string);
            if let Some(name) = target {
                obj.remove("$ref");
                let resolved = match defs.get(&name) {
                    Some(Value::Object(def)) if depth < MAX_DEPTH => {
                        let mut def = Value::Object(def.clone());
                        inline(&mut def, defs, depth + 1);
                        def
                    }
                    _ => serde_json::json!({ "type": "object" }),
                };
                // 引用处自己的说明（字段注释）优先
                if let Value::Object(def) = resolved {
                    for (k, v) in def {
                        obj.entry(k).or_insert(v);
                    }
                }
                return;
            }
            for v in obj.values_mut() {
                inline(v, defs, depth);
            }
        }
        Value::Array(items) => {
            for v in items {
                inline(v, defs, depth);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_reference_stops_and_field_description_wins() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "node": { "$ref": "#/$defs/Node", "description": "the root" } },
            "$defs": { "Node": { "type": "object", "description": "a node", "properties": { "next": { "$ref": "#/$defs/Node" } } } }
        });
        let tool = inline_refs(Tool::new(
            "t",
            "",
            Arc::new(schema.as_object().unwrap().clone()),
        ));
        let node = &tool.input_schema["properties"]["node"];
        assert_eq!(node["description"], "the root");
        assert!(!serde_json::to_string(node).unwrap().contains("$ref"));
    }
}
