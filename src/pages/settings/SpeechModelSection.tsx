import React, { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobPercent } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import { videoService } from '@/services/videoService';
import { isJobActive } from '@/types/job';
import { formatBytes } from '@/utils/fileSize';
import type { SpeechModels } from '@/types/video';

/**
 * 设置「素材」里的字幕识别模型（D61）：视频没有字幕时在本机识别英文语音用。三个可选，选一个使用；
 * 可以提前下载（后台任务，显示进度，可停止）、重新下载、删除。没下载的在第一次识别时自动下载。
 */
export const SpeechModelSection: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<SpeechModels | null>(null);
  const jobs = useJobs();

  const load = useCallback(async () => {
    const r = await videoService.getSpeechModels();
    if (r.success) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // 下载或识别结束：模型可能多了一个
  useOnJobFinished((job) => {
    if (job.kind === 'speech_model_download' || job.kind === 'video_recognize') void load();
  });

  if (!data) return null;
  const downloading = jobs.find((j) => j.kind === 'speech_model_download' && isJobActive(j));
  const recognizing = jobs.some((j) => j.kind === 'video_recognize' && isJobActive(j));
  const busy = downloading !== undefined || recognizing;

  const select = async (id: string) => {
    const r = await videoService.setSpeechModel(id);
    if (r.success) setData((d) => (d ? { ...d, selected: id } : d));
    else toast.showError('无法切换识别模型', r.error);
  };
  const download = async (id: string, force = false) => {
    const r = await videoService.startSpeechModelDownload(id, force);
    if (!r.success) toast.showError('无法下载识别模型', r.error);
  };
  const remove = async (id: string) => {
    const r = await videoService.deleteSpeechModel(id);
    if (r.success) void load();
    else toast.showError('无法删除识别模型', r.error);
  };

  return (
    <SettingsSection title="字幕识别" description="视频没有字幕时，在本机识别英文语音生成字幕；音频不会上传">
      {data.models.map((m) => {
        const job = (downloading?.detail as { modelId?: string } | null | undefined)?.modelId === m.id ? downloading : undefined;
        const selected = m.id === data.selected;
        return (
          <SettingsRow
            key={m.id}
            label={
              <span className="flex items-center gap-2">
                {m.label}
                <span className="font-normal text-muted-foreground">{m.id}</span>
                {selected && <Badge variant="secondary">使用中</Badge>}
              </span>
            }
            description={
              job ? (
                <span className="flex items-center gap-2">
                  <Progress value={jobPercent(job)} className="h-1 w-40" aria-label={`下载 ${m.label} 进度`} />
                  {job.status === 'queued' ? '等待中' : `下载中 ${jobPercent(job)}%`}
                </span>
              ) : (
                `${m.note}。${formatBytes(m.downloadBytes)}，${m.downloaded ? '已下载' : '未下载（第一次识别时自动下载）'}`
              )
            }
          >
            <div className="flex items-center gap-2">
              {job ? (
                <Button variant="outline" size="sm" onClick={() => void jobService.cancel(job.id)}>
                  停止
                </Button>
              ) : (
                !m.downloaded && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void download(m.id)}>
                    下载
                  </Button>
                )
              )}
              {!selected && (
                <Button variant="outline" size="sm" onClick={() => void select(m.id)}>
                  使用
                </Button>
              )}
              {m.downloaded && !job && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={`${m.label}模型的更多操作`} disabled={busy}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void download(m.id, true)}>重新下载</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => void remove(m.id)}>
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
};
