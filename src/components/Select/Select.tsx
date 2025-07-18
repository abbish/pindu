import React from 'react';
import styles from './Select.module.css';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectProps {
  /** 选项列表 */
  options: SelectOption[];
  /** 当前选中的值 */
  value: string | number;
  /** 值变化回调 */
  onChange: (value: string | number) => void;
  /** 占位符 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 错误信息 */
  error?: string;
  /** 额外的CSS类名 */
  className?: string;
}

/**
 * 选择框组件
 */
export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '请选择',
  disabled = false,
  error,
  className = ''
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    // 尝试转换为数字，如果失败则保持字符串
    const numValue = Number(selectedValue);
    onChange(isNaN(numValue) ? selectedValue : numValue);
  };

  return (
    <div className={`${styles.container} ${className}`}>
      <select
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className={`${styles.select} ${error ? styles.error : ''}`}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
};

export default Select;
