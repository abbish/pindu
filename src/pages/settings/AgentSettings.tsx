import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { aiModelService } from '@/services/aiModelService';
import { agentSettingsService, type AgentSettings as AgentSettingsData, type UpdateAgentSettingsRequest } from '@/services/agentSettingsService';
import { Image as ImageIcon } from 'lucide-react';
import { capabilitiesOf } from '@/components/ModelCapabilities';
import type { AIModelConfig } from '@/types';
import { PromptCustomSection } from './PromptCustomSection';

/** “跟随默认模型”在 Select 里的值（Select 不接受空字符串） */
const FOLLOW_DEFAULT = 'default';
const BATCH_SIZES = [3, 5, 8, 10, 15, 20];
const CONCURRENCIES = [1, 2, 3, 4, 5];
const TIMEOUTS = [3, 5, 10, 15, 20, 30, 45, 60];
const RETRIES = [0, 1, 2, 3, 5, 8, 10];
const JOB_SLOTS = [1, 2, 3, 4];

const modelLabel = (m: AIModelConfig) => `${m.displayName}（${m.provider.displayName}）`;

/**
 * 设置 → AI 任务（pi agent）：每个 AI 任务用哪个模型、批量分析的节奏、等待与重试、后台同时进行的任务数、各任务的补充要求。
 * 页面上临时选的模型（如导入单词时）优先于这里的设置；这里没指定时跟随沿用的任务或默认模型。
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
    Promise.all([agentSettingsService.getSettings(), aiModelService.getAllAIModels({ withCatalog: true })]).then(([s, m]) => {
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
      <SettingsPanel title="AI 任务">
        {loadError ? (
          <PageError title="无法加载 AI 任务设置" message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <Skeleton className="h-72 rounded-xl" />
        )}
      </SettingsPanel>
    );
  }

  // 只列出启用且已填写密钥的模型；设置里指向的模型已不可用时也列出来，标明“不可用”
  const usable = models.filter((m) => m.isActive && m.provider.hasApiKey);
  const defaultModel = models.find((m) => m.isDefault);
  const defaultText = defaultModel ? `跟随默认模型：${defaultModel.displayName}` : '跟随默认模型：未设置';
  /** 没有单独设置时：沿用的任务设置了模型就跟随它，否则跟随默认模型 */
  const followText = (fallbackTask: string | null) => {
    const fallback = settings.taskModels.find((t) => t.task === fallbackTask);
    const model = fallback?.modelId != null ? usable.find((m) => m.id === fallback.modelId) : undefined;
    return fallback && model ? `跟随「${fallback.label}」：${model.displayName}` : defaultText;
  };

  return (
    <SettingsPanel title="AI 任务">
      <SettingsSection title="各任务使用的模型">
        {settings.taskModels.map((t) => {
          const value = t.modelId == null ? FOLLOW_DEFAULT : String(t.modelId);
          const missing = t.modelId != null && !usable.some((m) => m.id === t.modelId);
          return (
            <SettingsRow key={t.task} label={t.label}>
              <Select
                value={value}
                disabled={saving}
                onValueChange={(v) => save({ taskModels: [{ task: t.task, modelId: v === FOLLOW_DEFAULT ? null : Number(v) }] })}
              >
                <SelectTrigger className="w-72" aria-label={`${t.label}使用的模型`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_DEFAULT}>{followText(t.fallbackTask)}</SelectItem>
                  {usable.length > 0 && <SelectSeparator />}
                  {usable.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {modelLabel(m)}
                      {capabilitiesOf(m).images && <ImageIcon className="text-muted-foreground" aria-label="能看图片" />}
                    </SelectItem>
                  ))}
                  {missing && (
                    <SelectItem value={value} disabled>
                      已选的模型不可用，改用默认模型
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="批量分析单词">
        <SettingsRow label="每批单词数">
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
        <SettingsRow label="同时请求数">
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

      <SettingsSection title="AI 请求">
        <SettingsRow label="后台同时进行" description="写短文、出题、批量分析等后台任务">
          <Select value={String(settings.jobSlots)} disabled={saving} onValueChange={(v) => save({ jobSlots: Number(v) })}>
            <SelectTrigger className="w-32" aria-label="后台同时进行的任务数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_SLOTS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 个
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="出错时自动重试" description="服务商限流或繁忙时">
          <Select value={String(settings.maxRetries)} disabled={saving} onValueChange={(v) => save({ maxRetries: Number(v) })}>
            <SelectTrigger className="w-32" aria-label="出错时自动重试">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETRIES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 0 ? '不重试' : `${n} 次`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="每次最长等待">
          <Select value={String(settings.timeoutMinutes)} disabled={saving} onValueChange={(v) => save({ timeoutMinutes: Number(v) })}>
            <SelectTrigger className="w-32" aria-label="每次最长等待">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEOUTS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 分钟
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <PromptCustomSection />
    </SettingsPanel>
  );
};
