import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobErrorText, jobPercent } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import { pronunciationService } from '@/services/pronunciationService';
import { invalidatePronunciationCache } from '@/hooks/usePronunciation';
import { isJobActive } from '@/types/job';
import type { PronunciationSettings, PronunciationStatus } from '@/types/pronunciation';
import { formatBytes } from '@/utils/fileSize';
import { OptionSelect, type Option } from './promptProfileShared';

const STRICTNESS: Option[] = [
  { value: 'auto', label: '自动' },
  { value: 'lenient', label: '宽松' },
  { value: 'standard', label: '标准' },
  { value: 'strict', label: '严格' },
];

/**
 * 设置「学习者」里的发音：练习「看 · 说」时跟读并在本机评估（录音不上传）。
 * 开关、评分严格程度（自动 = 小学生宽松，其余标准），评估模型的下载 / 删除。
 */
export const PronunciationSection: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<PronunciationStatus | null>(null);
  const jobs = useJobs();

  const load = useCallback(async () => {
    const r = await pronunciationService.status();
    if (r.success) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useOnJobFinished((job) => {
    if (job.kind !== 'pronunciation_model') return;
    invalidatePronunciationCache();
    void load();
    if (job.status === 'failed') toast.showError('评估模型没有下载完', jobErrorText(job));
  });

  if (!data) return null;
  const downloading = jobs.find((j) => j.kind === 'pronunciation_model' && isJobActive(j));

  const save = async (patch: Partial<PronunciationSettings>) => {
    const r = await pronunciationService.updateSettings({ ...data.settings, ...patch });
    invalidatePronunciationCache();
    if (r.success) setData((d) => (d ? { ...d, settings: r.data } : d));
    else toast.showError('无法保存发音设置', r.error);
  };
  const download = async () => {
    const r = await pronunciationService.startDownload();
    if (!r.success) toast.showError('无法下载评估模型', r.error);
  };
  const remove = async () => {
    const r = await pronunciationService.deleteModel();
    invalidatePronunciationCache();
    if (r.success) void load();
    else toast.showError('无法删除评估模型', r.error);
  };

  return (
    <SettingsSection title="发音">
      <SettingsRow label="跟读评估" htmlFor="pron-enabled">
        <Switch id="pron-enabled" checked={data.settings.enabled} onCheckedChange={(enabled) => void save({ enabled })} />
      </SettingsRow>
      <SettingsRow label="评分">
        <OptionSelect
          label="评分"
          value={data.settings.strictness}
          options={STRICTNESS}
          onChange={(v) => void save({ strictness: v as PronunciationSettings['strictness'] })}
          className="w-32"
        />
      </SettingsRow>
      <SettingsRow
        label="评估模型"
        description={
          downloading ? (
            <span className="flex items-center gap-2">
              <Progress value={jobPercent(downloading)} className="h-1 w-40" aria-label="下载评估模型进度" />
              {downloading.status === 'queued' ? '等待中' : `下载中 ${Math.floor(jobPercent(downloading))}%`}
            </span>
          ) : data.ready ? (
            '已下载'
          ) : (
            formatBytes(data.modelBytes)
          )
        }
      >
        {downloading ? (
          <Button variant="outline" size="sm" onClick={() => void jobService.cancel(downloading.id)}>
            停止
          </Button>
        ) : data.ready ? (
          <Button variant="outline" size="sm" onClick={() => void remove()}>
            删除
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void download()}>
            下载
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
};
