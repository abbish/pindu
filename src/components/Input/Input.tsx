import React from 'react';
import styles from './Input.module.css';

export interface InputProps {
  /** 输入值 */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
  /** 占位符 */
  placeholder?: string;
  /** 输入类型 */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
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
  /** 尺寸 */
  size?: 'small' | 'medium' | 'large';
  /** 前缀图标 */
  prefixIcon?: string;
  /** 后缀图标 */
  suffixIcon?: string;
  /** 后缀图标点击回调 */
  onSuffixIconClick?: () => void;
}

/**
 * 输入框组件
 */
export const Input: React.FC<InputProps> = ({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  readOnly = false,
  error,
  maxLength,
  autoFocus = false,
  size = 'medium',
  prefixIcon,
  suffixIcon,
  onSuffixIconClick
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  const inputClasses = [
    styles.input,
    styles[size],
    error ? styles.error : '',
    prefixIcon ? styles.withPrefix : '',
    suffixIcon ? styles.withSuffix : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.container}>
      <div className={styles.inputWrapper}>
        {prefixIcon && (
          <div className={styles.prefixIcon}>
            <i className={`fas fa-${prefixIcon}`} />
          </div>
        )}
        
        <input
          type={type}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={maxLength}
          autoFocus={autoFocus}
          className={inputClasses}
        />
        
        {suffixIcon && (
          <div 
            className={`${styles.suffixIcon} ${onSuffixIconClick ? styles.clickable : ''}`}
            onClick={onSuffixIconClick}
          >
            <i className={`fas fa-${suffixIcon}`} />
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

export default Input;
