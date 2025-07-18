import React, { useState } from 'react';
import { Modal, Button } from '../';
import { type WordBook } from '../../types';
import styles from './DeleteWordBookModal.module.css';

export interface DeleteWordBookModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框 */
  onClose: () => void;
  /** 单词本数据 */
  wordBook: WordBook | null;
  /** 删除回调 */
  onDelete: () => Promise<void>;
  /** 删除中状态 */
  deleting?: boolean;
}

/**
 * 删除单词本确认模态框
 */
export const DeleteWordBookModal: React.FC<DeleteWordBookModalProps> = ({
  isOpen,
  onClose,
  wordBook,
  onDelete,
  deleting = false
}) => {
  const [confirmText, setConfirmText] = useState('');

  // 处理删除
  const handleDelete = async () => {
    try {
      await onDelete();
      setConfirmText('');
      onClose();
    } catch (error) {
      console.error('删除失败:', error);
    }
  };

  // 检查确认文本是否正确
  const isConfirmValid = confirmText === wordBook?.title;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="删除单词本"
      size="medium"
    >
      <div className={styles.content}>
        <div className={styles.warning}>
          <i className="fas fa-exclamation-triangle" />
          <div>
            <h3 className={styles.warningTitle}>确认删除单词本</h3>
            <p className={styles.warningText}>
              您即将删除单词本 <strong>"{wordBook?.title}"</strong>。
              删除后的单词本将不会在列表中显示，但可以通过过滤器查看已删除的单词本。
            </p>
          </div>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>包含单词数：</span>
            <span className={styles.statValue}>{wordBook?.total_words || 0} 个</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>创建时间：</span>
            <span className={styles.statValue}>
              {wordBook?.created_at ? new Date(wordBook.created_at).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>

        <div className={styles.confirmation}>
          <label className={styles.confirmLabel}>
            请输入单词本名称 <strong>"{wordBook?.title}"</strong> 来确认删除：
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={wordBook?.title || ''}
            className={styles.confirmInput}
            disabled={deleting}
          />
        </div>
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={deleting}
        >
          取消
        </Button>
        <Button
          variant="danger"
          onClick={handleDelete}
          loading={deleting}
          disabled={!isConfirmValid}
        >
          确认删除
        </Button>
      </div>
    </Modal>
  );
};

export default DeleteWordBookModal;
