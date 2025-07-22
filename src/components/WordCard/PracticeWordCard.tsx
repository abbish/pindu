import React, { useState } from 'react';
import { WordPracticeStep } from '../../types/study';
import styles from './PracticeWordCard.module.css';

export interface PracticeWordData {
  /** 单词ID */
  id: number;
  /** 英文单词 */
  word: string;
  /** 中文释义 */
  meaning: string;
  /** 详细描述 */
  description?: string;
  /** IPA音标 */
  ipa?: string;
  /** 音节分割 */
  syllables?: string;
  /** 自然拼读分割 */
  phonicsSegments?: string[];
  /** 图片URL */
  imageUrl?: string;
}

export interface PracticeWordCardProps {
  /** 单词数据 */
  word: PracticeWordData;
  /** 当前练习步骤 */
  currentStep: WordPracticeStep;
  /** 步骤标题 */
  stepTitle: string;
  /** 步骤描述 */
  stepDescription: string;
  /** 用户输入值 */
  userInput: string;
  /** 输入变化回调 */
  onInputChange: (value: string) => void;
  /** 提交答案回调 */
  onSubmitAnswer: (userInput: string) => void;
  /** 播放发音回调 */
  onPlayPronunciation?: () => void;
  /** 显示结果状态 */
  showResult?: boolean;
  /** 是否正确 */
  isCorrect?: boolean;
  /** 禁用状态 */
  disabled?: boolean;
  /** 自动聚焦 */
  autoFocus?: boolean;
}

/**
 * 单词练习卡片组件 - 支持三步骤渐进式练习
 */
export const PracticeWordCard: React.FC<PracticeWordCardProps> = ({
  word,
  currentStep,
  stepTitle,
  stepDescription,
  userInput,
  onInputChange,
  onSubmitAnswer,
  onPlayPronunciation,
  showResult = false,
  isCorrect = false,
  disabled = false,
  autoFocus = true
}) => {
  const [inputFocused, setInputFocused] = useState(false);

  // 根据步骤确定显示内容
  const stepConfig = {
    [WordPracticeStep.STEP_1]: {
      showWord: true,
      showPhonetic: true,
      showMeaning: true,
      showPhonics: true,
      showSyllables: true,
      showAudio: true,
      placeholder: "请输入单词拼写..."
    },
    [WordPracticeStep.STEP_2]: {
      showWord: false,
      showPhonetic: true,
      showMeaning: true,
      showPhonics: true,
      showSyllables: true, // ✅ 修改为 true，显示音节
      showAudio: true,
      placeholder: "根据提示输入单词..."
    },
    [WordPracticeStep.STEP_3]: {
      showWord: false,
      showPhonetic: false,
      showMeaning: true,
      showPhonics: true,
      showSyllables: true, // ✅ 修改为 true，显示音节
      showAudio: true,
      placeholder: "根据中文释义输入单词..."
    }
  };

  const config = stepConfig[currentStep];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled) {
      onInputChange(e.target.value);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !showResult && userInput.trim()) {
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!userInput.trim() || disabled || showResult) return;
    onSubmitAnswer(userInput.trim());
  };

  const handlePlayAudio = () => {
    if (onPlayPronunciation) {
      onPlayPronunciation();
    }
  };

  return (
    <div className={styles.practiceCard}>
      {/* 步骤标题和描述 */}
      <div className={styles.stepHeader}>
        <div className={styles.stepInfo}>
          <h3 className={styles.stepTitle}>{stepTitle}</h3>
          <p className={styles.stepDescription}>{stepDescription}</p>
        </div>
      </div>

      {/* 单词信息区域 */}
      <div className={styles.wordSection}>
        {/* 英文单词 - 根据步骤显示/隐藏 */}
        {config.showWord && (
          <div className={styles.wordDisplay}>
            <h1 className={styles.wordText}>{word.word}</h1>
          </div>
        )}

        {/* 语音朗读按钮 - 独立一行 */}
        {config.showAudio && (
          <div className={styles.audioSection}>
            <button
              className={styles.audioBtn}
              onClick={handlePlayAudio}
              title="播放发音"
              type="button"
            >
              <i className="fas fa-volume-up" />
            </button>
          </div>
        )}

        {/* 音标和音节 - 一行两列 */}
        {(config.showPhonetic && word.ipa) || (config.showSyllables && word.syllables) ? (
          <div className={styles.phoneticSyllablesRow}>
            {/* 音标列 */}
            {config.showPhonetic && word.ipa && (
              <div className={styles.phoneticColumn}>
                <span className={styles.phoneticLabel}>音标：</span>
                <span className={styles.phoneticText}>{word.ipa}</span>
              </div>
            )}

            {/* 音节列 */}
            {config.showSyllables && word.syllables && (
              <div className={styles.syllablesColumn}>
                <span className={styles.syllablesLabel}>音节：</span>
                <span className={styles.syllablesText}>{word.syllables}</span>
              </div>
            )}
          </div>
        ) : null}

        {/* 中文释义 - 独立一行 */}
        {config.showMeaning && (
          <div className={styles.meaningSection}>
            <div className={styles.meaningRow}>
              <span className={styles.meaningLabel}>释义：</span>
              <span className={styles.meaningText}>{word.meaning}</span>
            </div>
            {word.description && (
              <div className={styles.descriptionRow}>
                <span className={styles.descriptionLabel}>详解：</span>
                <span className={styles.descriptionText}>{word.description}</span>
              </div>
            )}
          </div>
        )}

        {/* 自然拼读 - 独立一行 */}
        {config.showPhonics && word.phonicsSegments && word.phonicsSegments.length > 0 && (
          <div className={styles.phonicsSection}>
            <div className={styles.phonicsRow}>
              <span className={styles.phonicsLabel}>拼读：</span>
              <div className={styles.phonicsSegments}>
                {word.phonicsSegments.map((segment, index) => (
                  <span key={index} className={styles.phonicsSegment}>
                    {segment}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className={styles.inputSection}>
        <div className={styles.inputWrapper}>
          <input
            type="text"
            value={userInput}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={config.placeholder}
            className={`${styles.practiceInput} ${
              showResult ? (isCorrect ? styles.correct : styles.incorrect) : ''
            } ${inputFocused ? styles.focused : ''}`}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
            autoFocus={autoFocus}
          />
          <div className={styles.inputIcon}>
            <i className="fas fa-keyboard" />
          </div>
        </div>

        {/* 结果显示 */}
        {showResult && (
          <div className={`${styles.resultDisplay} ${isCorrect ? styles.success : styles.error}`}>
            <div className={styles.resultIcon}>
              <i className={`fas fa-${isCorrect ? 'check-circle' : 'times-circle'}`} />
            </div>
            <div className={styles.resultText}>
              {isCorrect ? '正确！' : '再试一次'}
            </div>
            {!isCorrect && (
              <div className={styles.correctAnswer}>
                正确答案：<strong>{word.word}</strong>
              </div>
            )}
          </div>
        )}

        {/* 提交按钮 */}
        {!showResult && (
          <button 
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={!userInput.trim() || disabled}
            type="button"
          >
            <i className="fas fa-check" />
            <span>确认</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PracticeWordCard;
