import React, { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { pronunciationService } from '@/services/pronunciationService';
import { invalidatePronunciationCache } from '@/hooks/usePronunciation';
import type { PronunciationSettings } from '@/types/pronunciation';
import { OptionSelect, type Option } from './promptProfileShared';

const STRICTNESS: Option[] = [
  { value: 'auto', label: '自动' },
  { value: 'lenient', label: '宽松' },
  { value: 'standard', label: '标准' },
  { value: 'strict', label: '严格' },
];

/**
 * 「朗读与发音」里的发音：跟读评估开关、评分严格程度（自动 = 小学生宽松，其余标准）。
 * 评估模型在「本机模型」里下载 / 删除。
 */
export const PronunciationSection: React.FC = () => {
  const toast = useToast();
  const [settings, setSettings] = useState<PronunciationSettings | null>(null);

  useEffect(() => {
    void pronunciationService.status().then((r) => r.success && setSettings(r.data.settings));
  }, []);

  if (!settings) return null;

  const save = async (patch: Partial<PronunciationSettings>) => {
    const r = await pronunciationService.updateSettings({ ...settings, ...patch });
    invalidatePronunciationCache();
    if (r.success) setSettings(r.data);
    else toast.showError('无法保存发音设置', r.error);
  };
  return (
    <SettingsSection title="发音">
      <SettingsRow label="跟读评估" htmlFor="pron-enabled">
        <Switch id="pron-enabled" checked={settings.enabled} onCheckedChange={(enabled) => void save({ enabled })} />
      </SettingsRow>
      <SettingsRow label="评分">
        <OptionSelect
          label="评分"
          value={settings.strictness}
          options={STRICTNESS}
          onChange={(v) => void save({ strictness: v as PronunciationSettings['strictness'] })}
          className="w-32"
        />
      </SettingsRow>
    </SettingsSection>
  );
};
