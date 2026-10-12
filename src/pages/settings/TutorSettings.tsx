import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { agentSettingsService, type AgentSettings, type TutorPermission, type UpdateAgentSettingsRequest } from '@/services/agentSettingsService';
import { CHARACTER_MAX_CHARS } from '@/services/promptProfileService';
import { OptionSelect, usePromptProfile, type Option } from './promptProfileShared';

const STYLES: Option[] = [
  { value: 'gentle', label: '温和鼓励' },
  { value: 'concise', label: '简洁直接' },
  { value: 'socratic', label: '引导式' },
  { value: 'lively', label: '轻松幽默' },
];
const PERMISSIONS: { value: TutorPermission; label: string }[] = [
  { value: 'ask_delete', label: '删除前问我' },
  { value: 'ask_changes', label: '改动前都问我' },
  { value: 'view_only', label: '只查看，不改动' },
];

/**
 * 设置 → AI 老师：老师的人设（名字、说话风格、怎么称呼你、人设描述），对话里能做哪些改动、要不要推荐下一步。
 * 人设存在学习者档案里，练习时的讲解、答疑与「AI 老师」对话共用；对话设置存在 AI 任务设置里。
 */
export const TutorSettings: React.FC = () => {
  const toast = useToast();
  const { profile, saving, loadError, reload, save } = usePromptProfile();
  const [agent, setAgent] = useState<AgentSettings | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [callDraft, setCallDraft] = useState('');
  const [characterDraft, setCharacterDraft] = useState('');

  useEffect(() => {
    agentSettingsService.getSettings().then((r) => {
      if (r.success) setAgent(r.data);
      else toast.showError('无法加载对话设置', r.error);
    });
  }, []);
  useEffect(() => setNameDraft(profile?.tutorName ?? ''), [profile?.tutorName]);
  useEffect(() => setCallDraft(profile?.learnerName ?? ''), [profile?.learnerName]);
  useEffect(() => setCharacterDraft(profile?.tutorCharacter ?? ''), [profile?.tutorCharacter]);

  const saveAgent = async (request: UpdateAgentSettingsRequest) => {
    setAgentSaving(true);
    const result = await agentSettingsService.updateSettings(request);
    setAgentSaving(false);
    if (result.success) setAgent(result.data);
    else toast.showError('无法保存设置', result.error);
  };

  if (!profile) {
    return (
      <SettingsPanel title="AI 老师">
        {loadError ? <PageError title="无法加载 AI 老师设置" message={loadError} onRetry={reload} /> : <Skeleton className="h-72 rounded-xl" />}
      </SettingsPanel>
    );
  }

  const character = characterDraft.trim();
  const characterChanged = character !== profile.tutorCharacter;
  const characterTooLong = character.length > CHARACTER_MAX_CHARS;

  return (
    <SettingsPanel title="AI 老师">
      <SettingsSection title="人设">
        <SettingsRow label="名字">
          <Input
            value={nameDraft}
            maxLength={20}
            disabled={saving}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => nameDraft.trim() !== profile.tutorName && save({ tutorName: nameDraft.trim() })}
            placeholder="英语老师"
            aria-label="AI 老师的名字"
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow label="说话风格">
          <OptionSelect label="说话风格" value={profile.tutorStyle} options={STYLES} disabled={saving} onChange={(v) => save({ tutorStyle: v })} />
        </SettingsRow>
        <SettingsRow label="怎么称呼你">
          <Input
            value={callDraft}
            maxLength={20}
            disabled={saving}
            onChange={(e) => setCallDraft(e.target.value)}
            onBlur={() => callDraft.trim() !== profile.learnerName && save({ learnerName: callDraft.trim() })}
            placeholder="你"
            aria-label="AI 老师怎么称呼你"
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow label="回答后出个小问题">
          <Switch checked={profile.tutorQuiz} disabled={saving} onCheckedChange={(v) => save({ tutorQuiz: v })} aria-label="回答后出个小问题" />
        </SettingsRow>
        <SettingsRow label="性格与说话方式" stacked>
          <Textarea
            value={characterDraft}
            rows={3}
            disabled={saving}
            onChange={(e) => setCharacterDraft(e.target.value)}
            placeholder="例如：像耐心的大学生学姐，说话轻松，喜欢用电影里的台词举例"
            aria-label="AI 老师的性格与说话方式"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className={characterTooLong ? 'text-destructive' : undefined}>
              {character.length} / {CHARACTER_MAX_CHARS}
            </span>
            <div className="flex gap-2">
              {characterChanged && (
                <Button variant="ghost" size="sm" onClick={() => setCharacterDraft(profile.tutorCharacter)}>
                  还原
                </Button>
              )}
              <Button size="sm" disabled={saving || !characterChanged || characterTooLong} onClick={() => save({ tutorCharacter: character }, '已保存')}>
                保存
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="对话">
        {agent ? (
          <>
            <SettingsRow label="改动你的内容">
              <OptionSelect
                label="改动你的内容"
                value={agent.tutorPermission}
                options={PERMISSIONS}
                disabled={agentSaving}
                onChange={(v) => saveAgent({ tutorPermission: v as TutorPermission })}
              />
            </SettingsRow>
            <SettingsRow label="回答后推荐下一步">
              <Switch
                checked={agent.tutorSuggestions}
                disabled={agentSaving}
                onCheckedChange={(v) => saveAgent({ tutorSuggestions: v })}
                aria-label="回答后推荐下一步"
              />
            </SettingsRow>
          </>
        ) : (
          <Skeleton className="h-20 rounded-xl" />
        )}
      </SettingsSection>
    </SettingsPanel>
  );
};
