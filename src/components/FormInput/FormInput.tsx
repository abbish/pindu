import React from 'react';
import styles from './FormInput.module.css';

export interface FormInputProps {
  /** Input label */
  label: string;
  /** Input type */
  type?: 'text' | 'textarea' | 'date';
  /** Input name */
  name: string;
  /** Input value */
  value: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text below input */
  helperText?: string;
  /** Is field required */
  required?: boolean;
  /** Error state */
  error?: boolean;
  /** Rows for textarea */
  rows?: number;
  /** Input change handler */
  onChange: (value: string) => void;
  /** Input blur handler */
  onBlur?: () => void;
}

/**
 * Reusable form input component
 */
export const FormInput: React.FC<FormInputProps> = ({
  label,
  type = 'text',
  name,
  value,
  placeholder,
  helperText,
  required = false,
  error = false,
  rows = 3,
  onChange,
  onBlur
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const inputProps = {
    name,
    value,
    placeholder,
    onChange: handleChange,
    onBlur,
    className: `${styles.input} ${type === 'textarea' ? styles.textarea : ''}`,
  };

  return (
    <div className={`${styles.inputGroup} ${error ? styles.error : ''} ${required ? styles.required : ''}`}>
      <label htmlFor={name} className={styles.label}>
        {label}
      </label>
      
      {type === 'textarea' ? (
        <textarea
          id={name}
          rows={rows}
          {...inputProps}
        />
      ) : (
        <input
          id={name}
          type={type}
          {...inputProps}
        />
      )}
      
      {helperText && (
        <p className={styles.helperText}>
          {helperText}
        </p>
      )}
    </div>
  );
};

export default FormInput;