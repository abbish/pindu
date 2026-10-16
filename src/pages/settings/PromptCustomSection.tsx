import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { CUSTOM_MAX_CHARS, promptProfileService, type PromptPreview } from '@/services/promptProfileService';
import { OptionSelect, usePromptProfile, type Option } from './promptProfileShared';

/** 可以写补充要求的任务（key 与后端 PromptTask 一致） */
const CUSTOM_TASKS: Option[] = [
  { value: 'chat', label: 'AI 老师 · 对话' },
  { value: 'explain', label: 'AI 老师 · 讲解单词' },
  { value: 'tutor', label: 'AI 老师 · 练习答疑' },
  { value: 'examples', label: '例句补充' },
  { value: 'phonics', label: '拼读分析' },
  { value: 'extract', label: '提取单词' },
  { value: 'generate', label: '按意图生成单词' },
  { value: 'plan', label: '学习计划排序' },
  { value: 'sentence_analyze', label: '句子分析' },
  { value: 'clip_guide', label: '场景片段讲解' },
  { value: 'passage_plan', label: '短文：内容规划' },
  { value: 'passage', label: '短文：生成短文' },
  { value: 'passage_target_words', label: '短文：挑选词汇' },
  { value: 'passage_questions', label: '短文：生成题组' },
  { value: 'passage_grade', label: '短文：开放题评分' },
  { value: 'passage_translate', label: '短文：导入材料翻译' },
  { value: 'material_read', label: '读取 PDF / 图片材料' },
  { value: 'video_plan', label: '视频：规划切分' },
  { value: 'subtitle_prepare', label: '视频：整理字幕' },
];

/**
 * 设置 → AI 任务 → 补充要求：各任务的个性化要求，注入对应任务的系统提示词；可以预览渲染后的提示词。
 */
export const PromptCustomSection: React.FC = () => {
  const toast = useToast();
  const { profile, saving, loadError, reload, save } = usePromptProfile();
  const [task, setTask] = useState('chat');
  const [draft, setDraft] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PromptPreview[] | null>(null);
  const [previewTask, setPreviewTask] = useState('chat');

  const openPreview = async () => {
    if (!profile) return;
    const result = await promptProfileService.preview(profile);
    if (result.success) setPreviews(result.data);
    else toast.showError('无法预览提示词', result.error);
  };

  if (!profile) {
    return (
      <SettingsSection title="补充要求">
        {loadError ? <PageError title="无法加载补充要求" message={loadError} onRetry={reload} /> : <Skeleton className="h-32 rounded-xl" />}
      </SettingsSection>
    );
  }

  const saved = profile.custom[task] ?? '';
  // 没改过时显示已保存的内容
  const text = draft ?? saved;
  const changed = text.trim() !== saved;
  const tooLong = text.trim().length > CUSTOM_MAX_CHARS;
  const preview = previews?.find((p) => p.task === previewTask);

  return (
    <SettingsSection
      title="补充要求"
      actions={
        <Button variant="outline" size="sm" onClick={openPreview}>
          预览提示词
        </Button>
      }
    >
      <SettingsRow label="任务">
        <OptionSelect
          label="补充要求的任务"
          value={task}
          options={CUSTOM_TASKS.map((t) => ({ ...t, label: profile.custom[t.value] ? `${t.label} · 已设置` : t.label }))}
          onChange={(v) => {
            setTask(v);
            setDraft(null);
          }}
        />
      </SettingsRow>
      <SettingsRow label="要求" stacked>
        <Textarea
          value={text}
          rows={3}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例如：多讲一些商务场景的搭配；例句不要出现人名"
          aria-label="补充要求"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className={tooLong ? 'text-destructive' : undefined}>
            {text.trim().length} / {CUSTOM_MAX_CHARS}
          </span>
          <div className="flex gap-2">
            {changed && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                还原
              </Button>
            )}
            <Button
              size="sm"
              disabled={saving || !changed || tooLong}
              onClick={async () => {
                if (await save({ custom: { ...profile.custom, [task]: text.trim() } }, '已保存补充要求')) setDraft(null);
              }}
            >
              保存
            </Button>
          </div>
        </div>
      </SettingsRow>

      <Dialog open={previews != null} onOpenChange={(open) => !open && setPreviews(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>系统提示词预览</DialogTitle>
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
    </SettingsSection>
  );
};
