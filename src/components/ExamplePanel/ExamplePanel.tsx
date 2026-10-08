import React from 'react';
import type { WordExample } from '../../types';
import { maskExampleSentence, splitExampleSentence } from '../../utils/exampleSentence';
import { PanelToolbar } from '../WordSidePanel/PanelToolbar';
import { Loader2, MessageSquareOff, PenLine, Play, Plus, RotateCw, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 例句显示方式：完整（高亮单词）/ 挖空单词 / 只显示中文 */
export type ExampleDisplayMode = 'full' | 'masked' | 'translation';

export interface ExamplePanelProps {
  /** 当前单词（用于高亮 / 挖空） */
  word: string;
  /** 例句列表（第一句最简单） */
  examples: WordExample[];
  /** 显示方式 */
  mode: ExampleDisplayMode;
  /** 正在朗读的例句序号 */
  playingIndex?: number | null;
  /** 正在生成语音的例句序号 */
  loadingIndex?: number | null;
  /** 点击例句：朗读该句 */
  onSelect: (index: number) => void;
  /** 正在进行的 AI 例句生成（补充 / 重新生成） */
  generating?: ExampleGenerateMode | null;
  /** AI 补充或重新生成例句；不传则不显示工具条 */
  onGenerate?: (mode: ExampleGenerateMode) => void;
}

/** AI 例句生成方式：在已有例句后补充 / 全部重新生成 */
export type ExampleGenerateMode = 'append' | 'replace';

/**
 * 例句列表（练习页右栏「例句」页签的内容）：点击任意一句朗读。
 */
export const ExamplePanel: React.FC<ExamplePanelProps> = ({
  word,
  examples,
  mode,
  playingIndex = null,
  loadingIndex = null,
  onSelect,
  generating = null,
  onGenerate,
}) => {
  const renderSentence = (sentence: string) => {
    if (mode === 'masked') return maskExampleSentence(sentence, word);
    return splitExampleSentence(sentence, word).map((part, index) =>
      part.isTarget
        ? <strong key={index} className="font-semibold text-primary">{part.text}</strong>
        : <React.Fragment key={index}>{part.text}</React.Fragment>
    );
  };

  const toolbar = onGenerate && (
    <PanelToolbar
      meta={
        generating ? (
          <span className="inline-flex items-center gap-1">
            <PenLine className="size-3.5" />
            {generating === 'append' ? '正在补充例句…' : '正在重写例句…'}
          </span>
        ) : examples.length > 0 ? (
          `共 ${examples.length} 条例句`
        ) : null
      }
      actions={[
        {
          key: 'append',
          label: '补充例句',
          icon: Plus,
          onClick: () => onGenerate('append'),
          disabled: !!generating,
          spinning: generating === 'append',
        },
        // 已有例句时才能「重新生成」（替换现有例句）
        ...(examples.length > 0
          ? [{
              key: 'replace',
              label: '重新生成',
              icon: RotateCw,
              onClick: () => onGenerate('replace'),
              disabled: !!generating,
              spinning: generating === 'replace',
              title: '替换现有例句',
            }]
          : []),
      ]}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {examples.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          {generating ? <Loader2 className="size-6 animate-spin text-primary" /> : <MessageSquareOff className="size-6 text-muted-foreground" />}
          <p className="font-medium">{generating ? '正在写例句…' : '还没有例句'}</p>
        </div>
      ) : (
        <ol className={cn('flex flex-col gap-2', generating === 'replace' && 'opacity-50')}>
          {examples.map((example, index) => {
            const playing = playingIndex === index;
            const loading = loadingIndex === index;
            return (
              <li key={`${index}-${example.sentence}`}>
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  title="朗读这条例句"
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    playing && 'border-primary bg-accent/40'
                  )}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    {mode !== 'translation' && <span className="block leading-relaxed">{renderSentence(example.sentence)}</span>}
                    {example.translation && (
                      <span className={cn('block', mode === 'translation' ? 'leading-relaxed' : 'text-sm text-muted-foreground')}>{example.translation}</span>
                    )}
                  </span>
                  <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : playing ? <Volume2 className="size-4 text-primary" /> : <Play className="size-4" />}
                  </span>
                </button>
              </li>
            );
          })}
          {generating === 'append' && (
            <li className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 正在写例句…
            </li>
          )}
        </ol>
      )}
      {toolbar}
    </div>
  );
};
