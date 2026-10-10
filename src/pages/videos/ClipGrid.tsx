import React, { useEffect, useMemo, useState } from 'react';
import { Clapperboard, ListVideo, Play, Scissors, SearchX, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
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
  type Selection,
} from '@/components/MaterialSelection/MaterialSelection';
import { Button } from '@/components/ui/button';
import { ClipPlaylistDialog } from './ClipPlaylistDialog';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PASSAGE_SORTS } from '@/components/PassageList';
import { SortSelect, useSortPref } from '@/components/SortSelect';
import { byNumber, byText, sortItems, type SortOption } from '@/utils/sorting';
import { ListPagination, usePagination } from '@/components/ListPagination';
import { MaterialToolbar, TagChips } from '@/components/MaterialToolbar/MaterialToolbar';
import { tagService } from '@/services/tagService';
import { formatDuration } from '@/utils/datetime';
import type { ClipSummary, Video } from '@/types/video';

export interface ClipGridProps {
  clips: ClipSummary[] | null;
  /** 原始视频（来源筛选） */
  videos: Video[];
  /** 初始只看这个视频的片段 */
  videoId?: number;
  onOpen: (clip: ClipSummary) => void;
  /** 没有片段时去「原始视频」 */
  onGoSources: () => void;
  /** 管理标签、批量改标签、删除之后刷新 */
  onTagsChanged?: () => void;
  /** 在剪辑编辑器里打开来源视频 */
  onOpenEditor?: (videoId: number) => void;
  /** 嵌在标签页里：只看这个标签的片段（不显示标签筛选） */
  tagId?: number;
}

const LEVELS = ['a1', 'a2', 'b1', 'b2'];

const CLIP_SORTS: SortOption<ClipSummary>[] = [
  ...PASSAGE_SORTS.slice(0, 1),
  {
    value: 'video',
    label: '按视频顺序',
    compare: (a, b) => byText<ClipSummary>((c) => c.videoTitle)(a, b) || a.videoId - b.videoId || a.startMs - b.startMs,
  },
  ...PASSAGE_SORTS.slice(1),
  { value: 'long', label: '时长最长', compare: byNumber((c) => c.endMs - c.startMs) },
];
/** 像英文单词 / 短语时，也到字幕里找 */
const ENGLISH = /^[a-z][a-z' -]*$/i;

/**
 * 视频库「片段」：切出来的短片是主要素材。可按标签、来源视频、难度筛选；搜索除了标题、重点词与标签，
 * 输入英文词时还会找字幕里出现过它的片段（跨视频看同一个词的真实场景），卡片上显示出现的那句。
 */
export const ClipGrid: React.FC<ClipGridProps> = ({ clips, videos, videoId, onOpen, onGoSources, onTagsChanged, onOpenEditor, tagId }) => {
  const fixedTag = tagId !== undefined;
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(fixedTag ? String(tagId) : 'all');
  const [video, setVideo] = useState(videoId ? String(videoId) : 'all');
  const [level, setLevel] = useState('all');
  const [sortBy, setSortBy] = useSortPref('clips', CLIP_SORTS);
  /** 字幕里出现了搜索词的片段：passageId → 那一句 */
  const [subtitleHits, setSubtitleHits] = useState<Map<number, string>>(new Map());
  const [playlist, setPlaylist] = useState<ClipSummary[] | null>(null);
  const [toDelete, setToDelete] = useState<ClipSummary[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !ENGLISH.test(q)) {
      setSubtitleHits(new Map());
      return;
    }
    const timer = window.setTimeout(async () => {
      const result = await tagService.getWordMaterials(q);
      if (result.success) setSubtitleHits(new Map(result.data.filter((m) => m.origin === 'video').map((m) => [m.passageId, m.en])));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const visible = useMemo(() => {
    if (!clips) return null;
    const q = query.trim().toLowerCase();
    const shown = clips.filter(
      (c) =>
        (tag === 'all' || c.tags.some((t) => String(t.id) === tag)) &&
        (video === 'all' || String(c.videoId) === video) &&
        (level === 'all' || c.level === level) &&
        (!q ||
          c.title.toLowerCase().includes(q) ||
          c.targetWords.some((w) => w.word.toLowerCase().includes(q)) ||
          c.tags.some((t) => t.name.toLowerCase().includes(q)) ||
          subtitleHits.has(c.id))
    );
    return sortItems(shown, CLIP_SORTS, sortBy);
  }, [clips, query, tag, video, level, subtitleHits, sortBy]);

  const pager = usePagination(visible, { id: fixedTag ? `clips:tag${tagId}` : 'clips', resetKey: `${query.trim()}|${tag}|${video}|${level}|${sortBy}` });
  // 多选只针对当前这一页（换页即清空），与单词列表一致
  const selection = useSelection(useMemo(() => (pager.pageItems ?? []).map((c) => c.id), [pager.pageItems]));
  const pickedClips = (visible ?? []).filter((c) => selection.selected.has(c.id));
  const sourceVideos = videos.filter((v) => v.clipCount > 0);
  const active = (query ? 1 : 0) + (!fixedTag && tag !== 'all' ? 1 : 0) + (video !== 'all' ? 1 : 0) + (level !== 'all' ? 1 : 0);

  if (clips !== null && clips.length === 0) {
    return (
      <EmptyState
        icon={<Clapperboard />}
        title="还没有片段"
        description="在原始视频里规划切分后，切出的片段会出现在这里"
        action="去原始视频"
        onAction={onGoSources}
      />
    );
  }

  return (
    <div ref={pager.anchorRef} className="flex scroll-mt-4 flex-col gap-4">
      {selection.selecting ? (
        <SelectionBar selection={selection} unit="段">
          <Button variant="ghost" size="sm" onClick={() => setPlaylist(pickedClips)}>
            <ListVideo />
            连续播放
          </Button>
          <BatchTagButton kind="passage" ids={selection.ids} onDone={() => onTagsChanged?.()} />
          <BatchDeleteButton count={selection.selected.size} onClick={() => setToDelete(pickedClips)} />
        </SelectionBar>
      ) : (
      <MaterialToolbar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="搜索标题、标签或英文词"
        tag={fixedTag ? null : { kind: 'clip', value: tag, onChange: setTag, onTagsChanged }}
        activeCount={active}
        onReset={() => {
          setQuery('');
          if (!fixedTag) setTag('all');
          setVideo('all');
          setLevel('all');
        }}
        countText={visible ? `共 ${visible.length} 段` : undefined}
        actions={
          visible && visible.length > 1 ? (
            <Button variant="outline" onClick={() => setPlaylist(visible)}>
              <ListVideo />
              连续播放
            </Button>
          ) : undefined
        }
      >
        <Select value={video} onValueChange={setVideo}>
          <SelectTrigger className="w-44" aria-label="来源视频">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有视频</SelectItem>
            {sourceVideos.map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>
                <span className="truncate">{v.title}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-28" aria-label="难度">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有难度</SelectItem>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SortSelect value={sortBy} options={CLIP_SORTS} onChange={setSortBy} />
      </MaterialToolbar>
      )}

      {visible === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<SearchX />} title="没有匹配的片段" />
      ) : (
        <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {(pager.pageItems ?? []).map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              subtitle={subtitleHits.get(c.id)}
              selection={selection}
              onOpen={() => onOpen(c)}
              actions={[
                { label: '打开学习', icon: <Play />, onSelect: () => onOpen(c) },
                { label: '播放', icon: <ListVideo />, onSelect: () => setPlaylist([c]) },
                ...(onOpenEditor ? [{ label: '在剪辑编辑器里查看', icon: <Scissors />, onSelect: () => onOpenEditor(c.videoId) }] : []),
                { label: '删除片段…', icon: <Trash2 />, onSelect: () => setToDelete([c]), destructive: true, separator: true },
              ]}
            />
          ))}
        </div>
        <ListPagination page={pager.page} pageSize={pager.pageSize} total={pager.total} onChange={pager.setPage} hideSinglePage unit="段" />
        </>
      )}
      <ClipPlaylistDialog clips={playlist} onClose={() => setPlaylist(null)} onOpen={onOpen} />
      <BatchDeleteDialog
        items={toDelete}
        onClose={() => setToDelete(null)}
        unit="段片段"
        description="片段的视频、短文与练习记录都会删除，不能恢复；原始视频不受影响，可以重新切出来。计划里还在用的片段不会删除。"
        nameOf={(c) => c.title}
        remove={(c) => passageService.deletePassage(c.id)}
        onDone={() => {
          selection.clear();
          onTagsChanged?.();
        }}
      />
    </div>
  );
};

