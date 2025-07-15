import React from 'react';
import styles from './CreateWordBookPreview.module.css';
import type { ExtractedWord } from '../WordGrid';
import type { ThemeOption } from '../ThemeSelector';

export interface CreateWordBookFormData {
  /** 单词本名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 选择的主题标签 */
  selectedThemes: string[];
}

export interface CreateWordBookPreviewProps {
  /** 表单数据 */
  formData: CreateWordBookFormData;
  /** 可选主题列表 */
  availableThemes: ThemeOption[];
  /** 已选择的单词 */
  selectedWords: ExtractedWord[];
  /** 创建单词本回调 */
  onCreateWordBook: () => void;
  /** 保存草稿回调 */
  onSaveDraft?: () => void;
  /** 是否可以创建 */
  canCreate: boolean;
  /** 创建加载状态 */
  creating?: boolean;
}

/**
 * 创建单词本预览组件
 */
export const CreateWordBookPreview: React.FC<CreateWordBookPreviewProps> = ({
  formData,
  availableThemes,
  selectedWords,
  onCreateWordBook,
  onSaveDraft,
  canCreate,
  creating = false
}) => {
  const getSelectedTheme = () => {
    if (formData.selectedThemes.length === 0) return null;
    return availableThemes.find(theme => theme.id === formData.selectedThemes[0]);
  };

  const getEstimatedStudyTime = () => {
    const wordCount = selectedWords.length;
    if (wordCount === 0) return '0天';
    if (wordCount <= 20) return '1-2天';
    if (wordCount <= 50) return '2-3天';
    if (wordCount <= 100) return '3-5天';
    return '5-7天';
  };

  const getWordTypeStats = () => {
    const stats = {
      'n.': 0,
      'v.': 0,
      'adj.': 0,
      'adv.': 0,
      'other': 0
    };

    selectedWords.forEach(word => {
      if (word.partOfSpeech === 'n.') {
        stats['n.']++;
      } else if (word.partOfSpeech === 'v.') {
        stats['v.']++;
      } else if (word.partOfSpeech === 'adj.') {
        stats['adj.']++;
      } else if (word.partOfSpeech === 'adv.') {
        stats['adv.']++;
      } else {
        stats.other++;
      }
    });

    return stats;
  };

  const selectedTheme = getSelectedTheme();
  const estimatedTime = getEstimatedStudyTime();
  const wordStats = getWordTypeStats();
  const displayWords = selectedWords.slice(0, 5);
  const remainingCount = Math.max(0, selectedWords.length - 5);

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>单词本预览</h3>
      
      {/* Basic Info Summary */}
      <div className={styles.summarySection}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>单词本名称</span>
          <span className={styles.summaryValue}>
            {formData.name || '未命名单词本'}
          </span>
        </div>
        
        {selectedTheme && (
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>主题标签</span>
            <span className={`${styles.themeTag} ${styles[selectedTheme.color]}`}>
              <i className={`fas fa-${selectedTheme.icon}`} />
              {selectedTheme.name}
            </span>
          </div>
        )}
        
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>单词数量</span>
          <span className={styles.summaryValue}>{selectedWords.length}个</span>
        </div>
        
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>预计学习时间</span>
          <span className={styles.summaryValue}>{estimatedTime}</span>
        </div>
      </div>

      {/* Word Type Statistics */}
      {selectedWords.length > 0 && (
        <div className={styles.statsSection}>
          <h4 className={styles.statsTitle}>词性分布</h4>
          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{wordStats['n.']}</span>
              <span className={styles.statLabel}>名词</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{wordStats['v.']}</span>
              <span className={styles.statLabel}>动词</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{wordStats['adj.']}</span>
              <span className={styles.statLabel}>形容词</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{wordStats.other}</span>
              <span className={styles.statLabel}>其他</span>
            </div>
          </div>
        </div>
      )}

      {/* Selected Words Preview */}
      {selectedWords.length > 0 && (
        <div className={styles.wordsSection}>
          <h4 className={styles.wordsTitle}>已选单词</h4>
          <div className={styles.wordsPreview}>
            {displayWords.map((word) => (
              <div key={word.id} className={styles.wordItem}>
                <span className={styles.wordText}>{word.word}</span>
                <span className={styles.wordMeaning}>{word.meaning}</span>
              </div>
            ))}
            {remainingCount > 0 && (
              <div className={styles.remainingCount}>
                还有{remainingCount}个单词...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {selectedWords.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-list" />
          </div>
          <p className={styles.emptyText}>
            请先选择要包含的单词
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className={styles.actions}>
        {onSaveDraft && (
          <button
            className={styles.draftBtn}
            onClick={onSaveDraft}
            disabled={creating}
            type="button"
          >
            <i className="fas fa-save" />
            <span>保存草稿</span>
          </button>
        )}
        
        <button
          className={`${styles.createBtn} ${!canCreate ? styles.disabled : ''}`}
          onClick={onCreateWordBook}
          disabled={!canCreate || creating}
          type="button"
        >
          {creating ? (
            <i className="fas fa-spinner fa-spin" />
          ) : (
            <i className="fas fa-plus" />
          )}
          <span>{creating ? '创建中...' : '创建单词本'}</span>
        </button>
      </div>
    </div>
  );
};

export default CreateWordBookPreview;