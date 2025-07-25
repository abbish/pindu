import React from 'react';
import styles from './VoiceSelector.module.css';

export interface TTSVoice {
  id: number;
  providerId: number;
  voiceId: string;
  voiceName: string;
  displayName: string;
  language: string;
  gender?: string;
  description?: string;
  modelId: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSelectorProps {
  /** 语音列表 */
  voices: TTSVoice[];
  /** 当前选中的语音ID */
  selectedVoiceId?: string;
  /** 语音选择回调 */
  onVoiceSelect: (voiceId: string) => void;
  /** 试听语音回调 */
  onVoiceTest: (voiceId: string) => void;
  /** 是否正在试听 */
  testingVoiceId?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 标题 */
  title?: string;
  /** 描述 */
  description?: string;
}

/**
 * 语音选择器组件 - 卡片式选择器，类似单词本选择器
 */
export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onVoiceSelect,
  onVoiceTest,
  testingVoiceId,
  disabled = false,
  title = "选择默认语音",
  description = "选择一个语音作为默认的文本转语音引擎"
}) => {
  const handleVoiceSelect = (voiceId: string) => {
    if (!disabled) {
      onVoiceSelect(voiceId);
    }
  };

  const handleVoiceTest = (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation(); // 防止触发选择事件
    if (!disabled) {
      onVoiceTest(voiceId);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{description}</p>
      </div>

      <div className={styles.voicesList}>
        {voices.map((voice) => {
          const isSelected = selectedVoiceId === voice.voiceId;
          const isTesting = testingVoiceId === voice.voiceId;

          return (
            <div
              key={voice.voiceId}
              className={`${styles.voiceItem} ${isSelected ? styles.selected : ''} ${disabled ? styles.disabled : ''}`}
              onClick={() => handleVoiceSelect(voice.voiceId)}
            >
              <div className={styles.voiceLabel}>
                {/* 选择指示器 */}
                <div className={`${styles.radioButton} ${isSelected ? styles.checked : ''}`}>
                  {isSelected && <div className={styles.radioInner} />}
                </div>

                {/* 语音信息 */}
                <div className={styles.voiceContent}>
                  <div className={styles.voiceHeader}>
                    <h4 className={styles.voiceTitle}>{voice.displayName}</h4>
                    <div className={styles.voiceActions}>
                      <button
                        type="button"
                        className={`${styles.testButton} ${isTesting ? styles.testing : ''}`}
                        onClick={(e) => handleVoiceTest(e, voice.voiceId)}
                        disabled={disabled || isTesting}
                        title="试听语音"
                      >
                        {isTesting ? (
                          <>
                            <i className="fas fa-spinner fa-spin" />
                            试听中
                          </>
                        ) : (
                          <>
                            <i className="fas fa-play" />
                            试听
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className={styles.voiceDetails}>
                    <div className={styles.voiceInfo}>
                      <span className={styles.voiceLanguage}>
                        <i className="fas fa-globe" />
                        {voice.language === 'en' ? '英语' : voice.language}
                      </span>
                      {voice.gender && (
                        <span className={styles.voiceGender}>
                          <i className={voice.gender === 'female' ? 'fas fa-venus' : 'fas fa-mars'} />
                          {voice.gender === 'female' ? '女声' : '男声'}
                        </span>
                      )}
                    </div>
                    {voice.description && (
                      <p className={styles.voiceDescription}>{voice.description}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {voices.length === 0 && (
        <div className={styles.emptyState}>
          <i className="fas fa-microphone-slash" />
          <h4>暂无可用语音</h4>
          <p>请检查TTS服务配置或联系管理员</p>
        </div>
      )}
    </div>
  );
};
