// 统一导出所有类型
export * from './common';
export * from './wordbook';
export * from './study';
export * from './ai-model';
export * from './api';

// 保留原有的全局类型定义
export interface AppConfig {
  name: string;
  version: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}