import React from 'react';
import styles from './TextArea.module.css';

export interface TextAreaProps {
  /** 输入值 */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
  /** 占位符 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否只读 */
  readOnly?: boolean;
  /** 错误信息 */
  error?: string;
  /** 最大长度 */
  maxLength?: number;
  /** 自动聚焦 */
  autoFocus?: boolean;
  /** 行数 */
  rows?: number;
  /** 是否可调整大小 */
  resizable?: boolean;
  /** 尺寸 */
  size?: 'small' | 'medium' | 'large';
}

/**
 * 文本域组件
 */
export const TextArea: React.FC<TextAreaProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  readOnly = false,
  error,
  maxLength,
  autoFocus = false,
  rows = 4,
  resizable = true,
  size = 'medium'
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  const textareaClasses = [
    styles.textarea,
    styles[size],
    error ? styles.error : '',
    !resizable ? styles.noResize : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.container}>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        autoFocus={autoFocus}
        rows={rows}
        className={textareaClasses}
      />
      
      <div className={styles.footer}>
        {maxLength && (
          <div className={styles.counter}>
            {value.length}/{maxLength}
          </div>
        )}
      </div>
      
      {error && (
        <div className={styles.errorMessage}>
          <i className="fas fa-exclamation-circle" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default TextArea;
