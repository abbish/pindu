//! 命令处理器共享辅助函数

/// 根据表名简单分类表类型  
pub fn classify_table_type(table_name: &str) -> &'static str {
    match table_name {
        "ai_providers" | "ai_models" | "theme_tags" => "config",
        _ => "user_data",
    }
}
