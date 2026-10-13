import React, { useCallback, useEffect, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobErrorText, jobPercent } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { invalidatePronunciationCache } from '@/hooks/usePronunciation';
import { dictationService } from '@/services/dictationService';
import { jobService } from '@/services/jobService';
import { pronunciationService } from '@/services/pronunciationService';
import { videoService } from '@/services/videoService';
import { isJobActive } from '@/types/job';
import type { ApiResult } from '@/types';
import type { MediaToolsStatus } from '@/types/video';
import { formatBytes } from '@/utils/fileSize';
import { SpeechModelSection } from './SpeechModelSection';

interface ModelState {
  ready: boolean;
  modelBytes: number;
}

/** 一个按需下载的模型：状态（已下载 / 大小 / 下载进度）+ 下载 / 停止 / 删除 */
const ModelRow: React.FC<{
  label: string;
  /** 下载任务的 kind */
  kind: string;
  load: () => Promise<ApiResult<ModelState>>;
  start: () => Promise<ApiResult<string>>;
  remove: () => Promise<ApiResult<void>>;
  /** 下载好 / 删除后（清掉页面间共用的缓存） */
  onChanged?: () => void;
}> = ({ label, kind, load, start, remove, onChanged }) => {
  const toast = useToast();
  const [state, setState] = useState<ModelState | null>(null);
  const jobs = useJobs();
  const refresh = useCallback(async () => {
    const r = await load();
    if (r.success) setState(r.data);
  }, [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useOnJobFinished((job) => {
    if (job.kind !== kind) return;
    onChanged?.();
    void refresh();
    if (job.status === 'failed') toast.showError(`${label}没有下载完`, jobErrorText(job));
  });
  if (!state) return null;
  const downloading = jobs.find((j) => j.kind === kind && isJobActive(j));

  const download = async () => {
    const r = await start();
    if (!r.success) toast.showError(`无法下载${label}`, r.error);
  };
  const del = async () => {
    const r = await remove();
    onChanged?.();
    if (r.success) void refresh();
    else toast.showError(`无法删除${label}`, r.error);
  };

  return (
    <SettingsRow
      label={label}
      description={
        downloading ? (
          <span className="flex items-center gap-2">
            <Progress value={jobPercent(downloading)} className="h-1 w-40" aria-label={`下载${label}进度`} />
            {downloading.status === 'queued' ? '等待中' : `下载中 ${Math.floor(jobPercent(downloading))}%`}
          </span>
        ) : state.ready ? (
          '已下载'
        ) : (
          formatBytes(state.modelBytes)
        )
      }
    >
      {downloading ? (
        <Button variant="outline" size="sm" onClick={() => void jobService.cancel(downloading.id)}>
          停止
        </Button>
      ) : state.ready ? (
        <Button variant="outline" size="sm" onClick={() => void del()}>
          删除
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => void download()}>
          下载
        </Button>
      )}
    </SettingsRow>
  );
};

/** 视频组件（ffmpeg / ffprobe）：随应用内置，能用时不显示；不可用或改用了别的文件夹时才出现 */
const MediaToolsSection: React.FC = () => {
  const toast = useToast();
  const [media, setMedia] = useState<MediaToolsStatus | null>(null);
  useEffect(() => {
    void videoService.getMediaToolsStatus().then((r) => r.success && setMedia(r.data));
  }, []);
  if (!media || (media.available && media.builtIn)) return null;
  const pick = async () => {
    const dir = await openFileDialog({ directory: true, multiple: false, title: '选择 ffmpeg 和 ffprobe 所在的文件夹' });
    if (typeof dir !== 'string') return;
    const result = await videoService.setFfmpegDir(dir);
    if (result.success) setMedia(result.data);
    else toast.showError('无法使用这个文件夹', result.error);
  };
  const reset = async () => {
    const result = await videoService.setFfmpegDir(null);
    if (result.success) setMedia(result.data);
    else toast.showError('无法改用自带的视频组件', result.error);
  };
  return (
    <SettingsSection title="视频组件">
      <SettingsRow label="ffmpeg" description={media.available ? (media.dir ?? undefined) : '没有找到'}>
        <div className="flex gap-2">
          {media.available && (
            <Button variant="ghost" size="sm" onClick={() => void reset()}>
              使用内置组件
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void pick()}>
            <FolderOpen />
            选择文件夹
          </Button>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
};

/**
 * 设置「本机模型」：在这台电脑上运行的模型与组件，按需下载、可以删除——
 * 字幕识别（视频没有字幕时）、发音评估（跟读评分）、语音输入（说话转文字）、视频组件（ffmpeg）。
 */
export const LocalModelsSettings: React.FC = () => (
  <SettingsPanel title="本机模型">
    <SpeechModelSection />
    <SettingsSection title="发音评估">
      <ModelRow
        label="评估模型"
        kind="pronunciation_model"
        load={pronunciationService.status.bind(pronunciationService)}
        start={pronunciationService.startDownload.bind(pronunciationService)}
        remove={pronunciationService.deleteModel.bind(pronunciationService)}
        onChanged={invalidatePronunciationCache}
      />
    </SettingsSection>
    <SettingsSection title="语音输入">
      <ModelRow
        label="识别模型"
        kind="dictation_model"
        load={dictationService.status.bind(dictationService)}
        start={dictationService.startDownload.bind(dictationService)}
        remove={dictationService.deleteModel.bind(dictationService)}
      />
    </SettingsSection>
    <MediaToolsSection />
  </SettingsPanel>
);
