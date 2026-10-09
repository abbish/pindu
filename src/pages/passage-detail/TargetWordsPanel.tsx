import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clapperboard, GraduationCap, Quote, Snail, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WordExplanationView } from '@/components/WordExplanation';
import { WordMaterialsList } from '@/components/WordMaterialsSheet/WordMaterialsSheet';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useJob, useOnJobFinished } from '@/hooks/useJobs';
import { JobPanel } from '@/components/Jobs';
import { cardWordId } from '@/services/wordExplanationService';
import { isJobActive } from '@/types/job';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { parsePhonicsSegments } from '@/utils/phonics';
import { targetOf, tokenize } from '@/utils/passage';
import type { Word } from '@/types';
import type { WordCard } from '@/types/material';
import type { Passage, PassageTargetWord } from '@/types/passage';

export interface TargetWordsPanelProps {
  passage: Passage;
  /** 列表下方的附加内容（如把未收录词加入单词本） */
  footer?: React.ReactNode;
  /** 打开时定位到这个词（从原文侧栏点进来） */
  focusWord?: string | null;
}

/** 句子里把这个词（含变形）标出来 */
const Highlighted: React.FC<{ text: string; word: string }> = ({ text, word }) => (
  <>
    {tokenize(text).map((t, i) =>
      t.kind === 'word' && targetOf(t.text, [word]) ? (
        <mark key={i} className="rounded-sm bg-warning-soft px-0.5 font-semibold text-foreground">
          {t.text}
        </mark>
      ) : (
        <React.Fragment key={i}>{t.text}</React.Fragment>
      )
    )}
  </>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/**
 * 短文详情「目标词」页签：左边目标词列表（指定单词 / AI 选词或重点词，未收录的标出），右边单词卡——
 * 发音（常速 / 慢速）、词性与释义、拼读分段与规则、本文中的句子（可听）、例句 / AI 讲解 / 其他素材。
 * 通过短文学这些词；↑ ↓ 或上一个 / 下一个切换。
 */
export const TargetWordsPanel: React.FC<TargetWordsPanelProps> = ({ passage, footer, focusWord }) => {
  const [details, setDetails] = useState<Map<string, Word> | null>(null);
  /** 不在单词本的目标词的单词卡（小写单词 → 卡片） */
  const [cards, setCards] = useState<Map<string, WordCard> | null>(null);
  /** 补生成单词卡的后台任务 */
  const [cardJobId, setCardJobId] = useState<string | null>(null);
  const cardJob = useJob(cardJobId);
  const [index, setIndex] = useState(0);
  const audio = useAudioPlayer();
  const imported = passage.origin !== 'generated';

  const loadCards = () =>
    passageService.getWordCards(passage.id).then((r) => setCards(new Map((r.success ? r.data : []).map((c) => [c.word.toLowerCase(), c]))));
  useEffect(() => {
    passageService.getPassageWords(passage.id).then((r) => setDetails(new Map((r.success ? r.data : []).map((w) => [w.word.toLowerCase(), w]))));
    void loadCards();
    // 未收录的词还没有单词卡：自动补生成（已有在跑的同类任务时接上它）
    if (passage.targetWords.some((w) => w.wordId === null)) {
      passageService.startWordCards(passage.id).then((r) => r.success && setCardJobId(r.data));
    }
    // loadCards 只依赖 passage.id
  }, [passage.id, passage.targetWords]);
  useOnJobFinished((job) => {
    if (job.id === cardJobId) void loadCards();
  });

  /** 指定单词在前，其后是 AI 选词 / 重点词 */
  const words = useMemo(() => [...passage.targetWords.filter((w) => w.required), ...passage.targetWords.filter((w) => !w.required)], [passage.targetWords]);
  useEffect(() => {
    if (!focusWord) return;
    const i = words.findIndex((w) => w.word.toLowerCase() === focusWord.toLowerCase());
    if (i >= 0) setIndex(i);
  }, [focusWord, words]);
  const current: PassageTargetWord | undefined = words[Math.min(index, words.length - 1)];
  const word = current ? details?.get(current.word.toLowerCase()) : undefined;
  const card = current && current.wordId === null ? cards?.get(current.word.toLowerCase()) : undefined;
  /** 单词卡内容：单词本里的词用单词本的资料，未收录的用单词卡 */
  const info = word
    ? {
        word: word.word,
        ipa: word.ipa,
        meaning: word.meaning,
        pos: word.pos_chinese || word.part_of_speech,
        segments: parsePhonicsSegments(word.phonics_segments),
        syllables: word.syllables,
        phonicsRule: word.phonics_rule,
        explanation: word.analysis_explanation,
        examples: word.examples ?? [],
      }
    : card
      ? {
          word: card.word,
          ipa: card.ipa,
          meaning: card.meaning,
          pos: card.posChinese || card.posAbbreviation,
          segments: undefined,
          syllables: card.syllables,
          phonicsRule: card.phonicsRule,
          explanation: card.analysisExplanation,
          examples: card.examples,
        }
      : undefined;
  /** 讲解 / 答疑用的 id：单词本的词用 wordId，未收录的用单词卡 */
  const aiWordId = current ? (current.wordId ?? (card ? cardWordId(card.word) : null)) : null;
  const generatingCard = current?.wordId === null && !card && cardJob !== undefined && isJobActive(cardJob);

  // ↑ ↓ 切换单词（输入框里不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, words.length - 1));
      else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [words.length]);

  const sentences = useMemo(() => (current ? passage.sentences.filter((s) => tokenize(s.en).some((t) => t.kind === 'word' && targetOf(t.text, [current.word]))) : []), [passage.sentences, current]);

  if (words.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">这篇短文没有目标词</p>;

  const speak = (text: string, style: 'word' | 'sentence', slow = false) => audio.playText(text, undefined, { style, speed: slow ? 'slow' : 'normal' }).catch(() => {});
  const segments = info?.segments;
  const meaning = info?.meaning || current?.meaning || '';
  const pos = info?.pos;
  const group = (required: boolean) => words.map((w, i) => ({ w, i })).filter(({ w }) => w.required === required);

  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-6">
      <div className="flex flex-col gap-4">
        <Card className="gap-1 p-2">
          {[true, false].map((required) => {
            const items = group(required);
            if (items.length === 0) return null;
            return (
              <div key={String(required)} className="py-1">
                <div className="px-2 pb-1 text-xs text-muted-foreground">{required ? '指定单词' : imported ? '重点词' : 'AI 选词'}</div>
                {items.map(({ w, i }) => {
                  const m = details?.get(w.word.toLowerCase())?.meaning || cards?.get(w.word.toLowerCase())?.meaning || w.meaning;
                  return (
                    <button
                      key={w.word}
                      type="button"
                      onClick={() => setIndex(i)}
                      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50', i === index && 'bg-accent text-accent-foreground hover:bg-accent')}
                      aria-current={i === index ? 'true' : undefined}
                    >
                      <span className="font-medium">{w.word}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{m}</span>
                      {w.wordId === null && <span className="size-1.5 shrink-0 rounded-full bg-warning" title="未收录" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </Card>
        {footer}
      </div>

      {current && (
        <Card className="gap-6 px-6 py-5">
          <header className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline gap-3">
                <h2 className="text-3xl font-semibold tracking-tight">{info?.word ?? current.word}</h2>
                {info?.ipa && <span className="text-muted-foreground">{info.ipa}</span>}
                {current.wordId === null && (
                  <Badge variant="outline" className="border-warning/40 font-normal text-warning">
                    未收录
                  </Badge>
                )}
              </div>
              {meaning && (
                <p>
                  {pos && <span className="mr-1.5 text-muted-foreground">{pos}</span>}
                  {meaning}
                </p>
              )}
            </div>
            <Button variant="outline" size="icon" aria-label="发音" onClick={() => speak(info?.word ?? current.word, 'word')}>
              <Volume2 />
            </Button>
            <Button variant="outline" size="icon" aria-label="慢速发音" onClick={() => speak(info?.word ?? current.word, 'word', true)}>
              <Snail />
            </Button>
          </header>

          {generatingCard && cardJob && <JobPanel job={cardJob} title="AI 正在生成单词卡" />}
          {details === null || cards === null ? (
            <Skeleton className="h-24" />
          ) : (
            (segments || info?.syllables || info?.phonicsRule || info?.explanation) && (
              <Section title="拼读">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(segments ?? (info?.syllables ? [info.syllables] : [])).map((s, i) => (
                    <span key={i} className="rounded-md bg-muted px-2.5 py-1 text-lg font-medium tracking-wide">
                      {s}
                    </span>
                  ))}
                  {info?.phonicsRule && <span className="ml-1 text-sm text-muted-foreground">{info.phonicsRule}</span>}
                </div>
                {info?.explanation && <p className="text-sm text-muted-foreground">{info.explanation}</p>}
              </Section>
            )
          )}

          {sentences.length > 0 && (
            <Section title="本文中">
              <div className="flex flex-col gap-1.5">
                {sentences.map((s, i) => (
                  <button key={i} type="button" onClick={() => speak(s.en, 'sentence')} className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                    <Volume2 className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    <span className="min-w-0">
                      <span className="block">
                        <Highlighted text={s.en} word={current.word} />
                      </span>
                      <span className="block text-sm text-muted-foreground">{s.zh}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {info && aiWordId !== null && (
            <Tabs defaultValue="examples" className="gap-3" key={aiWordId}>
              <TabsList>
                <TabsTrigger value="examples">
                  <Quote />
                  例句
                </TabsTrigger>
                <TabsTrigger value="explanation">
                  <GraduationCap />
                  AI 讲解
                </TabsTrigger>
                <TabsTrigger value="materials">
                  <Clapperboard />
                  其他素材
                </TabsTrigger>
              </TabsList>
              <TabsContent value="examples">
                {(info?.examples ?? []).length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">还没有例句</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(info?.examples ?? []).map((e, i) => (
                      <button key={i} type="button" onClick={() => speak(e.sentence, 'sentence')} className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                        <Volume2 className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        <span className="min-w-0">
                          <span className="block">
                            <Highlighted text={e.sentence} word={current.word} />
                          </span>
                          <span className="block text-sm text-muted-foreground">{e.translation}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="explanation">
                <WordExplanationView wordId={aiWordId} active autoGenerate={false} />
              </TabsContent>
              <TabsContent value="materials" className="max-h-[60vh] overflow-y-auto">
                <WordMaterialsList word={current.word} wordId={current.wordId ?? undefined} />
              </TabsContent>
            </Tabs>
          )}


          <footer className="flex items-center justify-between border-t pt-4">
            <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              <ChevronLeft />
              上一个
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {index + 1} / {words.length}
            </span>
            <Button variant="ghost" size="sm" disabled={index >= words.length - 1} onClick={() => setIndex((i) => i + 1)}>
              下一个
              <ChevronRight />
            </Button>
          </footer>
        </Card>
      )}
    </div>
  );
};
