import React, { useMemo } from 'react';
import { CheckCheck, SearchX, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { cn } from '@/lib/utils';
import { partOfSpeechLabel } from '@/utils/partOfSpeech';
import type { WordExample } from '@/types';

export interface ExtractedWord {
  /** 单词ID */
  id: string;
  /** 英文单词 */
  word: string;
  /** 中文含义 */
  meaning: string;
  /** 词性 */
  partOfSpeech: 'n.' | 'v.' | 'adj.' | 'adv.' | 'prep.' | 'conj.' | 'int.' | 'pron.' | 'art.' | 'det.';
  /** 出现次数 */
  frequency: number;
  /** 是否已选择 */
  selected: boolean;
  /** 已在单词本中（勾选保存会用新分析覆盖原有内容） */
  existing?: boolean;
  /** 自然拼读信息（可选） */
  phonics?: {
    ipa: string;
    syllables: string;
    phonics_rule: string;
    analysis_explanation: string;
    pos_abbreviation: string;
    pos_english: string;
    pos_chinese: string;
    frequency: number;
    /** 例句（第一句最简单） */
    examples?: WordExample[];
  };
}

export interface WordGridProps {
  /** 提取的单词列表 */
  words: ExtractedWord[];
  /** 单词选择变化回调 */
  onWordToggle: (wordId: string) => void;
  /** 全选/取消全选回调 */
  onSelectAll: (selected: boolean) => void;
  /** 按词性选择回调 */
  onSelectByPartOfSpeech?: (partOfSpeech: string, selected: boolean) => void;
  /** 显示出现次数（AI 生成的单词没有次数，传 false） */
  showFrequency?: boolean;
}

/**
 * 单词选择网格（shadcn）：工具栏（已选计数 + 全选 + 按词性快速选择）+ 统一高度的可勾选单词卡。
 * 卡片在有拼读分析时显示音节、音标与首条例句。添加单词弹窗的“选择单词”与“检查结果”共用。
 */
export const WordGrid: React.FC<WordGridProps> = ({ words, onWordToggle, onSelectAll, onSelectByPartOfSpeech, showFrequency = true }) => {
  const selectedCount = words.filter((w) => w.selected).length;
  const allSelected = words.length > 0 && selectedCount === words.length;

  const posStats = useMemo(() => {
    const stats: Record<string, { total: number; selected: number }> = {};
    for (const w of words) {
      const s = (stats[w.partOfSpeech] ??= { total: 0, selected: 0 });
      s.total += 1;
      if (w.selected) s.selected += 1;
    }
    return stats;
  }, [words]);

  if (words.length === 0) {
    return <EmptyState icon={<SearchX />} title="没有找到单词" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm">
          已选 <span className="font-semibold tabular-nums">{selectedCount}</span>
          <span className="text-muted-foreground"> / {words.length}</span>
        </span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onSelectAll(!allSelected)}>
          {allSelected ? <X /> : <CheckCheck />}
          {allSelected ? '全不选' : '全选'}
        </Button>
        {onSelectByPartOfSpeech && Object.keys(posStats).length > 1 && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {Object.entries(posStats).map(([pos, stat]) => {
              const full = stat.selected === stat.total;
              return (
                <button
                  key={pos}
                  type="button"
                  aria-pressed={full}
                  title={`${partOfSpeechLabel(pos)}：已选 ${stat.selected}/${stat.total}，点击${full ? '全部取消' : '全部选中'}`}
                  onClick={() => onSelectByPartOfSpeech(pos, !full)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    full ? 'border-primary/50 bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {partOfSpeechLabel(pos)}
                  <span className="tabular-nums">{stat.selected}/{stat.total}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {words.map((word) => {
          const example = word.phonics?.examples?.[0];
          return (
            <label
              key={word.id}
              className={cn(
                'flex cursor-default gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40',
                word.selected ? 'border-primary/40 bg-accent/30' : 'text-muted-foreground [&_.font-semibold]:text-muted-foreground'
              )}
            >
              <Checkbox checked={word.selected} onCheckedChange={() => onWordToggle(word.id)} className="mt-0.5" aria-label={`选择 ${word.word}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{word.word}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" title={partOfSpeechLabel(word.partOfSpeech)}>
                    {word.partOfSpeech}
                  </span>
                  {word.existing && (
                    <Badge variant="outline" className="ml-auto h-5 shrink-0 border-transparent bg-warning-soft px-1.5 text-[11px] text-warning" title="已在单词本中，勾选后会用新的分析覆盖原有内容">
                      已存在
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted-foreground">{word.meaning || '—'}</div>
                {word.phonics && (
                  <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    <div className="truncate">
                      {word.phonics.syllables && <span className="font-mono text-foreground">{word.phonics.syllables}</span>}
                      {word.phonics.ipa && <span className="ml-2">{word.phonics.ipa}</span>}
                    </div>
                    {example && (
                      <div className="line-clamp-1" title={`${example.sentence} ${example.translation}`}>
                        {example.sentence}
                      </div>
                    )}
                  </div>
                )}
                {showFrequency && !word.phonics && word.frequency > 1 && <div className="mt-1 text-xs text-muted-foreground">出现 {word.frequency} 次</div>}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
