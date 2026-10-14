import React from 'react';
import { SettingsPanel } from '@/components/SettingsLayout/SettingsLayout';
import { AudioDevices } from './AudioDevices';
import { PronunciationSection } from './PronunciationSection';
import { TTSSettings } from './TTSSettings';

/** 设置「朗读与发音」：朗读的音色与风格（豆包语音），跟读评估的开关与评分宽严，扬声器与麦克风（选择、测试、音量与增益、说完后多久停） */
export const VoiceSettings: React.FC<{ onOpenService: () => void }> = ({ onOpenService }) => (
  <SettingsPanel title="朗读与发音">
    <TTSSettings part="voice" onOpenService={onOpenService} />
    <PronunciationSection />
    <AudioDevices />
  </SettingsPanel>
);
