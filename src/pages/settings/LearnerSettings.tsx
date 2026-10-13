import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { PageError } from '@/components/PageError';
import { OptionSelect, usePromptProfile, type Option } from './promptProfileShared';
import { PronunciationSection } from './PronunciationSection';

const PRESETS: Option[] = [
  { value: 'primary', label: '小学生' },
  { value: 'secondary', label: '中学生' },
  { value: 'adult', label: '成人' },
];
const LEARNERS: Option[] = [
  { value: 'primary', label: '小学生' },
  { value: 'junior', label: '初中生' },
  { value: 'senior', label: '高中生' },
  { value: 'adult', label: '成人' },
];
const LEVELS: Option[] = [
  { value: 'auto', label: '自动' },
  { value: 'a1', label: '入门 A1' },
  { value: 'a2', label: '初级 A2' },
  { value: 'b1', label: '中级 B1' },
  { value: 'b2', label: '中高级 B2' },
];
const LANGUAGES: Option[] = [
  { value: 'zh', label: '中文为主' },
  { value: 'mixed', label: '中英混合' },
  { value: 'en', label: '英文为主' },
];
const IPAS: Option[] = [
  { value: 'british', label: '英式' },
  { value: 'american', label: '美式' },
];
const LENGTHS: Option[] = [
  { value: 'brief', label: '精简' },
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '详细' },
];
const MEMORY_METHODS: Option[] = [
  { value: 'auto', label: '自动' },
  { value: 'phonics', label: '拼读与拼写规律' },
  { value: 'morphology', label: '构词与词根词缀' },
  { value: 'imagery', label: '场景画面与造句' },
];

const splitInterests = (text: string) =>
  text
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * 设置 → 学习者：学习者是谁、水平、讲解用什么语言、怎么讲，所有 AI 功能都按它调整（模板见 src-tauri/src/prompts/）。
 */
export const LearnerSettings: React.FC = () => {
  const { profile, saving, loadError, reload, save, applyPreset } = usePromptProfile();
  const [interestsDraft, setInterestsDraft] = useState('');
  const interests = profile?.interests.join('、') ?? '';
  useEffect(() => setInterestsDraft(interests), [interests]);

  if (!profile) {
    return (
      <SettingsPanel title="学习者">
        {loadError ? <PageError title="无法加载学习者设置" message={loadError} onRetry={reload} /> : <Skeleton className="h-72 rounded-xl" />}
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="学习者">
      <SettingsSection title="学习者">
        <SettingsRow label="快速套用">
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <Button key={p.value} variant="outline" size="sm" disabled={saving} onClick={() => applyPreset(p.value, p.label)}>
                {p.label}
              </Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="学习者">
          <OptionSelect label="学习者" value={profile.learner} options={LEARNERS} disabled={saving} onChange={(v) => save({ learner: v })} />
        </SettingsRow>
        <SettingsRow label="英语水平">
          <OptionSelect label="英语水平" value={profile.level} options={LEVELS} disabled={saving} onChange={(v) => save({ level: v })} />
        </SettingsRow>
        <SettingsRow label="兴趣场景">
          <Input
            value={interestsDraft}
            disabled={saving}
            onChange={(e) => setInterestsDraft(e.target.value)}
            onBlur={() => {
              const next = splitInterests(interestsDraft);
              if (next.join('、') !== interests) save({ interests: next });
            }}
            placeholder="例如：足球、旅行、编程"
            aria-label="兴趣场景"
            className="w-56"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="讲解">
        <SettingsRow label="讲解语言">
          <OptionSelect label="讲解语言" value={profile.language} options={LANGUAGES} disabled={saving} onChange={(v) => save({ language: v })} />
        </SettingsRow>
        <SettingsRow label="讲解详略">
          <OptionSelect label="讲解详略" value={profile.explainLength} options={LENGTHS} disabled={saving} onChange={(v) => save({ explainLength: v })} />
        </SettingsRow>
        <SettingsRow label="记忆方法">
          <OptionSelect label="记忆方法" value={profile.memoryMethod} options={MEMORY_METHODS} disabled={saving} onChange={(v) => save({ memoryMethod: v })} />
        </SettingsRow>
        <SettingsRow label="音标">
          <OptionSelect label="音标" value={profile.ipa} options={IPAS} disabled={saving} onChange={(v) => save({ ipa: v })} className="w-32" />
        </SettingsRow>
      </SettingsSection>

      <PronunciationSection />
    </SettingsPanel>
  );
};
