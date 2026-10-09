import React, { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Film, Loader2, MoreHorizontal, Pencil, Plus, Scissors, Tags, Target, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { MaterialTags } from '@/components/MaterialTags/MaterialTags';
import { ClipGrid } from './videos/ClipGrid';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ImportVideoDialog } from '@/components/ImportVideoDialog';
import { PageError } from '@/components/PageError';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { useToast } from '@/components/Toast/ToastContainer';
import { jobPercent } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { videoService } from '@/services/videoService';
import { formatBytes } from '@/utils/fileSize';
import { formatDuration, formatRelative } from '@/utils/datetime';
import { isJobActive, type Job } from '@/types/job';
import type { ClipSummary, Video } from '@/types/video';
import type { NavigateFn } from '../navigation';

export interface VideoLibraryPageProps {
  /** clips 片段（默认）/ sources 原始视频 */
  tab?: 'clips' | 'sources';
  /** 只看这个视频切出的片段 */
  videoId?: number;
  onNavigate?: NavigateFn;
}

/** 这个视频正在跑的后台任务（导入 / 处理） */
const jobOf = (jobs: Job[], videoId: number) =>
  jobs.find((j) => isJobActive(j) && (j.link?.params as { videoId?: number } | undefined)?.videoId === videoId);

const STATUS_LABEL: Record<Video['status'], string> = {
  importing: '导入中',
  ready: '待切分',
  processing: '处理中',
  done: '可以练习',
  failed: '失败',
};

/**
 * 素材库 · 视频库：切出来的「片段」是主要素材（默认页签，可按标签 / 来源视频 / 难度 / 字幕里的词筛选）；
 * 「原始视频」是待加工的材料：导入视频与字幕 → 剪辑编辑器里规划切分 → 后台切成片段。
 * 原始视频卡片显示封面、时长、状态；导入 / 处理中的显示后台任务的进度。
 */
