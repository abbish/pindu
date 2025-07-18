import React, { useState, useEffect } from 'react';
import { WordBookService } from '../../services/wordbookService';
import { type ThemeTag } from '../../types';
import styles from './WordBookFilter.module.css';

export interface FilterOptions {
  /** 搜索关键词 */
  searchTerm: string;
  /** 主题标签 */
  theme: string;
  /** 状态 */
  status: string;
  /** 排序方式 */
  sortBy: string;
}

export interface WordBookFilterProps {
  /** 当前筛选选项 */
  filters: FilterOptions;
  /** 筛选变化回调 */
  onFilterChange: (filters: FilterOptions) => void;
  /** 重置筛选回调 */
  onReset?: () => void;
  /** 加载状态 */
  loading?: boolean;
}



const STATUS_OPTIONS = [
  { value: '', label: '所有状态' },
  { value: 'normal', label: '正常' },
  { value: 'draft', label: '草稿' },
  { value: 'deleted', label: '已删除' }
];

const SORT_OPTIONS = [
  { value: '', label: '默认排序' },
  { value: 'created_time', label: '按创建时间' },
  { value: 'word_count', label: '按单词数量' },
  { value: 'completion', label: '按完成度' }
];

/**
 * 单词本筛选和搜索组件
 */
export const WordBookFilter: React.FC<WordBookFilterProps> = ({
  filters,
  onFilterChange,
  onReset,
  loading = false
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<ThemeTag[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);

  // 加载主题标签
  useEffect(() => {
    const loadThemes = async () => {
      setThemesLoading(true);
      try {
        const wordbookService = new WordBookService();
        const result = await wordbookService.getThemeTags();
        if (result.success && result.data) {
          setAvailableThemes(result.data);
        }
      } catch (error) {
        console.error('加载主题标签失败:', error);
      } finally {
        setThemesLoading(false);
      }
    };

    loadThemes();
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filters,
      searchTerm: e.target.value
    });
  };

  const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      theme: e.target.value
    });
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      status: e.target.value
    });
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      sortBy: e.target.value
    });
  };

  const handleReset = () => {
    onReset?.();
  };

  const toggleCollapsed = () => {
    setIsCollapsed(!isCollapsed);
  };

  const hasActiveFilters = filters.searchTerm || filters.theme || filters.status || filters.sortBy;

  if (loading) {
    return (
      <section className={styles.filterSection}>
        <div className={styles.filterCard}>
          <div className={styles.filterHeader}>
            <div className={`${styles.skeleton} ${styles.titleSkeleton}`} />
            <div className={`${styles.skeleton} ${styles.iconSkeleton}`} />
          </div>
          <div className={styles.filterGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={`${styles.skeleton} ${styles.inputSkeleton}`} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.filterSection}>
      <div className={styles.filterCard}>
        <div className={styles.filterHeader}>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>筛选和搜索</h3>
            {hasActiveFilters && (
              <span className={styles.activeCount}>
                {[filters.searchTerm, filters.theme, filters.status, filters.sortBy].filter(Boolean).length} 个活跃筛选
              </span>
            )}
          </div>
          <div className={styles.headerActions}>
            {hasActiveFilters && (
              <button
                className={styles.resetBtn}
                onClick={handleReset}
                title="重置筛选"
              >
                <i className="fas fa-times" />
                <span>重置</span>
              </button>
            )}
            <button
              className={styles.toggleBtn}
              onClick={toggleCollapsed}
              title={isCollapsed ? '展开筛选' : '收起筛选'}
            >
              <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'}`} />
            </button>
          </div>
        </div>

        <div className={`${styles.filterContent} ${isCollapsed ? styles.collapsed : ''}`}>
          <div className={styles.filterGrid}>
            {/* 搜索框 */}
            <div className={styles.searchWrapper}>
              <i className="fas fa-search" />
              <input
                type="text"
                placeholder="搜索单词本..."
                value={filters.searchTerm}
                onChange={handleSearchChange}
                className={styles.searchInput}
              />
              {filters.searchTerm && (
                <button
                  className={styles.clearBtn}
                  onClick={() => onFilterChange({ ...filters, searchTerm: '' })}
                  title="清除搜索"
                >
                  <i className="fas fa-times" />
                </button>
              )}
            </div>

            {/* 主题选择 */}
            <select
              value={filters.theme}
              onChange={handleThemeChange}
              className={styles.select}
              disabled={themesLoading}
            >
              <option value="">
                {themesLoading ? '加载主题标签中...' : '选择主题标签'}
              </option>
              {availableThemes.map(theme => (
                <option key={theme.id} value={theme.id.toString()}>
                  {theme.icon} {theme.name}
                </option>
              ))}
            </select>

            {/* 状态选择 */}
            <select
              value={filters.status}
              onChange={handleStatusChange}
              className={styles.select}
            >
              {STATUS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {/* 排序选择 */}
            <select
              value={filters.sortBy}
              onChange={handleSortChange}
              className={styles.select}
            >
              {SORT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </section>
  );
};

export default WordBookFilter;