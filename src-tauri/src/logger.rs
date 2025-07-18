use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use chrono::Local;
use serde_json::json;

#[derive(Debug, Clone)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

impl LogLevel {
    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Debug => "DEBUG",
        }
    }
}

pub struct Logger {
    log_file_path: PathBuf,
}

impl Logger {
    pub fn new(app_data_dir: &PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let log_dir = app_data_dir.join("logs");
        std::fs::create_dir_all(&log_dir)?;
        
        let log_file_path = log_dir.join("app.log");
        
        // 创建日志文件如果不存在
        if !log_file_path.exists() {
            File::create(&log_file_path)?;
        }
        
        Ok(Logger { log_file_path })
    }
    
    pub fn log(&self, level: LogLevel, component: &str, message: &str, details: Option<&str>) {
        let timestamp = Local::now();
        let log_entry = json!({
            "timestamp": timestamp.to_rfc3339(),
            "level": level.as_str(),
            "component": component,
            "message": message,
            "details": details
        });
        
        let log_line = format!("{}\n", log_entry.to_string());
        
        // 写入文件
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_file_path)
        {
            let _ = file.write_all(log_line.as_bytes());
            let _ = file.flush();
        }
        
        // 同时输出到控制台
        println!("[{}] [{}] {}: {}", 
            timestamp.format("%Y-%m-%d %H:%M:%S"),
            level.as_str(),
            component,
            message
        );
        
        if let Some(details) = details {
            println!("  Details: {}", details);
        }
    }
    
    pub fn info(&self, component: &str, message: &str) {
        self.log(LogLevel::Info, component, message, None);
    }
    
    pub fn warn(&self, component: &str, message: &str) {
        self.log(LogLevel::Warn, component, message, None);
    }
    
    pub fn error(&self, component: &str, message: &str, details: Option<&str>) {
        self.log(LogLevel::Error, component, message, details);
    }
    
    pub fn debug(&self, component: &str, message: &str) {
        self.log(LogLevel::Debug, component, message, None);
    }
    
    pub fn api_request(&self, command: &str, args: Option<&str>) {
        let message = format!("API Request: {}", command);
        self.log(LogLevel::Info, "API", &message, args);
    }
    
    pub fn api_response(&self, command: &str, success: bool, details: Option<&str>) {
        let level = if success { LogLevel::Info } else { LogLevel::Error };
        let message = format!("API Response: {} - {}", command, if success { "SUCCESS" } else { "FAILED" });
        self.log(level, "API", &message, details);
    }
    
    pub fn database_operation(&self, operation: &str, table: &str, success: bool, details: Option<&str>) {
        let level = if success { LogLevel::Debug } else { LogLevel::Error };
        let message = format!("Database {}: {}", operation, table);
        self.log(level, "DATABASE", &message, details);
    }
}