export const VideoLibraryPage: React.FC<VideoLibraryPageProps> = ({ tab: initialTab, videoId, onNavigate }) => {
  const [tab, setTab] = useState<'clips' | 'sources'>(initialTab ?? 'clips');
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [clips, setClips] = useState<ClipSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState<Video | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deleting, setDeleting] = useState<Video | null>(null);
  const jobs = useJobs();
  const toast = useToast();

  const load = useCallback(async () => {
    const [result, clipResult] = await Promise.all([videoService.getVideos(), videoService.getClips()]);
    if (result.success && clipResult.success) {
      setVideos(result.data);
      setClips(clipResult.data);
      setLoadError(null);
    } else {
      setLoadError(result.success ? (clipResult.success ? null : clipResult.error) : result.error);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 导入 / 处理结束后刷新状态与封面
  useOnJobFinished((job) => {
    if (job.kind.startsWith('video_')) load();
  });

  const open = (video: Video) => {
    if (video.status === 'importing' || video.status === 'failed' || !video.mediaUrl) return;
    onNavigate?.('video-editor', { videoId: video.id });
  };

  const rename = async () => {
    if (!renaming) return;
    const result = await videoService.rename(renaming.id, renameText);
    if (!result.success) {
      toast.showError('无法改名', result.error);
      return;
    }
    setRenaming(null);
    load();
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await videoService.delete(deleting.id);
    setDeleting(null);
    if (!result.success) {
      toast.showError('无法删除视频', result.error);
      return;
    }
    toast.showSuccess(`已删除「${deleting.title}」`);
    load();
  };

  const header = (
    <PageHeader
      title="视频库"
      actions={
        <Button onClick={() => setImporting(true)}>
          <Plus />
          导入视频
        </Button>
      }
    />
  );

  const clipMs = (clips ?? []).reduce((sum, c) => sum + c.endMs - c.startMs, 0);
  const practiced = (clips ?? []).filter((c) => c.completedAttempts > 0).length;
  const tagCount = new Set((clips ?? []).flatMap((c) => c.tags.map((t) => t.id))).size;
  const metrics = [
    { label: '片段', value: clips?.length ?? 0, unit: '段', icon: Clapperboard, hint: clipMs > 0 ? formatDuration(clipMs, 'clock') : undefined },
    { label: '练过的片段', value: practiced, unit: '段', icon: Target },
    { label: '标签', value: tagCount, unit: '个', icon: Tags },
    { label: '原始视频', value: videos?.length ?? 0, unit: '个', icon: Film, hint: videos && videos.length > 0 ? formatBytes(videos.reduce((s, v) => s + v.sizeBytes, 0)) : undefined },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      {header}

      <section aria-label="视频库统计" className="grid grid-cols-4 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} loading={videos === null && !loadError} />
        ))}
      </section>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'clips' | 'sources')}>
        <TabsList>
          <TabsTrigger value="clips">
            片段
            {clips && <span className="text-muted-foreground tabular-nums">{clips.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="sources">
            原始视频
            {videos && <span className="text-muted-foreground tabular-nums">{videos.length}</span>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loadError ? (
        <PageError title="无法加载视频库" message={loadError} onRetry={load} />
      ) : tab === 'clips' ? (
        <ClipGrid clips={clips} videos={videos ?? []} videoId={videoId} onOpen={(c) => onNavigate?.('passage-detail', { passageId: c.id })} onGoSources={() => setTab('sources')} onTagsChanged={load} />
      ) : videos === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <EmptyState
          icon={<Clapperboard />}
          title="还没有视频"
          description="导入视频和字幕后，可以切成场景短片"
          action="导入视频"
          actionIcon={<Plus />}
          onAction={() => setImporting(true)}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {videos.map((video) => {
            const job = jobOf(jobs, video.id);
            const interrupted = !job && (video.status === 'importing' || video.status === 'processing');
            const clickable = !job && video.mediaUrl !== null && (video.status === 'ready' || video.status === 'done' || video.status === 'processing');
            return (
              <Card key={video.id} className="group gap-0 overflow-hidden p-0">
                <button
                  type="button"
                  className="relative block aspect-video w-full bg-muted text-left disabled:cursor-default"
                  onClick={() => open(video)}
                  disabled={!clickable}
                  aria-label={`打开「${video.title}」`}
                >
                  {video.coverUrl ? (
                    <img src={video.coverUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <Film className="size-8" />
                    </div>
                  )}
                  {video.durationMs > 0 && (
                    <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">
                      {formatDuration(video.durationMs, 'clock')}
                    </span>
                  )}
                </button>
                <div className="flex flex-col gap-2 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium" title={video.title}>
                        {video.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {video.cueCount} 条字幕 · {formatBytes(video.sizeBytes)} · {formatRelative(video.createdAt)}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" aria-label="更多操作">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameText(video.title);
                            setRenaming(video);
                          }}
                        >
                          <Pencil />
                          改名
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(video)} disabled={Boolean(job)}>
                          <Trash2 />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {job ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        {job.status === 'queued' ? '排队中' : (job.stage ?? STATUS_LABEL[video.status])}
                      </div>
                      <Progress value={jobPercent(job)} className="h-1" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant={video.status === 'failed' || interrupted ? 'destructive' : video.status === 'done' ? 'default' : 'secondary'}>
                        {interrupted ? '被中断' : STATUS_LABEL[video.status]}
                      </Badge>
                      {video.clipCount > 0 && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs text-muted-foreground"
                          onClick={() => onNavigate?.('videos', { tab: 'clips', videoId: video.id })}
                        >
                          {video.clipCount} 个片段
                        </Button>
                      )}
                      {video.status === 'ready' && (
                        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => open(video)}>
                          <Scissors />
                          规划切分
                        </Button>
                      )}
                    </div>
                  )}
                  {(video.status === 'ready' || video.status === 'done') && <MaterialTags kind="video" refId={video.id} tags={video.tags} />}
                  {video.status === 'failed' && video.error && <p className="line-clamp-2 text-xs text-destructive">{video.error}</p>}
                  {interrupted && video.status === 'importing' && <p className="text-xs text-muted-foreground">删除后重新导入</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ImportVideoDialog
        open={importing}
        onOpenChange={setImporting}
        onStarted={() => {
          toast.showSuccess('已开始导入');
          load();
        }}
      />

      <AlertDialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>改名</AlertDialogTitle>
          </AlertDialogHeader>
          <Input value={renameText} maxLength={100} onChange={(e) => setRenameText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={rename} disabled={!renameText.trim()}>
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleting?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>视频文件、字幕和切分规划都会删除，不能恢复。你电脑上原来的视频文件不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
