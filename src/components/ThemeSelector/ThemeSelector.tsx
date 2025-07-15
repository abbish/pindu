import React from 'react';
import styles from './ThemeSelector.module.css';

export interface ThemeOption {
  /** 主题ID */
  id: string;
  /** 主题名称 */
  name: string;
  /** 图标 */
  icon: string;
  /** 颜色 */
  color: 'primary' | 'orange' | 'green' | 'purple' | 'blue' | 'pink' | 'yellow';
}

export interface ThemeSelectorProps {
  /** 可选主题列表 */
  themes: ThemeOption[];
  /** 已选择的主题IDs */
  selectedThemes: string[];
  /** 选择变化回调 */
  onSelectionChange: (selectedIds: string[]) => void;
  /** 是否允许多选 */
  multiple?: boolean;
  /** 标签 */
  label?: string;
  /** 描述 */
  description?: string;
}

/**
 * 主题标签选择器组件
 */
export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  themes,
  selectedThemes,
  onSelectionChange,
  multiple = true,
  label = '主题标签',
  description = '选择一个或多个主题标签来分类你的单词本'
}) => {
  const handleThemeToggle = (themeId: string) => {
    let newSelection: string[];

    if (multiple) {
      if (selectedThemes.includes(themeId)) {
        newSelection = selectedThemes.filter(id => id !== themeId);
      } else {
        newSelection = [...selectedThemes, themeId];
      }
    } else {
      newSelection = selectedThemes.includes(themeId) ? [] : [themeId];
    }

    onSelectionChange(newSelection);
  };

  return (
    <div className={styles.container}>
      {label && (
        <label className={styles.label}>{label}</label>
      )}
      
      <div className={styles.themesGrid}>
        {themes.map((theme) => {
          const isSelected = selectedThemes.includes(theme.id);
          
          return (
            <button
              key={theme.id}
              className={`${styles.themeButton} ${styles[theme.color]} ${isSelected ? styles.selected : ''}`}
              onClick={() => handleThemeToggle(theme.id)}
              type="button"
            >
              <i className={`fas fa-${theme.icon} ${styles.icon}`} />
              <span className={styles.themeName}>{theme.name}</span>
            </button>
          );
        })}
      </div>
      
      {description && (
        <p className={styles.description}>{description}</p>
      )}
    </div>
  );
};

export default ThemeSelector;