import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { formatDuration } from '@/utils/datetime';
import type { PassageSentence } from '@/types/passage';
import type { ClipSummary } from '@/types/video';

export interface ClipPlaylistDialogProps {
  /** 要连播的片段（视频库当前筛选出的）；null 时关闭 */
  clips: ClipSummary[] | null;
  onClose: () => void;
  onOpen: (clip: ClipSummary) => void;
}

/**
 * 连续播放一组片段（如同一个标签 / 同一个词在不同视频里的场景）：播完自动下一段，字幕叠在画面上（英 / 中），
 * 右侧列表可跳到任意一段。字幕按需读取当前这段的短文。
 */
export const ClipPlaylistDialog: React.FC<ClipPlaylistDialogProps> = ({ clips, onClose, onOpen }) => {
  const [index, setIndex] = useState(0);
  const [sentences, setSentences] = useState<PassageSentence[]>([]);
  const [now, setNow] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const clip = clips?.[index];

  useEffect(() => {
    setIndex(0);
  }, [clips]);

  useEffect(() => {
    setSentences([]);
    setNow(0);
    if (!clip) return;
    let stale = false;
    passageService.getPassage(clip.id).then((r) => !stale && r.success && setSentences(r.data.sentences));
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
    return () => {
      stale = true;
    };
  }, [clip, index]);

  const line = sentences.find((s) => (s.startMs ?? 0) <= now && now < (s.endMs ?? 0));
  const go = (i: number) => clips && i >= 0 && i < clips.length && setIndex(i);

  return (
    <Dialog open={clips !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid h-[80vh] grid-cols-[minmax(0,1fr)_280px] gap-0 overflow-hidden p-0 sm:max-w-6xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">连续播放</DialogTitle>
        <div className="flex min-h-0 flex-col bg-black">
          <div className="relative min-h-0 flex-1">
            {clip?.clipUrl && (
              <video
                key={clip.id}
                ref={videoRef}
                src={clip.clipUrl}
                poster={clip.posterUrl ?? undefined}
                autoPlay
                controls
                className="absolute inset-0 size-full object-contain"
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)}
                onEnded={() => go(index + 1)}
              />
            )}
            {line && (
              <div className="pointer-events-none absolute inset-x-6 bottom-14 text-center">
                <span className="inline-block rounded bg-black/70 px-3 py-1 text-lg leading-snug text-white">
                  {line.en}
                  {line.zh && <span className="block text-sm text-white/80">{line.zh}</span>}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 bg-background px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{clip?.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {clip?.videoTitle} · 第 {clip?.seq} 段
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="上一段" onClick={() => go(index - 1)} disabled={index === 0}>
              <SkipBack />
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {index + 1} / {clips?.length ?? 0}
            </span>
            <Button variant="ghost" size="icon" aria-label="下一段" onClick={() => go(index + 1)} disabled={!clips || index >= clips.length - 1}>
              <SkipForward />
            </Button>
            {clip && (
              <Button variant="outline" size="sm" onClick={() => onOpen(clip)}>
                <ExternalLink />
                打开学习
              </Button>
            )}
          </div>
        </div>
        <div ref={listRef} className="min-h-0 overflow-y-auto border-l p-2">
          {clips?.map((c, i) => (
            <button
              key={c.id}
              type="button"
              data-index={i}
              className={cn('flex w-full gap-2 rounded-md p-1.5 text-left hover:bg-muted', i === index && 'bg-accent')}
              onClick={() => setIndex(i)}
            >
              <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded bg-muted">
                {c.posterUrl && <img src={c.posterUrl} alt="" className="size-full object-cover" loading="lazy" />}
                <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">
                  {formatDuration(c.endMs - c.startMs, 'clock')}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-xs font-medium">{c.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{c.videoTitle}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