/** 片段卡片：预览图（时长）→ 标题 → 来源视频 · 段序 · 难度 → 标签 → 重点词（或搜索命中的那句字幕）；⋯ 与右键同一组操作，悬停左上角可勾选 */
const ClipCard: React.FC<{ clip: ClipSummary; subtitle?: string; selection: Selection; actions: CardAction[]; onOpen: () => void }> = ({
  clip: c,
  subtitle,
  selection,
  actions,
  onOpen,
}) => {
  const checked = selection.selected.has(c.id);
  return (
    <CardMenu actions={actions}>
      <Card
        className={cn('group relative cursor-default gap-0 overflow-hidden p-0 transition-colors select-none hover:border-ring/60', checked && 'border-primary ring-2 ring-primary/30')}
        onClick={() => (selection.selecting ? selection.toggle(c.id) : onOpen())}
      >
        <SelectCheckbox checked={checked} selecting={selection.selecting} onToggle={() => selection.toggle(c.id)} label={`选择「${c.title}」`} />
        <div className="relative aspect-video w-full bg-muted">
          {c.posterUrl ? (
            <img src={c.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <Clapperboard className="size-8" />
            </div>
          )}
          {!selection.selecting && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Play className="size-8" />
            </span>
          )}
          <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">
            {formatDuration(c.endMs - c.startMs, 'clock')}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={c.title}>
                {c.title}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {c.videoTitle} · 第 {c.seq} 段 · {c.level.toUpperCase()}
                {c.completedAttempts > 0 && ` · 练过 ${c.completedAttempts} 次`}
              </div>
            </div>
            <CardMenuButton actions={actions} />
          </div>
          <TagChips tags={c.tags} limit={3} />
          {subtitle ? (
            <p className="line-clamp-2 rounded bg-muted px-2 py-1 text-xs">{subtitle}</p>
          ) : (
            c.targetWords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {c.targetWords.slice(0, 6).map((w) => (
                  <span key={w.word} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {w.word}
                  </span>
                ))}
              </div>
            )
          )}
        </div>
      </Card>
    </CardMenu>
  );
};
