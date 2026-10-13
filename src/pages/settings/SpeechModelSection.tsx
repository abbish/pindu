import React, { useCallback, useEffect, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { CircleCheck, CircleX, Loader2, MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobErrorText, jobPercent } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import { videoService } from '@/services/videoService';
import { isJobActive } from '@/types/job';
import { formatBytes } from '@/utils/fileSize';
import type { SpeechModelInfo, SpeechModels, SpeechSourceTest } from '@/types/video';

const AUTO = 'auto';
const speed = (bps: number) => (bps >= 1024 * 1024 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : `${Math.max(1, Math.round(bps / 1024))} KB/s`);

/** 模型一行的说明：特点 · 大小或下载状态 */
function modelState(m: SpeechModelInfo): string {
  if (m.downloaded) return `${m.note} · 已下载`;
  if (m.partialBytes > 0) return `${m.note} · 已下载 ${formatBytes(m.partialBytes)} / ${formatBytes(m.downloadBytes)}`;
  return `${m.note} · ${formatBytes(m.downloadBytes)}`;
}

/**
 * 设置「素材」里的字幕识别（D61）：视频没有字幕时在本机识别英文语音。
 * - 下载来源：自动（先试国内的）或指定一个；「测试」当场测各来源能不能连上、速度多快；
 * - 三个模型选一个使用；可以提前下载（后台任务，显示进度，可停止，断了下次接着下）、重新下载、删除，
 *   下载不了时可以从文件导入（在别处下好的，校验通过才用）。
 */
export const SpeechModelSection: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<SpeechModels | null>(null);
  const [tests, setTests] = useState<SpeechSourceTest[] | 'testing' | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const jobs = useJobs();

  const load = useCallback(async () => {
    const r = await videoService.getSpeechModels();
    if (r.success) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useOnJobFinished((job) => {
    if (job.kind === 'video_recognize') void load();
    if (job.kind !== 'speech_model_download') return;
    void load();
    if (job.status === 'failed') toast.showError('识别模型没有下载完', jobErrorText(job));
    else if (job.status === 'succeeded') toast.showSuccess('识别模型已下载');
  });

  if (!data) return null;
  const downloading = jobs.find((j) => j.kind === 'speech_model_download' && isJobActive(j));
  const recognizing = jobs.some((j) => j.kind === 'video_recognize' && isJobActive(j));
  const busy = downloading !== undefined || recognizing || importing !== null;
  const testOf = (id: string) => (Array.isArray(tests) ? tests.find((t) => t.id === id) : undefined);

  const setSource = async (id: string) => {
    const r = await videoService.setSpeechSource(id);
    if (r.success) setData((d) => (d ? { ...d, source: id } : d));
    else toast.showError('无法切换下载来源', r.error);
  };
  const runTests = async () => {
    setTests('testing');
    const r = await videoService.testSpeechSources();
    if (r.success) setTests(r.data);
    else {
      setTests(null);
      toast.showError('无法测试下载来源', r.error);
    }
  };
  const select = async (id: string) => {
    const r = await videoService.setSpeechModel(id);
    if (r.success) setData((d) => (d ? { ...d, selected: id } : d));
    else toast.showError('无法切换识别模型', r.error);
  };
  const download = async (id: string, force = false) => {
    const r = await videoService.startSpeechModelDownload(id, force);
    if (!r.success) toast.showError('无法下载识别模型', r.error);
  };
  const importFile = async (m: SpeechModelInfo) => {
    const picked = await openFileDialog({ multiple: false, directory: false, title: `选择 ggml-${m.id}.bin`, filters: [{ name: '识别模型', extensions: ['bin'] }] });
    if (typeof picked !== 'string') return;
    setImporting(m.id);
    const r = await videoService.importSpeechModel(m.id, picked);
    setImporting(null);
    if (r.success) {
      toast.showSuccess('识别模型已导入');
      void load();
    } else toast.showError('无法导入这个文件', r.error);
  };
  const remove = async (id: string) => {
    const r = await videoService.deleteSpeechModel(id);
    if (r.success) void load();
    else toast.showError('无法删除识别模型', r.error);
  };

  return (
    <SettingsSection title="字幕识别">
      <SettingsRow
        label="模型下载来源"
        description={
          tests === 'testing' ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              正在测试各个来源…
            </span>
          ) : Array.isArray(tests) ? (
            <span className="flex flex-col gap-0.5">
              {tests.map((t) => (
                <span key={t.id} className="flex items-center gap-1.5">
                  {t.ok ? <CircleCheck className="size-3.5 text-success" /> : <CircleX className="size-3.5 text-destructive" />}
                  {t.label}：{t.ok ? `可以用，${speed(t.bytesPerSecond)}` : t.error}
                </span>
              ))}
            </span>
          ) : undefined
        }
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={tests === 'testing'} onClick={() => void runTests()}>
            测试
          </Button>
          <Select value={data.source} onValueChange={(v) => void setSource(v)}>
            <SelectTrigger size="sm" className="w-44" aria-label="模型下载来源">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>自动（推荐）</SelectItem>
              {data.sources.map((s) => {
                const t = testOf(s.id);
                return (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                    {t && <span className="text-muted-foreground">{t.ok ? ` · ${speed(t.bytesPerSecond)}` : ' · 不可用'}</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </SettingsRow>
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
                  {job.status === 'queued' ? '等待中' : `下载中 ${Math.floor(jobPercent(job))}%`}
                </span>
              ) : importing === m.id ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  正在校验并导入…
                </span>
              ) : (
                modelState(m)
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
                    {m.partialBytes > 0 ? '继续下载' : '下载'}
                  </Button>
                )
              )}
              {!selected && (
                <Button variant="outline" size="sm" onClick={() => void select(m.id)}>
                  使用
                </Button>
              )}
              {!job && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={`${m.label}模型的更多操作`} disabled={busy}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void importFile(m)}>从文件导入…</DropdownMenuItem>
                    {m.downloaded && <DropdownMenuItem onSelect={() => void download(m.id, true)}>重新下载</DropdownMenuItem>}
                    {(m.downloaded || m.partialBytes > 0) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(m.id)}>
                          删除
                        </DropdownMenuItem>
                      </>
                    )}
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
