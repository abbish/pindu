import React from 'react';
import styles from './WordGrid.module.css';

export interface ExtractedWord {
  /** 单词ID */
  id: string;
  /** 英文单词 */
  word: string;
  /** 中文含义 */
  meaning: string;
  /** 词性 */
  partOfSpeech: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.' | 'art.' | 'det.';
  /** 出现次数 */
  frequency: number;
  /** 是否已选择 */
  selected: boolean;
  /** 自然拼读信息（可选） */
  phonics?: {
    ipa: string;
    syllables: string;
    phonics_rule: string;
    analysis_explanation: string;
    pos_abbreviation: string;
    pos_english: string;
    pos_chinese: string;
    frequency: number;
  };
}

export interface WordGridProps {
  /** 提取的单词列表 */
  words: ExtractedWord[];
  /** 单词选择变化回调 */
  onWordToggle: (wordId: string) => void;
  /** 全选/取消全选回调 */
  onSelectAll: (selected: boolean) => void;
  /** 按词性选择回调 */
  onSelectByPartOfSpeech?: (partOfSpeech: string, selected: boolean) => void;
  /** 加载状态 */
  loading?: boolean;
}

const PART_OF_SPEECH_CONFIG = {
  'n.': { label: '名词', color: 'blue' },
  'v.': { label: '动词', color: 'green' },
  'adj.': { label: '形容词', color: 'purple' },
  'adv.': { label: '副词', color: 'orange' },
  'prep.': { label: '介词', color: 'pink' },
  'conj.': { label: '连词', color: 'yellow' },
  'int.': { label: '感叹词', color: 'primary' },
  'pron.': { label: '代词', color: 'blue' },
  'art.': { label: '冠词', color: 'green' },
  'det.': { label: '限定词', color: 'purple' }
};

/**
 * 单词选择网格组件
 */
