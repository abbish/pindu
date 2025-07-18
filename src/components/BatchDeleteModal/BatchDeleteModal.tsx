import React from 'react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import styles from './BatchDeleteModal.module.css';

export interface BatchDeleteModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框回调 */
  onClose: () => void;
  /** 确认删除回调 */
  onConfirm: () => void;
  /** 要删除的单词列表 */
  words: Array<{ id: number; word: string; meaning: string }>;
  /** 删除中状态 */
  deleting?: boolean;
}

const BatchDeleteModal: React.FC<BatchDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  words,
  deleting = false
}) => {
  const isSingleWord = words.length === 1;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isSingleWord ? '删除单词' : '批量删除单词'}>
      <div className={styles.content}>
        <div className={styles.warning}>
          <i className="fas fa-exclamation-triangle" />
          <p className={styles.message}>
            {isSingleWord 
              ? `确定要删除单词"${words[0]?.word}"吗？`
              : `确定要删除以下 ${words.length} 个单词吗？`
            }
          </p>
        </div>

        {!isSingleWord && (
          <div className={styles.wordList}>
            <div className={styles.listHeader}>
              <span>即将删除的单词：</span>
            </div>
            <div className={styles.list}>
              {words.slice(0, 10).map((word) => (
                <div key={word.id} className={styles.wordItem}>
                  <span className={styles.word}>{word.word}</span>
                  <span className={styles.meaning}>{word.meaning}</span>
                </div>
              ))}
              {words.length > 10 && (
                <div className={styles.moreIndicator}>
                  还有 {words.length - 10} 个单词...
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.note}>
          <i className="fas fa-info-circle" />
          <span>删除后将无法恢复，请谨慎操作。</span>
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
          onClick={onConfirm}
          loading={deleting}
          disabled={deleting}
        >
          {deleting 
            ? (isSingleWord ? '删除中...' : '批量删除中...') 
            : (isSingleWord ? '确认删除' : `删除 ${words.length} 个单词`)
          }
        </Button>
      </div>
    </Modal>
  );
};

export default BatchDeleteModal;
