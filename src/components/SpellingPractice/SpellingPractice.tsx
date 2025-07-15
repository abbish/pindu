import React, { useState, useEffect } from 'react';
import styles from './SpellingPractice.module.css';
import type { WordData } from '../WordCard';

export interface SpellingPracticeProps {
  /** 当前学习的单词 */
  word: WordData;
  /** 检查拼写回调 */
  onCheckSpelling?: (word: WordData, userInput: string, isCorrect: boolean) => void;
  /** 下一个单词回调 */
  onNext?: () => void;
  /** 是否显示结果 */
  showResult?: boolean;
  /** 拼写是否正确 */
  isCorrect?: boolean;
  /** 禁用状态 */
  disabled?: boolean;
}

/**
 * 拼写练习组件
 */
export const SpellingPractice: React.FC<SpellingPracticeProps> = ({
  word,
  onCheckSpelling,
  onNext,
  showResult = false,
  isCorrect = false,
  disabled = false
}) => {
  const [userInput, setUserInput] = useState('');

  // Reset input when word changes
  useEffect(() => {
    setUserInput('');
  }, [word.id]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled) {
      setUserInput(e.target.value);
    }
  };

  const handleCheckSpelling = () => {
    if (!userInput.trim() || disabled) return;
    
    const inputLower = userInput.trim().toLowerCase();
    const correctLower = word.word.toLowerCase();
    const correct = inputLower === correctLower;
    
    onCheckSpelling?.(word, userInput.trim(), correct);
  };

  const handleNext = () => {
    setUserInput('');
    onNext?.();
  };


  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !showResult) {
      handleCheckSpelling();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-pencil-alt" />
          练习拼写
        </h3>
        <p className={styles.instruction}>请输入这个单词的拼写</p>
      </div>

      <div className={styles.inputSection}>
        <div className={styles.inputWrapper}>
          <input
            type="text"
            value={userInput}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="在这里输入单词..."
            className={`${styles.input} ${showResult ? (isCorrect ? styles.correct : styles.incorrect) : ''}`}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
          <div className={styles.inputIcon}>
            <i className="fas fa-keyboard" />
          </div>
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

        <div className={styles.actionButtons}>
          {!showResult ? (
            <button 
              className={styles.checkBtn}
              onClick={handleCheckSpelling}
              disabled={!userInput.trim() || disabled}
              type="button"
            >
              <i className="fas fa-check" />
              确认拼写
            </button>
          ) : (
            <button 
              className={styles.nextBtn}
              onClick={handleNext}
              type="button"
            >
              <i className="fas fa-arrow-right" />
              下一个
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpellingPractice;