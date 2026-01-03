use crate::error::{AppResult, AppError};

/// 验证器 Trait
pub trait Validator<T> {
    /// 验证数据并返回验证结果
    ///
    /// # 参数
    /// * `data` - 待验证的数据
    ///
    /// # 返回值
    /// 成功时返回 Ok(())，失败时返回 AppError::ValidationError
    fn validate(&self, data: &T) -> AppResult<()>;
}

/// 字符串验证规则
#[derive(Debug, Clone)]
pub struct StringValidator {
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    pub required: bool,
    pub trim: bool,
    pub deny_empty: bool,
    pub allow_control_chars: bool,
}

impl Default for StringValidator {
    fn default() -> Self {
        Self {
            min_length: None,
            max_length: None,
            required: false,
            trim: true,
            deny_empty: true,
            allow_control_chars: false,
        }
    }
}

impl StringValidator {
    /// 创建新的字符串验证器
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置最小长度
    pub fn min_length(mut self, length: usize) -> Self {
        self.min_length = Some(length);
        self
    }

    /// 设置最大长度
    pub fn max_length(mut self, length: usize) -> Self {
        self.max_length = Some(length);
        self
    }

    /// 设置是否必填
    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    /// 设置是否需要 trim
    pub fn trim(mut self, trim: bool) -> Self {
        self.trim = trim;
        self
    }

    /// 设置是否禁止空字符串
    pub fn deny_empty(mut self, deny_empty: bool) -> Self {
        self.deny_empty = deny_empty;
        self
    }

    /// 设置是否允许控制字符
    pub fn allow_control_chars(mut self, allow: bool) -> Self {
        self.allow_control_chars = allow;
        self
    }

    /// 验证字符串
    pub fn validate_str(&self, value: &str) -> AppResult<String> {
        let mut result = value.to_string();

        // Trim 处理
        if self.trim {
            result = result.trim().to_string();
        }

        // 必填验证
        if self.required && result.is_empty() {
            return Err(AppError::ValidationError("字段不能为空".to_string()));
        }

        // 禁止空字符串
        if self.deny_empty && result.is_empty() {
            return Err(AppError::ValidationError("字段不能为空".to_string()));
        }

        // 最小长度验证
        if let Some(min) = self.min_length {
            if result.len() < min {
                return Err(AppError::ValidationError(format!(
                    "字段长度不能少于 {} 个字符 (当前: {})", min, result.len()
                )));
            }
        }

        // 最大长度验证
        if let Some(max) = self.max_length {
            if result.len() > max {
                return Err(AppError::ValidationError(format!(
                    "字段长度不能超过 {} 个字符 (当前: {})", max, result.len()
                )));
            }
        }

        // 控制字符验证
        if !self.allow_control_chars {
            if result.contains(|c: char| c.is_control()) {
                return Err(AppError::ValidationError("字段包含非法字符".to_string()));
            }
        }

        Ok(result)
    }

    /// 验证可选字符串
    pub fn validate_optional(&self, value: Option<&str>) -> AppResult<Option<String>> {
        match value {
            Some(v) => {
                if v.trim().is_empty() {
                    if self.required {
                        Err(AppError::ValidationError("字段不能为空".to_string()))
                    } else {
                        Ok(None)
                    }
                } else {
                    Ok(Some(self.validate_str(v)?))
                }
            }
            None => {
                if self.required {
                    Err(AppError::ValidationError("字段不能为空".to_string()))
                } else {
                    Ok(None)
                }
            }
        }
    }
}

/// ID 验证器
#[derive(Debug, Clone)]
pub struct IdValidator {
    pub required: bool,
}

impl Default for IdValidator {
    fn default() -> Self {
        Self { required: false }
    }
}

impl IdValidator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    pub fn validate(&self, value: i64) -> AppResult<i64> {
        if self.required && value <= 0 {
            return Err(AppError::ValidationError("ID 必须大于 0".to_string()));
        }
        Ok(value)
    }

    pub fn validate_optional(&self, value: Option<i64>) -> AppResult<Option<i64>> {
        match value {
            Some(v) => Ok(Some(self.validate(v)?)),
            None => {
                if self.required {
                    Err(AppError::ValidationError("ID 不能为空".to_string()))
                } else {
                    Ok(None)
                }
            }
        }
    }
}

/// 常用验证器常量
pub mod validators {
    use super::*;

    /// 单词本标题验证器
    pub fn word_book_title() -> StringValidator {
        StringValidator::new()
            .required(true)
            .min_length(1)
            .max_length(100)
            .deny_empty(true)
    }

    /// 单词本描述验证器
    pub fn word_book_description() -> StringValidator {
        StringValidator::new()
            .required(false)
            .max_length(1000)
    }

    /// 学习计划名称验证器
    pub fn study_plan_name() -> StringValidator {
        StringValidator::new()
            .required(true)
            .min_length(1)
            .max_length(100)
    }

    /// 学习计划描述验证器
    pub fn study_plan_description() -> StringValidator {
        StringValidator::new()
            .required(false)
            .max_length(2000)
    }

    /// 单词拼写验证器
    pub fn word_spelling() -> StringValidator {
        StringValidator::new()
            .required(true)
            .min_length(1)
            .max_length(50)
    }

    /// 单词含义验证器
    pub fn word_meaning() -> StringValidator {
        StringValidator::new()
            .required(true)
            .min_length(1)
            .max_length(500)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_string_validator_min_length() {
        let validator = StringValidator::new()
            .min_length(5)
            .required(true);

        assert!(validator.validate_str("abc").is_err());
        assert!(validator.validate_str("abcdef").is_ok());
    }

    #[test]
    fn test_string_validator_max_length() {
        let validator = StringValidator::new()
            .max_length(5)
            .required(true);

        assert!(validator.validate_str("abcdef").is_err());
        assert!(validator.validate_str("abc").is_ok());
    }

    #[test]
    fn test_string_validator_required() {
        let validator = StringValidator::new()
            .required(true);

        assert!(validator.validate_str("").is_err());
        assert!(validator.validate_str("  ").is_err());
        assert!(validator.validate_str("test").is_ok());
    }

    #[test]
    fn test_string_validator_optional() {
        let validator = StringValidator::new()
            .required(false);

        assert!(validator.validate_optional(None).is_ok());
        assert!(validator.validate_optional(Some("")).unwrap().is_none());
        assert!(validator.validate_optional(Some("test")).unwrap().is_some());
    }

    #[test]
    fn test_string_validator_control_chars() {
        let validator = StringValidator::new()
            .allow_control_chars(false);

        assert!(validator.validate_str("test\n").is_err());
        assert!(validator.validate_str("test\t").is_err());
        assert!(validator.validate_str("test").is_ok());
    }

    #[test]
    fn test_id_validator() {
        let validator = IdValidator::new().required(true);

        assert!(validator.validate(0).is_err());
        assert!(validator.validate(-1).is_err());
        assert!(validator.validate(1).is_ok());
    }
}
