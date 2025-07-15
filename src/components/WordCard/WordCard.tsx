import React from 'react';
import styles from './WordCard.module.css';

export interface WordData {
  /** 单词ID */
  id: string;
  /** 英文单词 */
  word: string;
  /** 中文释义 */
  meaning: string;
  /** 详细描述 */
  description?: string;
  /** 音标 */
  phonetic?: string;
  /** IPA音标 */
  ipa?: string;
  /** 音节分割 */
  syllables?: string;
  /** 图片URL */
  imageUrl?: string;
  /** 自然拼读分割 */
  phonicsSegments?: string[];
}

export interface WordCardProps {
  /** 单词数据 */
  word: WordData;
  /** 播放发音回调 */
  onPlayPronunciation?: (word: WordData) => void;
  /** 检查拼写回调 */
  onCheckSpelling?: (word: WordData, userInput: string, isCorrect: boolean) => void;
  /** 单词详解回调 */
  onShowDetails?: (word: WordData) => void;
  /** 是否显示结果 */
  showResult?: boolean;
  /** 拼写是否正确 */
  isCorrect?: boolean;
  /** 用户输入值 */
  userInput?: string;
  /** 输入变化回调 */
  onInputChange?: (value: string) => void;
  /** 禁用状态 */
  disabled?: boolean;
}

/**
 * 单词学习卡片组件
 */
export const WordCard: React.FC<WordCardProps> = ({
  word,
  onPlayPronunciation,
  onCheckSpelling,
  onShowDetails,
  showResult = false,
  isCorrect = false,
  userInput = '',
  onInputChange,
  disabled = false
}) => {
  const handlePlayPronunciation = () => {
    onPlayPronunciation?.(word);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled) {
      onInputChange?.(e.target.value);
    }
  };

  const handleCheckSpelling = () => {
    if (!userInput.trim() || disabled) return;
    
    const inputLower = userInput.trim().toLowerCase();
    const correctLower = word.word.toLowerCase();
    const correct = inputLower === correctLower;
    
    onCheckSpelling?.(word, userInput.trim(), correct);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !showResult) {
      handleCheckSpelling();
    }
  };

  const handleShowDetails = () => {
    onShowDetails?.(word);
  };

  return (
    <div className={styles.card}>
      {/* Main Word Section */}
      <div className={styles.wordSection}>
        <div className={styles.wordHeader}>
          <div className={styles.wordWithIpa}>
            <h2 className={styles.wordText}>{word.word}</h2>
            {word.ipa && (
              <div className={styles.ipaSubtitle}>{word.ipa}</div>
            )}
          </div>
          <div className={styles.actionIcons}>
            <button 
              className={styles.actionBtn}
              onClick={handlePlayPronunciation}
              title="播放发音"
            >
              <i className="fas fa-volume-up" />
            </button>
            <button 
              className={styles.actionBtn}
              onClick={handleShowDetails}
              title="单词详解"
              type="button"
            >
              <i className="fas fa-question" />
            </button>
          </div>
        </div>
        
        {/* Translation - moved directly under the word */}
        <p className={styles.meaning}>{word.meaning}</p>
        {word.description && (
          <p className={styles.description}>{word.description}</p>
        )}
        
        {/* Syllables and Natural Phonics */}
        {(word.syllables || (word.phonicsSegments && word.phonicsSegments.length > 0)) && (
          <div className={styles.combinedPhoneticSection}>
            <div className={styles.phoneticHeader}>
              <i className="fas fa-microphone-alt" />
              <span>音节与拼读</span>
            </div>
            <div className={styles.combinedPhoneticContent}>
              {/* Syllables Visualization */}
              {word.syllables && (
                <div className={styles.syllablesGroup}>
                  <div className={styles.syllablesLabel}>Syllables</div>
                  <div className={styles.syllablesSegments}>
                    {word.syllables.split('-').map((syllable, index) => (
                      <span key={index} className={styles.syllableSegment}>
                        {syllable}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Natural Phonics */}
              {word.phonicsSegments && word.phonicsSegments.length > 0 && (
                <div className={styles.phonicsGroup}>
                  <div className={styles.phonicsLabel}>Natural Phonics</div>
                  <div className={styles.phonicsSegments}>
                    {word.phonicsSegments.map((segment, index) => (
                      <span key={index} className={styles.phonicsSegment}>
                        {segment}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>


      {/* Spelling Practice Section */}
      <div className={styles.spellingSection}>
        <div className={styles.spellingHeader}>
          <i className="fas fa-pencil-alt" />
          <span>练习拼写</span>
        </div>
        
        <div className={styles.inputWrapper}>
          <input
            type="text"
            value={userInput}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="在这里输入单词..."
            className={`${styles.spellingInput} ${showResult ? (isCorrect ? styles.correct : styles.incorrect) : ''}`}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
        </div>

        {/* Result Display */}
        {showResult && (
          <div className={`${styles.result} ${isCorrect ? styles.success : styles.error}`}>
            <div className={styles.resultIcon}>
              <i className={`fas fa-${isCorrect ? 'check' : 'times'}`} />
            </div>
            <div className={styles.resultText}>
              {isCorrect ? '答对了！' : '再试一次'}
            </div>
            {!isCorrect && (
              <div className={styles.correctAnswer}>
                正确答案：<strong>{word.word}</strong>
              </div>
            )}
          </div>
        )}

        {/* Action Button */}
        {!showResult && (
          <button 
            className={styles.checkBtn}
            onClick={handleCheckSpelling}
            disabled={!userInput.trim() || disabled}
            type="button"
          >
            <i className="fas fa-check" />
            确认拼写
          </button>
        )}
      </div>

    </div>
  );
};

export default WordCard;