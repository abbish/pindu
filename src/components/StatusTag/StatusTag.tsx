import React from 'react';
import styles from './StatusTag.module.css';

export interface StatusTagProps {
  /** 状态值 */
  status: string;
  /** 大小 */
  size?: 'small' | 'medium' | 'large';
}

/**
 * 状态标签组件
 * 用于显示单词本的状态（normal、draft、deleted等）
 */
export const StatusTag: React.FC<StatusTagProps> = ({
  status,
  size = 'medium'
}) => {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'normal':
        return {
          label: '正常',
          variant: 'success'
        };
      case 'draft':
        return {
          label: '草稿',
          variant: 'warning'
        };
      case 'deleted':
        return {
          label: '已删除',
          variant: 'danger'
        };
      default:
        return {
          label: status,
          variant: 'default'
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <span 
      className={`${styles.statusTag} ${styles[config.variant]} ${styles[size]}`}
      title={`状态: ${config.label}`}
    >
      {config.label}
    </span>
  );
};
