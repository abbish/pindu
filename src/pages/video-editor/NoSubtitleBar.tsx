import React, { useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { AudioLines, Captions, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { JobProgress } from '@/components/Jobs';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobService } from '@/services/jobService';
import { videoService } from '@/services/videoService';
import type { Job } from '@/types/job';

/**
 * 剪辑编辑器顶栏下：视频还没有字幕时的提示（D61）。正在识别时显示进度（可停止）；
 * 没在识别（识别失败、或导入时没选识别）时可以重新识别，或选择字幕文件补上。字幕到位后由编辑器读回。
 */
export const NoSubtitleBar: React.FC<{ videoId: number; job: Job | undefined; onSubtitles: () => void }> = ({ videoId, job, onSubtitles }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const recognize = async () => {
    setBusy(true);
    const result = await videoService.startRecognition(videoId);
    setBusy(false);
    if (!result.success) toast.showError('无法识别字幕', result.error);
  };

  const pickFile = async () => {
    const picked = await openFileDialog({ multiple: false, directory: false, filters: [{ name: '字幕', extensions: ['srt', 'vtt'] }] });
    if (typeof picked !== 'string') return;
    setBusy(true);
    const result = await videoService.setSubtitles({ videoId, subtitlePath: picked });
    setBusy(false);
    if (!result.success) {
      toast.showError('无法使用这个字幕', result.error);
      return;
    }
    onSubtitles();
  };

  if (job) {
    return (
      <div className="flex items-center gap-4 border-b bg-accent/40 px-4 py-2">
        <div className="w-80 min-w-0">
          <JobProgress job={job} fallback="正在识别字幕" />
        </div>
        <span className="text-xs text-muted-foreground">识别完就可以规划和切分</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void jobService.cancel(job.id)}>
          停止
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b bg-warning-soft/50 px-4 py-2 text-sm">
      <Captions className="size-4 shrink-0 text-warning" />
      <span className="flex-1">这个视频还没有字幕</span>
      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void recognize()}>
        <AudioLines />
        自动识别英文语音
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void pickFile()}>
        选择字幕文件…
      </Button>
    </div>
  );
};
