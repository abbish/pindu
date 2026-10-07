import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { aiModelService } from '@/services/aiModelService';
import { agentSettingsService, type AgentSettings as AgentSettingsData, type UpdateAgentSettingsRequest } from '@/services/agentSettingsService';
import type { AIModelConfig } from '@/types';
import { PromptProfileSettings } from './PromptProfileSettings';

/** “跟随默认模型”在 Select 里的值（Select 不接受空字符串） */
const FOLLOW_DEFAULT = 'default';
const BATCH_SIZES = [3, 5, 8, 10, 15, 20];
const CONCURRENCIES = [1, 2, 3, 4, 5];

const modelLabel = (m: AIModelConfig) => `${m.displayName}（${m.provider.displayName}）`;

/**
 * 设置 → AI 助手（pi agent）：每个 AI 任务用哪个模型、批量分析的节奏。
 * 页面上临时选的模型（如导入单词时）优先于这里的设置；这里没指定时跟随默认模型。
 */
export const AgentSettings: React.FC = () => {
  const toast = useToast();
  const [settings, setSettings] = useState<AgentSettingsData | null>(null);
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([agentSettingsService.getSettings(), aiModelService.getAllAIModels()]).then(([s, m]) => {
      if (cancelled) return;
      if (s.success) setSettings(s.data);
      setLoadError(s.success ? null : s.error);
      if (m.success) setModels(m.data);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const save = async (request: UpdateAgentSettingsRequest) => {
    setSaving(true);
    const result = await agentSettingsService.updateSettings(request);
    setSaving(false);
    // 选了就生效：控件本身就是反馈，成功不再提示（设置页约定，ui-interaction-patterns §6）
    if (result.success) setSettings(result.data);
    else toast.showError('无法保存设置', result.error);
  };

  if (!settings) {
    return (
      <SettingsPanel title="AI 助手" description="每个 AI 任务用哪个模型，以及批量分析的节奏。">
        {loadError ? (
          <PageError title="无法加载 AI 助手设置" message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <Skeleton className="h-72 rounded-xl" />
        )}
      </SettingsPanel>
    );
  }

  // 只列出启用且已填写密钥的模型；设置里指向的模型已不可用时也列出来，标明“不可用”
  const usable = models.filter((m) => m.isActive && m.provider.hasApiKey);
  const defaultModel = models.find((m) => m.isDefault);
  const defaultText = defaultModel ? `跟随默认模型：${defaultModel.displayName}` : '跟随默认模型（尚未设置）';

  return (
    <SettingsPanel
      title="AI 助手"
      description="提取单词、拼读分析、AI 讲解等功能由内置的 AI 助手（pi）完成。这里可以为每个任务单独指定模型，并按学习者调整讲解风格；导入单词、新建计划时页面上临时选的模型优先。"
    >
      <SettingsSection title="各任务使用的模型" description="能力强的模型更准确，速度快、价格低的模型更省；没有指定的任务跟随默认模型。">
        {settings.taskModels.map((t) => {
          const value = t.modelId == null ? FOLLOW_DEFAULT : String(t.modelId);
          const missing = t.modelId != null && !usable.some((m) => m.id === t.modelId);
          return (
            <SettingsRow key={t.task} label={t.label} description={t.description}>
              <Select
                value={value}
                disabled={saving}
                onValueChange={(v) => save({ taskModels: [{ task: t.task, modelId: v === FOLLOW_DEFAULT ? null : Number(v) }] })}
              >
                <SelectTrigger className="w-72" aria-label={`${t.label}使用的模型`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_DEFAULT}>{defaultText}</SelectItem>
                  {usable.length > 0 && <SelectSeparator />}
                  {usable.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {modelLabel(m)}
                    </SelectItem>
                  ))}
                  {missing && (
                    <SelectItem value={value} disabled>
                      已选的模型不可用（已停用或缺少密钥），实际使用默认模型
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="批量分析" description="导入单词时，单词会分批交给 AI 分析。">
        <SettingsRow label="每批单词数" description="每次请求分析几个词。批次大更快，但单次出错要重做的也更多。">
          <Select value={String(settings.batchSize)} disabled={saving} onValueChange={(v) => save({ batchSize: Number(v) })}>
            <SelectTrigger className="w-32" aria-label="每批单词数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BATCH_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 个
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="同时请求数" description="同时进行的分析请求。服务商提示请求过于频繁（429）时调低。">
          <Select value={String(settings.maxConcurrency)} disabled={saving} onValueChange={(v) => save({ maxConcurrency: Number(v) })}>
            <SelectTrigger className="w-32" aria-label="同时请求数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONCURRENCIES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 个
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <PromptProfileSettings />
    </SettingsPanel>
  );
};
