import React, { useEffect, useRef, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, AudioLines, Captions, FileVideo, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineError } from '@/components/InlineError';
import { videoService } from '@/services/videoService';
import { formatBytes } from '@/utils/fileSize';
import { hasExtension, titleFromFileName } from '@/utils/videoTitle';
import type { MediaToolsStatus, SpeechModelInfo, SubtitleDiscovery, VideoImportStarted } from '@/types/video';

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts'];
const SUBTITLE_EXTENSIONS = ['srt', 'vtt'];

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** 选定的字幕：文件路径 + 显示名（视频自带的显示「视频自带 · 英文」，不是缓存里的文件名） */
type Picked = { path: string; label: string; auto: boolean };
const manual = (path: string): Picked => ({ path, label: baseName(path), auto: false });


export interface ImportVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已提交导入（后台任务） */
  onStarted: (started: VideoImportStarted) => void;
}

/** 选文件的一行：标签 + 已选文件名 + 「选择…」 */
const FileRow: React.FC<{
  label: string;
  hint: string;
  icon: React.ReactNode;
  path: string;
  /** 显示名（默认是文件名） */
  display?: string;
  /** 自动找到的：名字后面标出 */
  auto?: boolean;
  onPick: () => void;
  onClear?: () => void;
}> = ({ label, hint, icon, path, display, auto, onPick, onClear }) => (
  <div className="min-w-0 space-y-1.5">
    <Label>{label}</Label>
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className={path ? 'min-w-0 truncate' : 'min-w-0 truncate text-muted-foreground'} title={path ? display ?? path : undefined}>
          {path ? display ?? baseName(path) : hint}
        </span>
        {path && auto && <span className="ml-auto shrink-0 text-xs text-muted-foreground">自动找到</span>}
      </div>
      {path && onClear && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          清除
        </Button>
      )}
      <Button type="button" variant="outline" onClick={onPick}>
        选择…
      </Button>
    </div>
  </div>
);

/**
 * 导入视频：先只选视频；选好后自动找字幕（旁边的同名字幕文件、视频自带的字幕；英文做字幕、中文做第二字幕）→ 标题 → 提交后台任务
 * （复制、转格式、生成时间轴），完成后在剪辑编辑器里规划切分。没找到英文字幕时可以选文件，或导入后在本机识别英文语音（D61）。
 * 没有视频组件（ffmpeg）时先引导选择它所在的文件夹。
 */
