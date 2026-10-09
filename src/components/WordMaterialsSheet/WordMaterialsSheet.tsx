import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, ExternalLink, FileText, Loader2, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InlineError } from '@/components/InlineError';
import { splitByKeyWords } from '@/pages/video-editor/plan';
import { tagService } from '@/services/tagService';
import { cn } from '@/lib/utils';
import type { WordMaterial } from '@/types/material';

export interface WordMaterialsSheetProps {
  /** 要看的词；null 时关闭 */
  word: { id: number; word: string } | null;
  onClose: () => void;
  /** 打开短文 / 切片详情 */
  onOpenPassage: (passageId: number, isClip: boolean) => void;
}

/**
 * 一个词出现在哪些素材里：视频切片在前（可直接从出现的那句开始播放，看真实场景），然后是短文；
 * 重点词标「重点」，只是正文里出现过的不标。
 */
export const WordMaterialsSheet: React.FC<WordMaterialsSheetProps> = ({ word, onClose, onOpenPassage }) => {
  const [summary, setSummary] = useState('\u00a0');
  return (
    <Sheet open={word !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[440px] gap-0 sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>{word?.word}</SheetTitle>
          <SheetDescription>{summary}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {word && <WordMaterialsList word={word.word} wordId={word.id} onOpenPassage={onOpenPassage} onLoaded={(clips, passages) => setSummary(`${clips} 个视频片段 · ${passages} 篇短文`)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export interface WordMaterialsListProps {
  word: string;
  wordId?: number;
  /** 打开短文 / 切片详情；不传则不显示（如练习中） */
  onOpenPassage?: (passageId: number, isClip: boolean) => void;
  /** 只列视频片段（练习右栏「场景」） */
  clipsOnly?: boolean;
  onLoaded?: (clips: number, passages: number) => void;
}

/** 一个词的素材列表（视频片段 → 短文），单词本侧栏与练习右栏共用 */
export const WordMaterialsList: React.FC<WordMaterialsListProps> = ({ word, wordId, onOpenPassage, clipsOnly, onLoaded }) => {
  const [items, setItems] = useState<WordMaterial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    setItems(null);
    setError(null);
    setPlaying(null);
    tagService.getWordMaterials(word, wordId).then((r) => {
      if (stale) return;
      if (r.success) {
        setItems(r.data);
        onLoaded?.(r.data.filter((m) => m.clip).length, r.data.filter((m) => !m.clip).length);
      } else setError(r.error);
    });
    return () => {
      stale = true;
    };
    // onLoaded 只是通知，不触发重新加载
  }, [word, wordId]);

  const clips = items?.filter((m) => m.clip) ?? [];
  const passages = clipsOnly ? [] : (items?.filter((m) => !m.clip) ?? []);

  if (error) return <InlineError title="无法查找">{error}</InlineError>;
  if (items === null) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        查找中…
      </div>
    );
  }
  if (clips.length + passages.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{clipsOnly ? '还没有视频片段用到这个词' : '还没有素材用到这个词'}</p>;
  }
  return (
    <div className="space-y-5">
      {clips.length > 0 && (
        <section className="space-y-2">
          {!clipsOnly && (
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Clapperboard className="size-4" />
              视频片段
            </h3>
          )}
          {clips.map((m) => (
            <ClipItem key={m.passageId} item={m} word={word} playing={playing === m.passageId} onPlay={() => setPlaying(m.passageId)} onOpen={onOpenPassage && (() => onOpenPassage(m.passageId, true))} />
          ))}
        </section>
      )}
      {passages.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="size-4" />
            短文
          </h3>
          {passages.map((m) => (
            <button key={m.passageId} type="button" className="block w-full rounded-lg border p-3 text-left hover:bg-muted disabled:pointer-events-none" onClick={() => onOpenPassage?.(m.passageId, false)} disabled={!onOpenPassage}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
                {m.key && <Badge variant="secondary">重点</Badge>}
              </div>
              {m.en && <Sentence en={m.en} zh={m.zh} word={word} />}
            </button>
          ))}
        </section>
      )}
    </div>
  );
};

const Sentence: React.FC<{ en: string; zh: string; word: string }> = ({ en, zh, word }) => (
  <p className="mt-1 text-sm leading-snug select-text">
    {splitByKeyWords(en, [word]).map((p, i) =>
      p.key ? (
        <mark key={i} className="rounded-sm bg-primary/15 px-0.5 font-medium text-foreground">
          {p.text}
        </mark>
      ) : (
        <React.Fragment key={i}>{p.text}</React.Fragment>
      )
    )}
    {zh && <span className="block text-xs text-muted-foreground">{zh}</span>}
  </p>
);

/** 切片：点播放就地从出现的那句开始放 */
const ClipItem: React.FC<{ item: WordMaterial; word: string; playing: boolean; onPlay: () => void; onOpen?: () => void }> = ({ item: m, word, playing, onPlay, onOpen }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = m.clip!;
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !v) return;
    v.currentTime = Math.max(0, (m.startMs ?? 0) - 300) / 1000;
    void v.play();
  }, [playing, m.startMs]);
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn('relative aspect-video bg-black', !playing && 'cursor-pointer')} onClick={() => !playing && onPlay()}>
        {playing && clip.clipUrl ? (
          <video ref={videoRef} src={clip.clipUrl} poster={clip.posterUrl ?? undefined} controls className="size-full object-contain" />
        ) : (
          <>
            {clip.posterUrl && <img src={clip.posterUrl} alt="" className="size-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
              <Play className="size-8" />
            </span>
          </>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
          {m.key && <Badge variant="secondary">重点</Badge>}
          {onOpen && (
            <Button variant="ghost" size="icon" className="size-7" aria-label="打开片段" onClick={onOpen}>
              <ExternalLink />
            </Button>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{clip.videoTitle}</div>
        {m.en && <Sentence en={m.en} zh={m.zh} word={word} />}
      </div>
    </div>
  );
};
