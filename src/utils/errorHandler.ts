// Error handling utilities for RedLark app

export interface AppError {
  code: string;
  message: string;
  details?: string;
}

export class DatabaseError extends Error {
  public code: string;
  public details?: string;

  constructor(code: string, message: string, details?: string) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
  }
}

export function handleDatabaseError(error: any): AppError {
  console.error('Database error:', error);
  
  if (error instanceof DatabaseError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  
  // 处理常见的数据库错误
  if (error.message?.includes('no such table')) {
    return {
      code: 'DB_TABLE_NOT_FOUND',
      message: '数据库表不存在，请重新初始化应用',
      details: error.message
    };
  }
  
  if (error.message?.includes('database is locked')) {
    return {
      code: 'DB_LOCKED',
      message: '数据库正在使用中，请稍后重试',
      details: error.message
    };
  }
  
  if (error.message?.includes('UNIQUE constraint failed')) {
    return {
      code: 'DB_DUPLICATE_ENTRY',
      message: '数据重复，请检查输入内容',
      details: error.message
    };
  }
  
  // 默认错误处理
  return {
    code: 'DB_UNKNOWN_ERROR',
    message: '数据库操作失败，请重试',
    details: error.message || String(error)
  };
}

export function showErrorMessage(error: AppError, context?: string): string {
  const prefix = context ? `${context}: ` : '';
  return `${prefix}${error.message}`;
}

// 重试机制
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      console.warn(`Operation failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error('Max retries exceeded');
}