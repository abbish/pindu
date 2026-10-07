import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { CUSTOM_MAX_CHARS, promptProfileService, type PromptPreview, type PromptProfile } from '@/services/promptProfileService';

type Option = { value: string; label: string };

const PRESETS: Option[] = [
  { value: 'primary', label: '小学生' },
  { value: 'secondary', label: '中学生' },
  { value: 'adult', label: '成人' },
];
const LEARNERS: Option[] = [
  { value: 'primary', label: '小学生（6–12 岁）' },
  { value: 'junior', label: '初中生' },
  { value: 'senior', label: '高中生' },
  { value: 'adult', label: '成人' },
];
const LEVELS: Option[] = [
  { value: 'auto', label: '按学习者自动' },
  { value: 'a1', label: '入门（A1）' },
  { value: 'a2', label: '初级（A2）' },
  { value: 'b1', label: '中级（B1）' },
  { value: 'b2', label: '中高级（B2）' },
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
  { value: 'brief', label: '精简（约 300 字）' },
  { value: 'standard', label: '标准（约 650 字）' },
  { value: 'detailed', label: '详细（约 1100 字）' },
];
const MEMORY_METHODS: Option[] = [
  { value: 'auto', label: '按单词自动选择' },
  { value: 'phonics', label: '拼读与拼写规律' },
  { value: 'morphology', label: '构词与词根词缀' },
  { value: 'imagery', label: '场景画面与造句' },
];
const TUTOR_STYLES: Option[] = [
  { value: 'gentle', label: '温和鼓励' },
  { value: 'concise', label: '简洁直接' },
  { value: 'socratic', label: '引导式（先提示再讲）' },
];
/** 可以写补充要求的任务（key 与后端 PromptTask 一致） */
const CUSTOM_TASKS: Option[] = [
  { value: 'explain', label: 'AI 讲解' },
  { value: 'tutor', label: 'AI 老师答疑' },
  { value: 'examples', label: '例句补充' },
  { value: 'phonics', label: '拼读分析' },
  { value: 'extract', label: '提取单词' },
  { value: 'generate', label: '按意图生成单词' },
  { value: 'plan', label: '学习计划排序' },
  { value: 'passage', label: '短文：写短文' },
  { value: 'passage_questions', label: '短文：出阅读理解题' },
  { value: 'passage_grade', label: '短文：开放题评分' },
];

