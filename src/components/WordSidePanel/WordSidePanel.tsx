import React from 'react';
import type { WordExample } from '../../types';
import { ExamplePanel, type ExampleDisplayMode, type ExampleGenerateMode } from '../ExamplePanel';
import { WordExplanationView } from '../WordExplanation';
import { GraduationCap, Lock, Quote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type WordSideTab = 'examples' | 'explanation';

export interface WordSidePanelProps {
  /** 当前页签 */
  tab: WordSideTab;
  /** 切换页签 */
  onTabChange: (tab: WordSideTab) => void;
  /** 当前单词 */
  wordId: number;
  word: string;
  /** 例句页签 */
  examples: WordExample[];
  exampleMode: ExampleDisplayMode;
  playingIndex?: number | null;
  loadingIndex?: number | null;
  onSelectExample: (index: number) => void;
  /** AI 例句生成：进行中的方式与触发回调 */
  generatingExamples?: ExampleGenerateMode | null;
  onGenerateExamples?: (mode: ExampleGenerateMode) => void;
  /** 「盖·写」时锁住 AI 讲解（讲解里有拼写，不能边写边查） */
  explanationLocked: boolean;
  /** 「查」时提示去看讲解 */
  explanationSuggested?: boolean;
  /** 没有讲解缓存时是否自动生成（只在会停下来看的环节） */
  explanationAutoGenerate?: boolean;
}

/** 各例句显示方式下给学生的说明 */
const EXAMPLE_MODE_HINT: Record<ExampleDisplayMode, string> = {
  full: '点击例句即可朗读',
  masked: '例句中的单词已隐藏，听一听再拼写',
  translation: '只显示中文，点击听英文例句',
};

const TABS: { key: WordSideTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'examples', label: '例句', icon: Quote },
  { key: 'explanation', label: 'AI 讲解', icon: GraduationCap },
];

/**
 * 练习页右栏：例句 / AI 讲解两个页签。两个页签都保持挂载，切换不打断讲解的生成。
 */
export const WordSidePanel: React.FC<WordSidePanelProps> = ({
  tab,
  onTabChange,
  wordId,
  word,
  examples,
  exampleMode,
  playingIndex,
  loadingIndex,
  onSelectExample,
  generatingExamples,
  onGenerateExamples,
  explanationLocked,
  explanationSuggested = false,
  explanationAutoGenerate = false,
}) => {
  const hint =
    tab === 'examples'
      ? examples.length > 0
        ? EXAMPLE_MODE_HINT[exampleMode]
        : '在不同场景里听一听这个单词'
      : explanationLocked
        ? '写完这一题就能看讲解、问 AI 老师'
        : '不理解这个单词？看讲解，或者问问 AI 老师';

  return (
    <Card className="sticky top-6 gap-3 p-4">
      <header className="space-y-2">
        <div className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]" role="tablist" aria-label="单词资料">
          {TABS.map((t) => {
            const locked = t.key === 'explanation' && explanationLocked;
            const suggested = t.key === 'explanation' && explanationSuggested && tab !== 'explanation';
            const Icon = locked ? Lock : t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                aria-disabled={locked}
                onClick={() => !locked && onTabChange(t.key)}
                title={locked ? '盖住单词写的时候不能看讲解，写完这一题再看' : undefined}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  locked && 'opacity-60'
                )}
              >
                <Icon className="size-4" />
                {t.label}
                {t.key === 'examples' && examples.length > 0 && <Badge variant="secondary" className="h-5 px-1.5">{examples.length}</Badge>}
                {suggested && <Badge className="h-5 animate-pulse px-1.5">去看看</Badge>}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </header>
      <div role="tabpanel" hidden={tab !== 'examples'}>
        <ExamplePanel
          word={word}
          examples={examples}
          mode={exampleMode}
          playingIndex={playingIndex}
          loadingIndex={loadingIndex}
          onSelect={onSelectExample}
          generating={generatingExamples}
          onGenerate={onGenerateExamples}
        />
      </div>
      <div role="tabpanel" hidden={tab !== 'explanation' || explanationLocked}>
        <WordExplanationView wordId={wordId} active={tab === 'explanation' && !explanationLocked} autoGenerate={explanationAutoGenerate} />
      </div>
      {tab === 'explanation' && explanationLocked && (
        <div role="tabpanel" className="flex flex-col items-center gap-2 py-10 text-center">
          <Lock className="size-6 text-muted-foreground" />
          <p className="font-medium">正在盖住单词写，先不看讲解</p>
          <span className="text-sm text-muted-foreground">讲解里有这个单词的拼写。写完这一题，就能继续看讲解、问 AI 老师</span>
        </div>
      )}
    </Card>
  );
};
