import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Merge, Play, Plus, Scissors, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Cue, VideoSegment } from '@/types/video';
import { ISSUE_TEXT, splitByKeyWords, type SegmentIssue } from './plan';
import { formatClock } from './time';

const LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'];
const TAG_MAX = 10;

export interface SegmentPanelProps {
  index: number;
  segment: VideoSegment;
  /** 这段里的字幕（已按纠偏换算） */
  cues: Cue[];
  playheadMs: number;
  thumb: string | undefined;
  issues: SegmentIssue[];
  /** 已切出短片 */
  cut: boolean;
  /** 已有的标签名（补全用） */
  tagNames: string[];
  onChange: (patch: Partial<VideoSegment>, field: string) => void;
  onPlay: () => void;
  onSeek: (ms: number) => void;
  onSplit: () => void;
  onMerge: () => void;
  onDelete: () => void;
}

/**
 * 选中片段：面向学习呈现——预览图、时长 / 句数 / 难度 / 标签，「字幕」页逐句英中对照（点一句跳到那里播放、
 * 当前句高亮、重点词标出、缺中文时可翻译这一段），「信息」页改标题、场景、难度、学习重点、重点词与标签。
 */
export const SegmentPanel: React.FC<SegmentPanelProps> = (props) => {
  const { index, segment, cues, playheadMs, thumb, issues, cut, onPlay, onSeek } = props;
  const activeRef = useRef<HTMLButtonElement>(null);
  const active = cues.find((c) => c.startMs <= playheadMs && playheadMs < c.endMs);

  // 播放时当前句保持可见
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex gap-3">
          <button type="button" className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-muted" onClick={onPlay} aria-label="播放这一段">
            {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white opacity-0 transition-opacity hover:opacity-100">
              <Play className="size-5" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">片段 {index + 1}</div>
            <div className="line-clamp-2 font-medium">{segment.title || '未命名'}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatClock(segment.startMs, false)} – {formatClock(segment.endMs, false)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="tabular-nums">
            {formatClock(segment.endMs - segment.startMs, false)}
          </Badge>
          <Badge variant="secondary">{cues.length} 句</Badge>
          {segment.level && <Badge variant="secondary">{segment.level.toUpperCase()}</Badge>}
          {cut && (
            <Badge variant="outline" className="text-success">
              <Check />
              已切出
            </Badge>
          )}
          {(segment.tags ?? []).map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
        {segment.focus && <p className="text-sm text-muted-foreground">{segment.focus}</p>}
        {issues.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {issues.map((i) => ISSUE_TEXT[i]).join('、')}
          </p>
        )}
      </div>

      <Tabs defaultValue="subtitles" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="subtitles">字幕</TabsTrigger>
          <TabsTrigger value="info">信息</TabsTrigger>
        </TabsList>
        <TabsContent value="subtitles" className="min-h-0 overflow-y-auto px-2 pt-2 pb-4">
          {cues.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">这一段没有字幕</p>
          ) : (
            cues.map((c) => {
              const isActive = c === active;
              return (
                <button
                  key={c.startMs}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  className={cn(
                    'flex w-full gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted',
                    // 接着上一条的同一句：贴着上一条，不再单独标时间，读起来是一整句
                    c.join && '-mt-1.5 pt-0',
                    isActive && 'bg-accent'
                  )}
                  onClick={() => onSeek(c.startMs)}
                >
                  <span className="w-9 shrink-0 pt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">
                    {!c.join && formatClock(Math.max(0, c.startMs - segment.startMs), false)}
                  </span>
                  <span className="min-w-0 flex-1 select-text">
                    <span className="block text-sm leading-snug">
                      {splitByKeyWords(c.en, segment.keyWords).map((p, i) =>
                        p.key ? (
                          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 font-medium text-foreground">
                            {p.text}
                          </mark>
                        ) : (
                          <React.Fragment key={i}>{p.text}</React.Fragment>
                        )
                      )}
                    </span>
                    {c.zh && <span className="block text-xs text-muted-foreground">{c.zh}</span>}
                  </span>
                </button>
              );
            })
          )}
        </TabsContent>
        <TabsContent value="info" className="min-h-0 overflow-y-auto px-4 pt-3 pb-4">
          <SegmentFields {...props} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

/** 「信息」页：标题、场景、难度、学习重点、重点词、标签，与拆分 / 合并 / 删除 */
const SegmentFields: React.FC<SegmentPanelProps> = ({ segment, tagNames, onChange, onSplit, onMerge, onDelete }) => {
  const [keyWords, setKeyWords] = useState(segment.keyWords.join(', '));
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="seg-title">标题</Label>
        <Input id="seg-title" value={segment.title} maxLength={60} placeholder="如：Ordering at a Restaurant" onChange={(e) => onChange({ title: e.target.value }, 'title')} />
      </div>
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="seg-scene">场景</Label>
          <Input id="seg-scene" value={segment.scene} maxLength={40} placeholder="如：餐厅点餐" onChange={(e) => onChange({ scene: e.target.value }, 'scene')} />
        </div>
        <div className="space-y-1.5">
          <Label>难度</Label>
          <Select value={segment.level || 'none'} onValueChange={(v) => onChange({ level: v === 'none' ? '' : v }, 'level')}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未定</SelectItem>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="seg-focus">学习重点</Label>
        <Textarea id="seg-focus" rows={3} value={segment.focus} maxLength={300} placeholder="这一段适合学什么" onChange={(e) => onChange({ focus: e.target.value }, 'focus')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="seg-words">重点词（逗号分隔）</Label>
        <Input
          id="seg-words"
          value={keyWords}
          onChange={(e) => setKeyWords(e.target.value)}
          onBlur={() => onChange({ keyWords: [...new Set(keyWords.split(/[,，、]/).map((w) => w.trim()).filter(Boolean))] }, 'keyWords')}
        />
      </div>
      <div className="space-y-1.5">
        <Label>标签</Label>
        <TagNames value={segment.tags ?? []} options={tagNames} onChange={(tags) => onChange({ tags }, 'tags')} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onSplit}>
          <Scissors />
          拆分
        </Button>
        <Button variant="outline" size="sm" onClick={onMerge}>
          <Merge />
          合并
        </Button>
        <Button variant="outline" size="sm" className="ml-auto text-destructive" onClick={onDelete}>
          <Trash2 />
          删除
        </Button>
      </div>
    </div>
  );
};

