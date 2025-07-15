import { invoke } from '@tauri-apps/api/core';

// ===== 数据类型定义 =====

export interface StudyPlan {
  id: number;
  name: string;
  description: string;
  status: string;
  total_words: number;
  learned_words: number;
  accuracy_rate: number;
  mastery_level: number;
  created_at: string;
  updated_at: string;
}

export interface StudyPlanWithProgress extends StudyPlan {
  progress_percentage: number;
}

export interface StudyStatistics {
  total_words_learned: number;
  average_accuracy: number;
  streak_days: number;
  completion_rate: number;
  weekly_progress: number[];
}

export interface WordBook {
  id: number;
  title: string;
  description: string;
  icon: string;
  icon_color: string;
  total_words: number;
  linked_plans: number;
  word_types: {
    nouns: number;
    verbs: number;
    adjectives: number;
    others: number;
  };
  created_at: string;
  last_used: string;
}

export interface WordBookStatistics {
  total_books: number;
  total_words: number;
  nouns: number;
  verbs: number;
  adjectives: number;
}

export interface Word {
  id: string;
  word: string;
  meaning: string;
  description?: string;
  phonetic?: string;
  ipa?: string;
  syllables?: string;
  phonics_segments?: string[];
  image_url?: string;
  word_book_id?: number;
}

export interface CreateStudyPlanRequest {
  name: string;
  description: string;
  word_ids: string[];
}

export interface CreateWordBookRequest {
  title: string;
  description: string;
  icon: string;
  icon_color: string;
}

/**
 * Get all study plans with progress information
 */
export async function getStudyPlans(): Promise<StudyPlanWithProgress[]> {
  try {
    const plans = await invoke<StudyPlanWithProgress[]>('get_study_plans');
    return plans;
  } catch (error) {
    console.error('Failed to get study plans:', error);
    throw new Error('获取学习计划失败');
  }
}

/**
 * Get study statistics overview
 */
export async function getStudyStatistics(): Promise<StudyStatistics> {
  try {
    const stats = await invoke<StudyStatistics>('get_study_statistics');
    return stats;
  } catch (error) {
    console.error('Failed to get study statistics:', error);
    throw new Error('获取学习统计失败');
  }
}

/**
 * Create a new study plan
 */
export async function createStudyPlan(request: CreateStudyPlanRequest): Promise<number> {
  try {
    const planId = await invoke<number>('create_study_plan', { request });
    return planId;
  } catch (error) {
    console.error('Failed to create study plan:', error);
    throw new Error('创建学习计划失败');
  }
}

/**
 * Get all word books
 */
export async function getWordBooks(): Promise<WordBook[]> {
  try {
    const books = await invoke<WordBook[]>('get_word_books');
    return books;
  } catch (error) {
    console.error('Failed to get word books:', error);
    throw new Error('获取单词本失败');
  }
}

/**
 * Get word book statistics
 */
export async function getWordBookStatistics(): Promise<WordBookStatistics> {
  try {
    const stats = await invoke<WordBookStatistics>('get_word_book_statistics');
    return stats;
  } catch (error) {
    console.error('Failed to get word book statistics:', error);
    throw new Error('获取单词本统计失败');
  }
}

/**
 * Create a new word book
 */
export async function createWordBook(request: CreateWordBookRequest): Promise<number> {
  try {
    const bookId = await invoke<number>('create_word_book', { request });
    return bookId;
  } catch (error) {
    console.error('Failed to create word book:', error);
    throw new Error('创建单词本失败');
  }
}

/**
 * Get words by word book ID
 */
export async function getWordsByBook(bookId: number): Promise<Word[]> {
  try {
    const words = await invoke<Word[]>('get_words_by_book', { bookId });
    return words;
  } catch (error) {
    console.error('Failed to get words by book:', error);
    throw new Error('获取单词失败');
  }
}

/**
 * Get words by study plan ID
 */
export async function getStudyPlanWords(planId: number): Promise<Word[]> {
  try {
    const words = await invoke<Word[]>('get_study_plan_words', { planId });
    return words;
  } catch (error) {
    console.error('Failed to get study plan words:', error);
    throw new Error('获取学习计划单词失败');
  }
}

/**
 * Start a new study session
 */
export async function startStudySession(planId: number): Promise<number> {
  try {
    const sessionId = await invoke<number>('start_study_session', { planId });
    return sessionId;
  } catch (error) {
    console.error('Failed to start study session:', error);
    throw new Error('开始学习会话失败');
  }
}

/**
 * Submit word answer for a study session
 */
export async function submitWordAnswer(
  sessionId: number,
  wordId: string,
  userAnswer: string,
  isCorrect: boolean,
  timeSpent: number
): Promise<void> {
  try {
    await invoke('submit_word_answer', {
      sessionId,
      wordId,
      userAnswer,
      isCorrect,
      timeSpent
    });
  } catch (error) {
    console.error('Failed to submit word answer:', error);
    throw new Error('提交答案失败');
  }
}

/**
 * End a study session
 */
export async function endStudySession(
  sessionId: number,
  wordsStudied: number,
  correctAnswers: number,
  totalTime: number
): Promise<void> {
  try {
    await invoke('end_study_session', {
      sessionId,
      wordsStudied,
      correctAnswers,
      totalTime
    });
  } catch (error) {
    console.error('Failed to end study session:', error);
    throw new Error('结束学习会话失败');
  }
}

/**
 * Format date to local string
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Calculate mastery level display
 */
export function getMasteryDisplay(level: number): { text: string; color: string; stars: number } {
  const masteryLevels = [
    { text: '入门', color: 'var(--color-text-secondary)', stars: 1 },
    { text: '熟悉', color: 'var(--color-green)', stars: 2 },
    { text: '掌握', color: 'var(--color-orange)', stars: 3 },
    { text: '熟练', color: 'var(--color-purple)', stars: 4 },
    { text: '精通', color: 'var(--color-blue)', stars: 5 },
  ];

  return masteryLevels[Math.max(0, Math.min(4, level - 1))];
}

/**
 * Get status display information
 */
export function getStatusDisplay(status: string): { text: string; color: string; bgColor: string } {
  const statusMap: Record<string, { text: string; color: string; bgColor: string }> = {
    active: { text: '进行中', color: 'var(--color-green)', bgColor: 'var(--color-green-light)' },
    paused: { text: '暂停', color: 'var(--color-yellow)', bgColor: 'var(--color-yellow-light)' },
    completed: { text: '已完成', color: 'var(--color-blue)', bgColor: 'var(--color-blue-light)' }
  };

  return statusMap[status] || statusMap.active;
}