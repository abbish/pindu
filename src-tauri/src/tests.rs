#[cfg(test)]
mod tests {
    use super::commands::*;

    #[test]
    fn test_create_word_request_validation() {
        let valid_request = CreateWordRequest {
            word: "Apple".to_string(),
            meaning: "苹果".to_string(),
            description: None,
            phonetic: Some("/ˈæpl/".to_string()),
            ipa: Some("/ˈæpl/".to_string()),
            syllables: Some("Ap-ple".to_string()),
            phonics_segments: Some("[\"Ap\", \"ple\"]".to_string()),
            part_of_speech: Some("noun".to_string()),
            difficulty_level: Some(1),
            category_id: Some(1),
        };
        
        assert!(valid_request.validate().is_ok());
        
        // Test empty word
        let invalid_request = CreateWordRequest {
            word: "".to_string(),
            meaning: "苹果".to_string(),
            description: None,
            phonetic: None,
            ipa: None,
            syllables: None,
            phonics_segments: None,
            part_of_speech: None,
            difficulty_level: None,
            category_id: None,
        };
        
        assert!(invalid_request.validate().is_err());
        
        // Test invalid difficulty level
        let invalid_difficulty = CreateWordRequest {
            word: "Apple".to_string(),
            meaning: "苹果".to_string(),
            description: None,
            phonetic: None,
            ipa: None,
            syllables: None,
            phonics_segments: None,
            part_of_speech: None,
            difficulty_level: Some(10),
            category_id: None,
        };
        
        assert!(invalid_difficulty.validate().is_err());
    }

    #[test]
    fn test_api_error_conversion() {
        let error_from_string: ApiError = "Test error".into();
        assert_eq!(error_from_string.message, "Test error");
        assert_eq!(error_from_string.code, "UNKNOWN_ERROR");
        
        let error_from_string_owned: ApiError = "Test error".to_string().into();
        assert_eq!(error_from_string_owned.message, "Test error");
        assert_eq!(error_from_string_owned.code, "UNKNOWN_ERROR");
    }
}