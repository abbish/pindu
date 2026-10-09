import React, { useEffect, useMemo, useState } from 'react';
import { Clapperboard, ListVideo, Play, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClipPlaylistDialog } from './ClipPlaylistDialog';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
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
  /** 管理标签后刷新 */
  onTagsChanged?: () => void;
}

const LEVELS = ['a1', 'a2', 'b1', 'b2'];
/** 像英文单词 / 短语时，也到字幕里找 */
const ENGLISH = /^[a-z][a-z' -]*$/i;

/**
 * 视频库「片段」：切出来的短片是主要素材。可按标签、来源视频、难度筛选；搜索除了标题、重点词与标签，
 * 输入英文词时还会找字幕里出现过它的片段（跨视频看同一个词的真实场景），卡片上显示出现的那句。
 */
export const ClipGrid: React.FC<ClipGridProps> = ({ clips, videos, videoId, onOpen, onGoSources, onTagsChanged }) => {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const [video, setVideo] = useState(videoId ? String(videoId) : 'all');
  const [level, setLevel] = useState('all');
  /** 字幕里出现了搜索词的片段：passageId → 那一句 */
  const [subtitleHits, setSubtitleHits] = useState<Map<number, string>>(new Map());
  const [playlist, setPlaylist] = useState<ClipSummary[] | null>(null);

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
    return clips.filter(
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
  }, [clips, query, tag, video, level, subtitleHits]);

  const sourceVideos = videos.filter((v) => v.clipCount > 0);
  const active = (query ? 1 : 0) + (tag !== 'all' ? 1 : 0) + (video !== 'all' ? 1 : 0) + (level !== 'all' ? 1 : 0);

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
    <div className="flex flex-col gap-4">
      <MaterialToolbar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="搜索标题、标签或英文词"
        tag={{ kind: 'passage', value: tag, onChange: setTag, onTagsChanged }}
        activeCount={active}
        onReset={() => {
          setQuery('');
          setTag('all');
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
      </MaterialToolbar>

      {visible === null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<SearchX />} title="没有匹配的片段" />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {visible.map((c) => (
            <ClipCard key={c.id} clip={c} subtitle={subtitleHits.get(c.id)} onOpen={() => onOpen(c)} />
          ))}
        </div>
      )}
      <ClipPlaylistDialog clips={playlist} onClose={() => setPlaylist(null)} onOpen={onOpen} />
    </div>
  );
};

/** 片段卡片：预览图（时长）→ 标题 → 来源视频 · 段序 · 难度 → 标签 → 重点词（或搜索命中的那句字幕） */
const ClipCard: React.FC<{ clip: ClipSummary; subtitle?: string; onOpen: () => void }> = ({ clip: c, subtitle, onOpen }) => (
  <Card className="group cursor-default gap-0 overflow-hidden p-0 transition-colors select-none hover:border-ring/60" onClick={onOpen}>
    <div className="relative aspect-video w-full bg-muted">
      {c.posterUrl ? (
        <img src={c.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Clapperboard className="size-8" />
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <Play className="size-8" />
      </span>
      <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">
        {formatDuration(c.endMs - c.startMs, 'clock')}
      </span>
    </div>
    <div className="flex flex-col gap-2 p-3">
      <div className="min-w-0">
        <button
          type="button"
          className="block max-w-full truncate text-left font-medium outline-none focus-visible:underline"
          title={c.title}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {c.title}
        </button>
        <div className="truncate text-xs text-muted-foreground">
          {c.videoTitle} · 第 {c.seq} 段 · {c.level.toUpperCase()}
          {c.completedAttempts > 0 && ` · 练过 ${c.completedAttempts} 次`}
        </div>
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
);
