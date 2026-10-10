import React from 'react';
import type { WordExample } from '../../types';
import { ExamplePanel, type ExampleDisplayMode, type ExampleGenerateMode } from '../ExamplePanel';
import { WordExplanationView } from '../WordExplanation';
import { Clapperboard, GraduationCap, Lock, Quote } from 'lucide-react';
import { WordMaterialsList } from '../WordMaterialsSheet/WordMaterialsSheet';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type WordSideTab = 'examples' | 'explanation' | 'scenes';

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
}

/** 各例句显示方式下给学生的说明 */
const TABS: { key: WordSideTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'examples', label: '例句', icon: Quote },
  { key: 'explanation', label: 'AI 老师', icon: GraduationCap },
  { key: 'scenes', label: '场景', icon: Clapperboard },
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
}) => {
  return (
    <Card className="sticky top-6 gap-3 p-4">
      <header className="space-y-2">
        <div className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]" role="tablist" aria-label="单词资料">
          {TABS.map((t) => {
            // 讲解与场景里都看得到拼写：「盖·写」时一起锁住
            const locked = t.key !== 'examples' && explanationLocked;
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
                title={locked ? '写完这一题再看' : undefined}
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
        <WordExplanationView wordId={wordId} active={tab === 'explanation' && !explanationLocked} word={word} />
      </div>
      {tab === 'scenes' && !explanationLocked && (
        <div role="tabpanel" className="max-h-[70vh] overflow-y-auto">
          <WordMaterialsList key={wordId} word={word} wordId={wordId} clipsOnly />
        </div>
      )}
      {tab !== 'examples' && explanationLocked && (
        <div role="tabpanel" className="flex flex-col items-center gap-2 py-10 text-center">
          <Lock className="size-6 text-muted-foreground" />
          <p className="font-medium">{tab === 'scenes' ? '写完这一题再看场景' : '写完这一题再问 AI 老师'}</p>
        </div>
      )}
    </Card>
  );
};
