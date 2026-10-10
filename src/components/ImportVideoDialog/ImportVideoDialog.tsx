import React, { useEffect, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, Captions, FileVideo, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InlineError } from '@/components/InlineError';
import { videoService } from '@/services/videoService';
import { hasExtension, titleFromFileName } from '@/utils/videoTitle';
import type { MediaToolsStatus, VideoImportStarted } from '@/types/video';

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts'];
const SUBTITLE_EXTENSIONS = ['srt', 'vtt'];

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;


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
  onPick: () => void;
  onClear?: () => void;
}> = ({ label, hint, icon, path, onPick, onClear }) => (
  <div className="min-w-0 space-y-1.5">
    <Label>{label}</Label>
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className={path ? 'min-w-0 truncate' : 'min-w-0 truncate text-muted-foreground'} title={path || undefined}>
          {path ? baseName(path) : hint}
        </span>
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
 * 导入视频：选视频 + 字幕（可再选另一个语言的字幕）+ 标题 → 提交后台任务（复制、转格式、生成时间轴），
 * 完成后在剪辑编辑器里规划切分。没有视频组件（ffmpeg）时先引导选择它所在的文件夹。
 */
export const ImportVideoDialog: React.FC<ImportVideoDialogProps> = ({ open, onOpenChange, onStarted }) => {
  const [tools, setTools] = useState<MediaToolsStatus | null>(null);
  const [videoPath, setVideoPath] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [secondPath, setSecondPath] = useState('');
  const [title, setTitle] = useState('');
  /** 用户自己改过标题后，重新选视频不再覆盖 */
  const [titleEdited, setTitleEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVideoPath('');
    setSubtitlePath('');
    setSecondPath('');
    setTitle('');
    setTitleEdited(false);
    setError(null);
    videoService.getMediaToolsStatus().then((r) => setTools(r.success ? r.data : null));
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
    if (!videoPath || !subtitlePath) return;
    setSubmitting(true);
    setError(null);
    const result = await videoService.startImport({
      videoPath,
      subtitlePath,
      secondSubtitlePath: secondPath || undefined,
      title: title.trim() || undefined,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>导入视频</DialogTitle>
          <DialogDescription className="sr-only">选择视频和字幕</DialogDescription>
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
            <FileRow
              label="字幕"
              hint="srt 或 vtt，英文或中英双语"
              icon={<Captions className="size-4" />}
              path={subtitlePath}
              onPick={async () => {
                const path = await pick(SUBTITLE_EXTENSIONS, '字幕', '请选择 srt 或 vtt 字幕文件');
                if (path) setSubtitlePath(path);
              }}
            />
            <FileRow
              label="第二字幕"
              hint="例如单独的中文字幕"
              icon={<Captions className="size-4" />}
              path={secondPath}
              onPick={async () => {
                const path = await pick(SUBTITLE_EXTENSIONS, '字幕', '请选择 srt 或 vtt 字幕文件');
                if (path) setSecondPath(path);
              }}
              onClear={() => setSecondPath('')}
            />
            <div className="space-y-1.5">
              <Label htmlFor="video-title">标题</Label>
              <Input id="video-title" value={title} maxLength={100} placeholder="视频文件名" onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleEdited(e.target.value.trim() !== '');
                }}
              />
            </div>
          </div>
        )}

        {error && <InlineError>{error}</InlineError>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={missingTools || !videoPath || !subtitlePath || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            开始导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