/** 片段的标签名：已选的显示为可去掉的标签，浮层里从已有标签选或直接输入新的 */
const TagNames: React.FC<{ value: string[]; options: string[]; onChange: (names: string[]) => void }> = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const name = query.trim();
  const has = (n: string) => value.some((v) => v.toLowerCase() === n.toLowerCase());
  const canAdd = name.length > 0 && [...name].length <= TAG_MAX && !has(name) && !options.some((o) => o.toLowerCase() === name.toLowerCase());
  const add = (n: string) => {
    if (!has(n)) onChange([...value, n]);
    setQuery('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 pr-1">
          {t}
          <button type="button" aria-label={`移除 ${t}`} className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => onChange(value.filter((v) => v !== t))}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            <Plus />
            添加
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandInput placeholder="搜索或新建标签" value={query} onValueChange={setQuery} maxLength={TAG_MAX} />
            <CommandList>
              {!canAdd && <CommandEmpty>没有匹配的标签</CommandEmpty>}
              <CommandGroup>
                {options
                  .filter((o) => !has(o))
                  .map((o) => (
                    <CommandItem key={o} value={o} onSelect={() => add(o)}>
                      {o}
                    </CommandItem>
                  ))}
              </CommandGroup>
              {canAdd && (
                <CommandGroup forceMount>
                  <CommandItem value={`__create__${name}`} onSelect={() => add(name)} forceMount>
                    <Plus />
                    新建标签「{name}」
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