export const ImportVideoDialog: React.FC<ImportVideoDialogProps> = ({ open, onOpenChange, onStarted }) => {
  const [tools, setTools] = useState<MediaToolsStatus | null>(null);
  const [videoPath, setVideoPath] = useState('');
  const [subtitle, setSubtitle] = useState<Picked | null>(null);
  const [second, setSecond] = useState<Picked | null>(null);
  /** 自动找字幕：null = 还没选视频；loading = 正在找 */
  const [discovery, setDiscovery] = useState<SubtitleDiscovery | 'loading' | null>(null);
  /** 没有英文字幕时：导入后自动识别语音 */
  const [recognize, setRecognize] = useState(false);
  /** 选用的识别模型（没下载时提示第一次要下载多大） */
  const [model, setModel] = useState<SpeechModelInfo | null>(null);
  /** 第几次找字幕：换了视频后，上一个视频晚到的结果不用 */
  const findRun = useRef(0);
  const [title, setTitle] = useState('');
  /** 用户自己改过标题后，重新选视频不再覆盖 */
  const [titleEdited, setTitleEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVideoPath('');
    setSubtitle(null);
    setSecond(null);
    setDiscovery(null);
    setRecognize(false);
    findRun.current += 1;
    setTitle('');
    setTitleEdited(false);
    setError(null);
    videoService.getMediaToolsStatus().then((r) => setTools(r.success ? r.data : null));
    videoService.getSpeechModels().then((r) => setModel(r.success ? (r.data.models.find((m) => m.id === r.data.selected) ?? null) : null));
  }, [open]);

  const pick = async (extensions: string[], name: string, wrongType: string) => {
    const picked = await openFileDialog({ multiple: false, directory: false, filters: [{ name, extensions }] });
    if (typeof picked !== 'string') return null;
    if (!hasExtension(picked, extensions)) {
      setError(wrongType);
      return null;
    }
    setError(null);
    return picked;
  };

  const pickVideo = async () => {
    const path = await pick(VIDEO_EXTENSIONS, '视频', '请选择视频文件（mp4、mov、mkv 等）');
    if (!path) return;
    setVideoPath(path);
    if (!titleEdited) setTitle(titleFromFileName(path));
    // 换了视频：自动找到的字幕作废（自己选的保留），重新找
    const keep = (p: Picked | null) => (p && !p.auto ? p : null);
    setSubtitle(keep);
    setSecond(keep);
    setRecognize(false);
    setDiscovery('loading');
    const run = ++findRun.current;
    const found = await videoService.findSubtitles(path);
    if (run !== findRun.current) return;
    if (!found.success) {
      setDiscovery({ candidates: [], primary: null, secondary: null, imageTracks: 0 });
      return;
    }
    const d = found.data;
    setDiscovery(d);
    const auto = (i: number | null): Picked | null => (i === null ? null : { path: d.candidates[i].path, label: d.candidates[i].label, auto: true });
    setSubtitle((cur) => cur ?? auto(d.primary));
    setSecond((cur) => cur ?? auto(d.secondary));
    // 没有英文字幕：默认导入后自动识别（可以取消，或选字幕文件）
    setRecognize(d.primary === null);
  };

  const pickToolsDir = async () => {
    const dir = await openFileDialog({ directory: true, multiple: false, title: '选择 ffmpeg 和 ffprobe 所在的文件夹' });
    if (typeof dir !== 'string') return;
    const result = await videoService.setFfmpegDir(dir);
    if (result.success) {
      setTools(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    const result = await videoService.startImport({
      videoPath,
      subtitlePath: subtitle?.path ?? '',
      secondSubtitlePath: subtitle ? second?.path : undefined,
      title: title.trim() || undefined,
      recognize: !subtitle && recognize,
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onStarted(result.data);
    onOpenChange(false);
  };

  const missingTools = tools !== null && !tools.available;
  const searching = discovery === 'loading';
  /** 选了视频、找完了，还是没有英文字幕：选文件或自动识别 */
  const noSubtitle = videoPath !== '' && !searching && !subtitle;
  const ready = videoPath !== '' && !searching && (subtitle !== null || recognize);
  const pickSubtitle = async () => {
    const path = await pick(SUBTITLE_EXTENSIONS, '字幕', '请选择 srt 或 vtt 字幕文件');
    if (path) setSubtitle(manual(path));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>导入视频</DialogTitle>
          <DialogDescription className="sr-only">选择视频，字幕会自动查找</DialogDescription>
        </DialogHeader>

        {missingTools ? (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <div className="font-medium">视频组件不可用</div>
                <p className="mt-0.5 text-muted-foreground">重新安装应用，或选择 ffmpeg 所在的文件夹</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={pickToolsDir}>
              <FolderOpen />
              选择文件夹…
            </Button>
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            <FileRow label="视频" hint="mp4、mov、mkv、webm 等" icon={<FileVideo className="size-4" />} path={videoPath} onPick={pickVideo} />
            {/* 字幕与标题都跟着视频来：选视频之前不显示 */}
            {videoPath && (
              <>
              {searching ? (
                <div className="space-y-1.5">
                  <Label>字幕</Label>
                  <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    正在查找字幕…
                  </div>
                </div>
              ) : noSubtitle ? (
                <div className="space-y-2">
                  <Label>字幕</Label>
                  <div className="space-y-3 rounded-lg border p-3">
                    <p className="text-sm">
                      {second ? '只找到中文字幕，还需要英文字幕' : '没有找到字幕'}
                      {discovery !== null && discovery.imageTracks > 0 && (
                        <span className="text-muted-foreground">（视频里的字幕是图片，取不出文字）</span>
                      )}
                    </p>
                    <Label htmlFor="sub-recognize" className="flex cursor-pointer items-start gap-2.5 font-normal">
                          <Checkbox id="sub-recognize" checked={recognize} onCheckedChange={(v) => setRecognize(v === true)} className="mt-0.5" />
                          <span className="space-y-0.5">
                            <span className="flex items-center gap-1.5 text-sm">
                              <AudioLines className="size-4 text-muted-foreground" />
                              导入后自动识别英文语音
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              在本机识别{model && !model.downloaded && `，第一次需要下载 ${formatBytes(model.downloadBytes)} 的识别模型`}。影视剧建议用正式字幕
                            </span>
                          </span>
                        </Label>
                    <Button type="button" variant="outline" size="sm" onClick={pickSubtitle}>
                      <Captions />
                      选择字幕文件…
                    </Button>
                  </div>
                </div>
              ) : (
                <FileRow
                  label="字幕"
                  hint="srt 或 vtt，英文或中英双语"
                  icon={<Captions className="size-4" />}
                  path={subtitle?.path ?? ''}
                  display={subtitle?.label}
                  auto={subtitle?.auto}
                  onPick={pickSubtitle}
                />
              )}
              {/* 第二字幕跟着字幕走：只有中文、选了识别时用不上它（识别出的英文由整理字幕翻译） */}
                {!searching && subtitle && (
                <FileRow
                  label="第二字幕"
                  hint="例如单独的中文字幕"
                  icon={<Captions className="size-4" />}
                  path={second?.path ?? ''}
                  display={second?.label}
                  auto={second?.auto}
                  onPick={async () => {
                    const path = await pick(SUBTITLE_EXTENSIONS, '字幕', '请选择 srt 或 vtt 字幕文件');
                    if (path) setSecond(manual(path));
                  }}
                  onClear={() => setSecond(null)}
                />
              )}
              <div className="space-y-1.5">
                <Label htmlFor="video-title">标题</Label>
                <Input id="video-title" value={title} maxLength={100} placeholder="视频文件名" onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleEdited(e.target.value.trim() !== '');
                  }}
                />
              </div>
              </>
            )}
          </div>
        )}

        {error && <InlineError>{error}</InlineError>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={missingTools || !ready || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
