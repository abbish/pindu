import { useState, useRef, useCallback, useEffect } from 'react';
import { ttsService } from '../services/ttsService';
import { useToast } from '../components';

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  duration: number;
  currentTime: number;
}

export interface UseAudioPlayerOptions {
  /** 默认语音ID */
  defaultVoiceId?: string;
  /** 是否自动清理错误状态 */
  autoClearError?: boolean;
  /** 错误自动清理延迟（毫秒） */
  errorClearDelay?: number;
}

export const useAudioPlayer = (options: UseAudioPlayerOptions = {}) => {
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  
  const {
    defaultVoiceId,
    autoClearError = true,
    errorClearDelay = 5000
  } = options;

  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    isLoading: false,
    error: null,
    duration: 0,
    currentTime: 0,
  });

  const updateState = useCallback((updates: Partial<AudioPlayerState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // 自动清理错误状态
  useEffect(() => {
    if (state.error && autoClearError) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        updateState({ error: null });
      }, errorClearDelay);
    }
  }, [state.error, autoClearError, errorClearDelay, updateState]);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeEventListener('loadedmetadata', () => {});
      audioRef.current.removeEventListener('timeupdate', () => {});
      audioRef.current.removeEventListener('play', () => {});
      audioRef.current.removeEventListener('pause', () => {});
      audioRef.current.removeEventListener('ended', () => {});
      audioRef.current.removeEventListener('error', () => {});
      audioRef.current = null;
    }
  }, []);

  const convertAudioUrl = useCallback((audioUrl: string): string => {
    if (audioUrl.startsWith('tts-cache://')) {
      // 转换为Tauri资源URL
      const filePath = audioUrl.replace('tts-cache://', '');
      return `asset://localhost/${filePath}`;
    }
    return audioUrl;
  }, []);

  // setupAudioEvents 函数已被内联到 playAudio 中，这里移除重复定义

  const playText = useCallback(async (text: string, voiceId?: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        updateState({ isLoading: true, error: null });

        // 清理之前的音频
        cleanupAudio();

        // 调用TTS服务
        const result = await ttsService.textToSpeech({
          text,
          voiceId: voiceId || defaultVoiceId,
          useCache: true
        });

        if (!result.success) {
          throw new Error(result.error || 'TTS服务调用失败');
        }

        // 处理音频URL
        const audioUrl = convertAudioUrl(result.data.audioUrl);

        // 创建音频元素
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        // 设置事件监听器，包括播放完成的Promise resolve
        const setupAudioEventsWithPromise = (audio: HTMLAudioElement) => {
          audio.addEventListener('loadedmetadata', () => {
            updateState({ duration: audio.duration });
          });

          audio.addEventListener('timeupdate', () => {
            updateState({ currentTime: audio.currentTime });
          });

          audio.addEventListener('play', () => {
            updateState({ isPlaying: true, isLoading: false });
          });

          audio.addEventListener('pause', () => {
            updateState({ isPlaying: false });
          });

          audio.addEventListener('ended', () => {
            updateState({ isPlaying: false, currentTime: 0 });
            resolve(); // 播放完成时resolve Promise
          });

          audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            const errorMessage = '音频播放失败';
            updateState({
              isPlaying: false,
              isLoading: false,
              error: errorMessage
            });
            toast.showError('播放失败', '音频播放时发生错误');
            reject(new Error(errorMessage));
          });
        };

        setupAudioEventsWithPromise(audio);

        // 开始播放
        await audio.play();

        if (result.data.cached) {
          console.log('使用缓存的音频文件');
        } else {
          console.log('生成新的音频文件');
        }

      } catch (error) {
        console.error('TTS播放失败:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        updateState({
          isLoading: false,
          error: errorMessage
        });

        // 根据错误类型显示不同的提示
        if (errorMessage.includes('API key')) {
          toast.showError('配置错误', '请在设置中配置有效的TTS API密钥');
        } else if (errorMessage.includes('网络')) {
          toast.showError('网络错误', '请检查网络连接后重试');
        } else {
          toast.showError('播放失败', '语音生成失败，请稍后重试');
        }

        reject(error);
      }
    });
  }, [updateState, cleanupAudio, convertAudioUrl, defaultVoiceId, toast]);

  const playWord = useCallback(async (word: string, voiceId?: string) => {
    return playText(word, voiceId);
  }, [playText]);

  const playSentence = useCallback(async (sentence: string, voiceId?: string) => {
    return playText(sentence, voiceId);
  }, [playText]);

  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(console.error);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      updateState({ isPlaying: false, currentTime: 0 });
    }
  }, [updateState]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(time, audioRef.current.duration));
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanupAudio();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [cleanupAudio]);

  return {
    state,
    playText,
    playWord,
    playSentence,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    clearError,
  };
};
