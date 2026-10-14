import { loadMicPrefs } from './microphone.ts';

/**
 * 扬声器与音量（「设置 → 朗读与发音 → 扬声器」）：经 playbackTail 登记的放音元素（朗读、原声、视频、听自己的录音）每次开始放时按设置定音量、选扬声器。
 * 选扬声器要系统的网页内核支持（setSinkId，Windows 支持；不支持时只能跟随系统）。
 */
type SinkElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

export function canChooseSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/** 按设置定音量与扬声器（换不了的扬声器照用系统默认） */
export function applyOutput(el: EventTarget) {
  if (typeof HTMLMediaElement === 'undefined' || !(el instanceof HTMLMediaElement)) return;
  const { volume, speakerId } = loadMicPrefs();
  el.volume = volume;
  const media = el as SinkElement;
  if (canChooseSpeaker() && (media as { sinkId?: string }).sinkId !== speakerId) void media.setSinkId?.(speakerId).catch(() => undefined);
}
