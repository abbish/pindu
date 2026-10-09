import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clapperboard, Film, Loader2, Pencil, Plus, Scissors, SearchX, Tags, Target, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MaterialToolbar } from '@/components/MaterialToolbar/MaterialToolbar';
import {
  BatchDeleteButton,
  BatchDeleteDialog,
  BatchTagButton,
  CardMenu,
  CardMenuButton,
  SelectCheckbox,
  SelectionBar,
  useSelection,
  type CardAction,
} from '@/components/MaterialSelection/MaterialSelection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { MaterialTags } from '@/components/MaterialTags/MaterialTags';
import { ClipGrid } from './videos/ClipGrid';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SortSelect, useSortPref } from '@/components/SortSelect';
import { byInstant, byNumber, byText, type SortOption, sortItems } from '@/utils/sorting';
import { ListPagination, usePagination } from '@/components/ListPagination';
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

const VIDEO_SORTS: SortOption<Video>[] = [
  { value: 'recent', label: '最近导入', compare: byInstant((v) => v.createdAt) },
  { value: 'name', label: '名称', compare: byText((v) => v.title) },
  { value: 'long', label: '时长最长', compare: byNumber((v) => v.durationMs) },
  { value: 'clips', label: '片段最多', compare: byNumber((v) => v.clipCount) },
];

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
  const [toDelete, setToDelete] = useState<Video[] | null>(null);
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceTag, setSourceTag] = useState('all');
  const [sourceSort, setSourceSort] = useSortPref('videos', VIDEO_SORTS);
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

  const shownVideos = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();
    const shown = (videos ?? []).filter(
      (v) =>
        (sourceTag === 'all' || v.tags.some((t) => String(t.id) === sourceTag)) &&
        (!q || v.title.toLowerCase().includes(q) || v.sourceName.toLowerCase().includes(q) || v.tags.some((t) => t.name.toLowerCase().includes(q)))
    );
    return sortItems(shown, VIDEO_SORTS, sourceSort);
  }, [videos, sourceQuery, sourceTag, sourceSort]);
  const selection = useSelection(useMemo(() => shownVideos.map((v) => v.id), [shownVideos]));
  const pager = usePagination(videos === null ? null : shownVideos, { id: 'videos', resetKey: `${sourceQuery.trim()}|${sourceTag}|${sourceSort}` });

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
        <ClipGrid clips={clips} videos={videos ?? []} videoId={videoId} onOpen={(c) => onNavigate?.('passage-detail', { passageId: c.id, clip: true })} onGoSources={() => setTab('sources')} onTagsChanged={load} onOpenEditor={(id) => onNavigate?.('video-editor', { videoId: id })} />
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
        <>
        {selection.selecting ? (
          <SelectionBar selection={selection} unit="个视频">
            <BatchTagButton kind="video" ids={selection.ids} onDone={load} />
            <BatchDeleteButton count={selection.selected.size} onClick={() => setToDelete(shownVideos.filter((v) => selection.selected.has(v.id)))} />
          </SelectionBar>
        ) : (
          <MaterialToolbar
            search={sourceQuery}
            onSearch={setSourceQuery}
            searchPlaceholder="搜索视频"
            tag={{ kind: 'video', value: sourceTag, onChange: setSourceTag, onTagsChanged: load }}
            activeCount={(sourceQuery ? 1 : 0) + (sourceTag !== 'all' ? 1 : 0)}
            onReset={() => {
              setSourceQuery('');
              setSourceTag('all');
            }}
            countText={`共 ${shownVideos.length} 个`}
          >
            <SortSelect value={sourceSort} options={VIDEO_SORTS} onChange={setSourceSort} />
          </MaterialToolbar>
        )}
        {shownVideos.length === 0 && <EmptyState icon={<SearchX />} title="没有匹配的视频" />}
        <div ref={pager.anchorRef} className="grid scroll-mt-20 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {(pager.pageItems ?? []).map((video) => {
            const job = jobOf(jobs, video.id);
            const interrupted = !job && (video.status === 'importing' || video.status === 'processing');
            const clickable = !job && video.mediaUrl !== null && (video.status === 'ready' || video.status === 'done' || video.status === 'processing');
            const checked = selection.selected.has(video.id);
            const actions: CardAction[] = [
              { label: '在剪辑编辑器里打开', icon: <Scissors />, onSelect: () => open(video), disabled: !clickable },
              ...(video.clipCount > 0 ? [{ label: '查看切出的片段', icon: <Clapperboard />, onSelect: () => onNavigate?.('videos', { tab: 'clips', videoId: video.id }) }] : []),
              {
                label: '改名…',
                icon: <Pencil />,
                onSelect: () => {
                  setRenameText(video.title);
                  setRenaming(video);
                },
              },
              { label: '删除…', icon: <Trash2 />, onSelect: () => setToDelete([video]), destructive: true, separator: true, disabled: Boolean(job) },
            ];
            return (
              <CardMenu key={video.id} actions={actions}>
              <Card className={cn('group relative gap-0 overflow-hidden p-0', checked && 'border-primary ring-2 ring-primary/30')} onClick={() => selection.selecting && selection.toggle(video.id)}>
                <SelectCheckbox checked={checked} selecting={selection.selecting} onToggle={() => selection.toggle(video.id)} label={`选择「${video.title}」`} />
                <button
                  type="button"
                  className="relative block aspect-video w-full bg-muted text-left disabled:cursor-default"
                  onClick={(e) => {
                    if (selection.selecting) return;
                    e.stopPropagation();
                    open(video);
                  }}
                  disabled={!clickable && !selection.selecting}
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
                    <CardMenuButton actions={actions} />
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
              </CardMenu>
            );
          })}
        </div>
        <ListPagination page={pager.page} pageSize={pager.pageSize} total={pager.total} onChange={pager.setPage} hideSinglePage unit="个" />
        </>
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

      <BatchDeleteDialog
        items={toDelete}
        onClose={() => setToDelete(null)}
        unit="个视频"
        description="视频文件、字幕、切分规划以及切出的片段都会删除，不能恢复；计划里还在用片段的视频不会删除。你电脑上原来的视频文件不受影响。"
        nameOf={(v) => v.title}
        remove={(v) => videoService.delete(v.id)}
        onDone={() => {
          selection.clear();
          load();
        }}
      />
    </div>
  );
};
