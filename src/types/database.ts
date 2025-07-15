// Database types and interfaces

export interface Word {
  id: number;
  word: string;
  pronunciation: string;
  translation: string;
  example_sentence?: string;
  difficulty_level: 1 | 2 | 3 | 4 | 5;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface StudyPlan {
  id: number;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed';
  total_words: number;
  learned_words: number;
  accuracy_rate: number;
  mastery_level: 1 | 2 | 3 | 4 | 5;
  created_at: string;
  updated_at: string;
}

export interface StudyPlanWord {
  id: number;
  plan_id: number;
  word_id: number;
  learned: boolean;
  correct_count: number;
  total_attempts: number;
  last_studied: string | null;
  next_review: string | null;
  mastery_score: number;
}

export interface StudySession {
  id: number;
  plan_id: number;
  started_at: string;
  finished_at: string | null;
  words_studied: number;
  correct_answers: number;
  total_time_seconds: number;
}

export interface StudyStatistic {
  id: number;
  date: string;
  words_learned: number;
  words_reviewed: number;
  total_study_time: number;
  accuracy_rate: number;
  streak_days: number;
}

export interface Category {
  id: number;
  name: string;
  description: string;
  color: string;
  icon: string;
  word_count: number;
}

// Database operation result types
export interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Query parameters
export interface StudyPlanQuery {
  status?: 'active' | 'paused' | 'completed';
  limit?: number;
  offset?: number;
}

export interface WordQuery {
  category?: string;
  difficulty_level?: number;
  learned?: boolean;
  plan_id?: number;
  limit?: number;
  offset?: number;
}