const OptionSelect: React.FC<{
  value: string;
  options: Option[];
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}> = ({ value, options, label, disabled, onChange, className = 'w-56' }) => (
  <Select value={value} disabled={disabled} onValueChange={onChange}>
    <SelectTrigger className={className} aria-label={label}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const splitInterests = (text: string) =>
  text
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * 设置 → AI 助手 → 学习者与风格：学习者档案决定所有 AI 任务的讲解对象、语言难度与语气；
 * 讲解 / 答疑风格与补充要求注入对应任务的系统提示词（模板见 src-tauri/src/prompts/）。
 */
export const PromptProfileSettings: React.FC = () => {
  const toast = useToast();
  const [profile, setProfile] = useState<PromptProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [interestsDraft, setInterestsDraft] = useState('');
  const [tutorNameDraft, setTutorNameDraft] = useState('');
  const [customTask, setCustomTask] = useState('explain');
  const [customDraft, setCustomDraft] = useState('');
  const [previews, setPreviews] = useState<PromptPreview[] | null>(null);
  const [previewTask, setPreviewTask] = useState('explain');

  const syncDrafts = (p: PromptProfile, task = customTask) => {
    setInterestsDraft(p.interests.join('、'));
    setTutorNameDraft(p.tutorName);
    setCustomDraft(p.custom[task] ?? '');
  };

  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    promptProfileService.getProfile().then((r) => {
      if (cancelled) return;
      if (r.success) {
        setProfile(r.data);
        syncDrafts(r.data);
      }
      setLoadError(r.success ? null : r.error);
    });
    return () => {
      cancelled = true;
    };
    // syncDrafts 只依赖 state setter；按重试次数重新加载
  }, [reloadKey]);

  /** 选了就生效的设置成功时不提示；只有点按钮的操作（套用预设、保存补充要求）才给成功提示 */
  const applyResult = (result: Awaited<ReturnType<typeof promptProfileService.updateProfile>>, failTitle: string, message?: string) => {
    if (result.success) {
      setProfile(result.data);
      syncDrafts(result.data);
      if (message) toast.showSuccess(message);
    } else {
      toast.showError(failTitle, result.error);
    }
  };

  const save = async (patch: Partial<PromptProfile>, message?: string) => {
    if (!profile) return;
    setSaving(true);
    const result = await promptProfileService.updateProfile({ ...profile, ...patch });
    setSaving(false);
    applyResult(result, '无法保存设置', message);
  };

  const applyPreset = async (preset: string, label: string) => {
    setSaving(true);
    const result = await promptProfileService.applyPreset(preset);
    setSaving(false);
    applyResult(result, '无法套用预设', `已套用「${label}」预设`);
  };

  const openPreview = async () => {
    if (!profile) return;
    const result = await promptProfileService.preview(profile);
    if (result.success) setPreviews(result.data);
    else toast.showError('无法预览提示词', result.error);
  };

  if (!profile) {
    return (
      <SettingsSection title="学习者与风格">
        {loadError ? (
          <PageError title="无法加载学习者与风格" message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <Skeleton className="h-48 rounded-xl" />
        )}
      </SettingsSection>
    );
  }

  const savedCustom = profile.custom[customTask] ?? '';
  const customChanged = customDraft.trim() !== savedCustom;
  const customTooLong = customDraft.trim().length > CUSTOM_MAX_CHARS;
  const preview = previews?.find((p) => p.task === previewTask);

  return (
    <>
      <SettingsSection
        title="学习者"
        description="AI 讲解、例句、答疑都会按这里的学习者调整措辞和难度。修改后，已缓存的单词讲解会在下次打开时按新设置重新生成。"
        actions={
          <Button variant="outline" size="sm" onClick={openPreview}>
            预览提示词
          </Button>
        }
      >
        <SettingsRow label="快速套用" description="一键切换学习者、讲解语言和风格；兴趣场景、老师称呼与补充要求保持不变">
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <Button key={p.value} variant="outline" size="sm" disabled={saving} onClick={() => applyPreset(p.value, p.label)}>
                {p.label}
              </Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="学习者" description="决定讲解对象、称呼与语气">
          <OptionSelect label="学习者" value={profile.learner} options={LEARNERS} disabled={saving} onChange={(v) => save({ learner: v })} />
        </SettingsRow>
        <SettingsRow label="英语水平" description="决定例句长度与用词难度">
          <OptionSelect label="英语水平" value={profile.level} options={LEVELS} disabled={saving} onChange={(v) => save({ level: v })} />
        </SettingsRow>
        <SettingsRow label="讲解语言" description="AI 讲解和答疑用什么语言">
          <OptionSelect label="讲解语言" value={profile.language} options={LANGUAGES} disabled={saving} onChange={(v) => save({ language: v })} />
        </SettingsRow>
        <SettingsRow label="音标" description="拼读分析与讲解使用的音标体系">
          <OptionSelect label="音标" value={profile.ipa} options={IPAS} disabled={saving} onChange={(v) => save({ ipa: v })} className="w-32" />
        </SettingsRow>
        <SettingsRow label="兴趣场景" description="例句和讲解优先用这些场景，如 足球、旅行、编程；最多 8 个，用顿号或逗号分隔">
          <Input
            value={interestsDraft}
            disabled={saving}
            onChange={(e) => setInterestsDraft(e.target.value)}
            onBlur={() => {
              const next = splitInterests(interestsDraft);
              if (next.join('、') !== profile.interests.join('、')) save({ interests: next });
            }}
            placeholder="未设置"
            aria-label="兴趣场景"
            className="w-56"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="AI 讲解">
        <SettingsRow label="详略" description="单词讲解的篇幅">
          <OptionSelect label="讲解详略" value={profile.explainLength} options={LENGTHS} disabled={saving} onChange={(v) => save({ explainLength: v })} />
        </SettingsRow>
        <SettingsRow label="记忆方法" description="「这样记最牢」一节优先使用的方法">
          <OptionSelect label="记忆方法" value={profile.memoryMethod} options={MEMORY_METHODS} disabled={saving} onChange={(v) => save({ memoryMethod: v })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="AI 老师">
        <SettingsRow label="称呼" description="AI 老师的名字，留空即“英语老师”">
          <Input
            value={tutorNameDraft}
            maxLength={20}
            disabled={saving}
            onChange={(e) => setTutorNameDraft(e.target.value)}
            onBlur={() => tutorNameDraft.trim() !== profile.tutorName && save({ tutorName: tutorNameDraft.trim() })}
            placeholder="英语老师"
            aria-label="AI 老师称呼"
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow label="答疑风格">
          <OptionSelect label="答疑风格" value={profile.tutorStyle} options={TUTOR_STYLES} disabled={saving} onChange={(v) => save({ tutorStyle: v })} />
        </SettingsRow>
        <SettingsRow label="回答后出个小问题" description="鼓励学习者自己说一说、用一用">
          <Switch checked={profile.tutorQuiz} disabled={saving} onCheckedChange={(v) => save({ tutorQuiz: v })} aria-label="回答后出个小问题" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="补充要求"
        description="写给某个 AI 任务的个性化要求，会附在它的提示词末尾；与输出格式、正确性要求冲突时以内置规则为准。"
      >
        <SettingsRow label="任务">
          <OptionSelect
            label="补充要求的任务"
            value={customTask}
            options={CUSTOM_TASKS.map((t) => ({ ...t, label: profile.custom[t.value] ? `${t.label}（已设置）` : t.label }))}
            onChange={(v) => {
              setCustomTask(v);
              setCustomDraft(profile.custom[v] ?? '');
            }}
          />
        </SettingsRow>
        <SettingsRow label="要求" stacked>
          <Textarea
            value={customDraft}
            rows={3}
            disabled={saving}
            onChange={(e) => setCustomDraft(e.target.value)}
            placeholder="例如：多讲一些商务场景的搭配；例句不要出现人名"
            aria-label="补充要求"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className={customTooLong ? 'text-destructive' : undefined}>
              {customDraft.trim().length} / {CUSTOM_MAX_CHARS}
            </span>
            <div className="flex gap-2">
              {customChanged && (
                <Button variant="ghost" size="sm" onClick={() => setCustomDraft(savedCustom)}>
                  还原
                </Button>
              )}
              <Button
                size="sm"
                disabled={saving || !customChanged || customTooLong}
                onClick={() => save({ custom: { ...profile.custom, [customTask]: customDraft.trim() } }, '已保存补充要求')}
              >
                保存
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <Dialog open={previews != null} onOpenChange={(open) => !open && setPreviews(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>系统提示词预览</DialogTitle>
            <DialogDescription>按当前设置渲染的提示词（只读）。规则与格式部分内置在应用里，学习者、风格和补充要求会填进对应位置。</DialogDescription>
          </DialogHeader>
          <OptionSelect
            label="预览的任务"
            value={previewTask}
            options={(previews ?? []).map((p) => ({ value: p.task, label: p.label }))}
            onChange={setPreviewTask}
          />
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap">
            {preview?.content}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
};
