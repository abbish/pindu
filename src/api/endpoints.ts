/**
 * API 端点定义
 */

// 单词本相关端点
export const WORDBOOK_ENDPOINTS = {
  GET_ALL: 'get_word_books',
  GET_BY_ID: 'get_word_book_detail',
  CREATE: 'create_word_book',
  UPDATE: 'update_word_book',
  DELETE: 'delete_word_book',
  GET_STATISTICS: 'get_word_book_statistics',
} as const;

// 单词相关端点
export const WORD_ENDPOINTS = {
  GET_BY_BOOK: 'get_words_by_book',
  CREATE: 'add_word_to_book',
  UPDATE: 'update_word',
  DELETE: 'delete_word',
} as const;

// 学习计划相关端点
export const STUDY_PLAN_ENDPOINTS = {
  GET_ALL: 'get_study_plans',
  GET_BY_ID: 'get_study_plan_detail',
  CREATE: 'create_study_plan',
  UPDATE: 'update_study_plan',
  DELETE: 'delete_study_plan',
} as const;

// 学习会话相关端点
export const STUDY_SESSION_ENDPOINTS = {
  START: 'start_study_session',
  SUBMIT_ANSWER: 'submit_word_answer',
  END: 'end_study_session',
} as const;

// 统计相关端点
export const STATISTICS_ENDPOINTS = {
  GET_STUDY_STATS: 'get_study_statistics',
  GET_WORDBOOK_STATS: 'get_word_book_statistics',
} as const;

// 系统相关端点
export const SYSTEM_ENDPOINTS = {
  HEALTH_CHECK: 'health_check',
  GET_SYSTEM_INFO: 'get_system_info',
  EXPORT_DATA: 'export_data',
  IMPORT_DATA: 'import_data',
} as const;