export const WordGrid: React.FC<WordGridProps> = ({
  words,
  onWordToggle,
  onSelectAll,
  onSelectByPartOfSpeech,
  loading = false
}) => {
  const selectedCount = words.filter(word => word.selected).length;
  const totalCount = words.length;
  const allSelected = totalCount > 0 && selectedCount === totalCount;

  const handleSelectAllClick = () => {
    onSelectAll(!allSelected);
  };

  // 获取词性统计
  const partOfSpeechStats = React.useMemo(() => {
    const stats: Record<string, { total: number; selected: number }> = {};
    words.forEach(word => {
      const pos = word.partOfSpeech;
      if (!stats[pos]) {
        stats[pos] = { total: 0, selected: 0 };
      }
      stats[pos].total++;
      if (word.selected) {
        stats[pos].selected++;
      }
    });
    return stats;
  }, [words]);

  // 按词性选择处理函数
  const handleSelectByPos = (partOfSpeech: string) => {
    const stat = partOfSpeechStats[partOfSpeech];
    if (!stat || !onSelectByPartOfSpeech) return;

    // 如果该词性的单词全部已选中，则取消选择；否则全选
    const shouldSelect = stat.selected < stat.total;
    onSelectByPartOfSpeech(partOfSpeech, shouldSelect);
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>分析中...</h3>
          <div className={styles.loadingIndicator}>
            <i className="fas fa-spinner fa-spin" />
            <span>正在提取单词...</span>
          </div>
        </div>
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className={styles.skeletonCard}>
              <div className={styles.skeletonCheckbox} />
              <div className={styles.skeletonContent}>
                <div className={styles.skeletonWord} />
                <div className={styles.skeletonMeaning} />
                <div className={styles.skeletonMeta}>
                  <div className={styles.skeletonTag} />
                  <div className={styles.skeletonFreq} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-search" />
          </div>
          <h3 className={styles.emptyTitle}>暂无提取的单词</h3>
          <p className={styles.emptyDescription}>
            请在上方输入文本内容或上传文件，然后点击"分析文本"来提取单词
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>提取的单词</h3>
        <div className={styles.headerActions}>
          <span className={styles.selectedCount}>
            已选择 <span className={styles.count}>{selectedCount}</span> 个单词
          </span>
          <button
            className={styles.selectAllBtn}
            onClick={handleSelectAllClick}
            type="button"
          >
            <i className={`fas fa-${allSelected ? 'times' : 'check-double'}`} />
            <span>{allSelected ? '取消全选' : '全选'}</span>
          </button>
        </div>
      </div>

      {/* 快速选择器 */}
      {onSelectByPartOfSpeech && Object.keys(partOfSpeechStats).length > 0 && (
        <div className={styles.quickSelector}>
          <div className={styles.selectorHeader}>
            <span className={styles.selectorTitle}>按词性快速选择：</span>
          </div>
          <div className={styles.selectorButtons}>
            {Object.entries(partOfSpeechStats).map(([pos, stat]) => {
              const posConfig = PART_OF_SPEECH_CONFIG[pos as keyof typeof PART_OF_SPEECH_CONFIG];
              const isFullySelected = stat.selected === stat.total;
              const isPartiallySelected = stat.selected > 0 && stat.selected < stat.total;

              return (
                <button
                  key={pos}
                  type="button"
                  className={`${styles.posButton} ${styles[posConfig?.color || 'primary']} ${
                    isFullySelected ? styles.fullySelected :
                    isPartiallySelected ? styles.partiallySelected : ''
                  }`}
                  onClick={() => handleSelectByPos(pos)}
                  title={`${posConfig?.label || pos}: ${stat.selected}/${stat.total} 已选择`}
                >
                  <span className={styles.posLabel}>{posConfig?.label || pos}</span>
                  <span className={styles.posCount}>
                    {stat.selected}/{stat.total}
                  </span>
                  <i className={`fas fa-${
                    isFullySelected ? 'check-circle' :
                    isPartiallySelected ? 'minus-circle' : 'circle'
                  }`} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.wordsGrid}>
        {words.map((word) => {
          const posConfig = PART_OF_SPEECH_CONFIG[word.partOfSpeech];
          
          return (
            <label
              key={word.id}
              className={`${styles.wordCard} ${word.selected ? styles.selected : ''}`}
            >
              <input
                type="checkbox"
                checked={word.selected}
                onChange={() => onWordToggle(word.id)}
                className={styles.checkbox}
              />
              <div className={styles.wordContent}>
                <div className={styles.wordText}>{word.word}</div>
                <div className={styles.wordMeaning}>{word.meaning}</div>

                {/* 显示自然拼读信息 */}
                {word.phonics && (
                  <div className={styles.phonicsInfo}>
                    <div className={styles.phonicsRow}>
                      <span className={styles.phonicsLabel}>音节:</span>
                      <span className={styles.phonicsValue}>{word.phonics.syllables}</span>
                    </div>
                    <div className={styles.phonicsRow}>
                      <span className={styles.phonicsLabel}>音标:</span>
                      <span className={styles.phonicsValue}>{word.phonics.ipa}</span>
                    </div>
                    <div className={styles.phonicsRow}>
                      <span className={styles.phonicsLabel}>拼读规则:</span>
                      <span className={styles.phonicsValue}>{word.phonics.phonics_rule}</span>
                    </div>
                    {word.phonics.analysis_explanation && (
                      <div className={styles.phonicsExplanation}>
                        <span className={styles.phonicsLabel}>分析:</span>
                        <span className={styles.explanationText}>{word.phonics.analysis_explanation}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className={styles.wordMeta}>
                  <span
                    className={`${styles.partOfSpeech} ${styles[posConfig.color]}`}
                    title={posConfig.label}
                  >
                    {word.partOfSpeech}
                  </span>
                  {word.phonics ? (
                    <span className={styles.frequency}>
                      频率: {word.phonics.frequency}
                    </span>
                  ) : (
                    <span className={styles.frequency}>
                      出现 {word.frequency} 次
                    </span>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default WordGrid;