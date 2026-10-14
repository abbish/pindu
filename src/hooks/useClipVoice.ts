import { useCallback, useEffect, useState } from 'react';

/** 场景片段朗读用原声还是 AI 朗读 */
export type ClipVoice = 'original' | 'ai';

const KEY = 'passage.clipVoice';
const EVENT = 'pindu:clip-voice';

const read = (): ClipVoice => {
  try {
    return localStorage.getItem(KEY) === 'ai' ? 'ai' : 'original';
  } catch {
    return 'original';
  }
};

/**
 * 场景片段的朗读来源（原文朗读、听力练习共用一个偏好，默认原声：带着原来的语气语调）。记在本机，各处同步。
 */
export function useClipVoice(): [ClipVoice, (voice: ClipVoice) => void] {
  const [voice, setVoiceState] = useState<ClipVoice>(read);
  useEffect(() => {
    const sync = () => setVoiceState(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const setVoice = useCallback((next: ClipVoice) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 本机存不了就只在这次生效
    }
    setVoiceState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [voice, setVoice];
}
