import React from 'react';
import styles from './PlanPreview.module.css';
import type { WordBookOption } from '../WordBookSelector';

export interface PlanFormData {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  selectedBooks: number[];
}

export interface PlanPreviewProps {
  /** Form data */
  formData: PlanFormData;
  /** Available word books */
  wordBooks: WordBookOption[];
  /** Daily study target words */
  dailyTarget?: number;
  /** Create plan handler */
  onCreatePlan: () => void;
  /** Save draft handler */
  onSaveDraft: () => void;
  /** Can create plan */
  canCreate: boolean;
  /** Loading state */
  loading?: boolean;
}

/**
 * Plan preview component showing a summary of the plan being created
 */
export const PlanPreview: React.FC<PlanPreviewProps> = ({
  formData,
  wordBooks,
  dailyTarget = 20,
  onCreatePlan,
  onSaveDraft,
  canCreate,
  loading = false
}) => {
  // Get selected books
  const selectedBooks = wordBooks.filter(book => 
    formData.selectedBooks.includes(book.id)
  );

  // Calculate totals
  const totalWords = selectedBooks.reduce((sum, book) => sum + book.wordCount, 0);
  
  // Calculate study period
  const getStudyPeriod = () => {
    if (!formData.startDate || !formData.endDate) return '未设置';
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return `${diffDays}天`;
  };

  // Calculate estimated completion time
  const getEstimatedCompletion = () => {
    if (totalWords === 0 || dailyTarget === 0) return '未计算';
    const days = Math.ceil(totalWords / dailyTarget);
    return `约${days}天`;
  };

  // Get plan name or default
  const getPlanName = () => {
    return formData.name.trim() || '新学习计划';
  };

  // Color variations for book dots
  const colors = ['primary', 'orange', 'yellow', 'green', 'purple', 'pink', 'blue'];

  if (selectedBooks.length === 0) {
    return (
      <div className={styles.preview}>
        <h3 className={styles.title}>计划预览</h3>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-clipboard-list" />
          </div>
          <p className={styles.emptyText}>请填写计划信息并选择单词本</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>计划预览</h3>

      {/* Plan Summary */}
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>计划名称</span>
          <span className={styles.summaryValue}>{getPlanName()}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>学习周期</span>
          <span className={styles.summaryValue}>{getStudyPeriod()}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>每日目标</span>
          <span className={styles.summaryValue}>{dailyTarget}个单词</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>总单词数</span>
          <span className={styles.summaryValue}>{totalWords}个</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>预计完成</span>
          <span className={styles.summaryValue}>{getEstimatedCompletion()}</span>
        </div>
      </div>

      {/* Selected Books */}
      <div className={styles.selectedBooks}>
        <h4 className={styles.sectionTitle}>已选单词本</h4>
        <div className={styles.booksList}>
          {selectedBooks.map((book, index) => (
            <div key={book.id} className={styles.bookItem}>
              <div className={`${styles.bookDot} ${styles[colors[index % colors.length]]}`} />
              <span className={styles.bookText}>
                {book.name} ({book.wordCount}词)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Study Schedule */}
      <div className={styles.schedule}>
        <h4 className={styles.sectionTitle}>学习安排</h4>
        <div className={styles.weekDays}>
          {['一', '二', '三', '四', '五', '六', '日'].map((day, index) => (
            <div
              key={day}
              className={`${styles.dayItem} ${
                index < 5 ? styles.dayActive : styles.dayInactive
              }`}
            >
              {day}
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className={styles.actions}>
        <button
          className={`${styles.actionBtn} ${styles.primaryBtn}`}
          onClick={onCreatePlan}
          disabled={!canCreate || loading}
        >
          <i className="fas fa-check" />
          {loading ? '创建中...' : '创建计划'}
        </button>
        <button
          className={`${styles.actionBtn} ${styles.secondaryBtn}`}
          onClick={onSaveDraft}
          disabled={loading}
        >
          <i className="fas fa-save" />
          保存草稿
        </button>
      </div>
    </div>
  );
};

export default PlanPreview;