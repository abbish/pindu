import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { JobPanel, jobErrorText } from '@/components/Jobs';
import { StudySection, StudySentence, WordStudyCard, studyInfoFromCard, studyInfoFromWord } from '@/components/WordStudyCard';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useJob, useOnJobFinished } from '@/hooks/useJobs';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { cardWordId } from '@/services/wordExplanationService';
import { textUses } from '@/utils/passage';
import { isJobActive } from '@/types/job';
import type { Word } from '@/types';
import type { WordCard } from '@/types/material';
import type { Passage, PassageTargetWord } from '@/types/passage';

export interface TargetWordsPanelProps {
  passage: Passage;
  /** 列表下方的附加内容（如把未收录词加入词汇本） */
  footer?: React.ReactNode;
  /** 打开时定位到这个词（从原文侧栏点进来） */
  focusWord?: string | null;
  /** 「其他素材」里打开短文 / 片段 */
  onOpenPassage?: (passageId: number, isClip: boolean) => void;
}

/**
 * 短文详情「目标词」页签：左边目标词列表（指定单词 / AI 选词或重点词，未收录的标出），右边单词卡（WordStudyCard，
 * 与词汇本共用）外加「本文中」的句子；未收录的词用单词卡（缺的自动补生成）。↑ ↓ 或上一个 / 下一个切换。
 */
/** 本次打开应用期间已请求过补生成单词卡的「短文 + 那组词」（页签切走再回来不重复提交） */
const requestedCards = new Set<string>();

export const TargetWordsPanel: React.FC<TargetWordsPanelProps> = ({ passage, footer, focusWord, onOpenPassage }) => {
  const [details, setDetails] = useState<Map<string, Word> | null>(null);
  /** 不在词汇本的目标词的单词卡（小写单词 → 卡片） */
  const [cards, setCards] = useState<Map<string, WordCard> | null>(null);
  /** 补生成单词卡的后台任务 */
  const [cardJobId, setCardJobId] = useState<string | null>(null);
  const cardJob = useJob(cardJobId);
  const [index, setIndex] = useState(0);
  const audio = useAudioPlayer();
  const imported = passage.origin !== 'generated';

  /** 补生成单词卡（已有在跑的同类任务时后端返回它） */
  const startCards = async () => {
    setCardError(null);
    const r = await passageService.startWordCards(passage.id);
    if (r.success) setCardJobId(r.data);
    else setCardError(r.error);
  };
  /** 补生成失败的原因 */
  const [cardError, setCardError] = useState<string | null>(null);
  useEffect(() => {
    if (cardJob?.status === 'failed') setCardError(jobErrorText(cardJob));
  }, [cardJob]);

  const loadCards = () =>
    passageService.getWordCards(passage.id).then((r) => setCards(new Map((r.success ? r.data : []).map((c) => [c.word.toLowerCase(), c]))));
  useEffect(() => {
    passageService.getPassageWords(passage.id).then((r) => setDetails(new Map((r.success ? r.data : []).map((w) => [w.word.toLowerCase(), w]))));
    void loadCards();
    // 未收录的词还没有单词卡：自动补生成（已有在跑的同类任务时后端返回它）。同一组词只请求一次
    const unrecorded = passage.targetWords.filter((w) => w.wordId === null).map((w) => w.word.toLowerCase());
    const key = `${passage.id}:${unrecorded.join(',')}`;
    if (unrecorded.length > 0 && !requestedCards.has(key)) {
      requestedCards.add(key);
      void startCards();
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
  const info = word ? studyInfoFromWord(word) : card ? studyInfoFromCard(card) : undefined;
  /** 讲解 / 答疑用的 id：词汇本的词用 wordId，未收录的用单词卡 */
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

  const sentences = useMemo(() => (current ? passage.sentences.filter((s) => textUses(s.en, current.word)) : []), [passage.sentences, current]);

  if (words.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">这篇短文没有目标词</p>;

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
        <WordStudyCard
          word={current.word}
          info={info ?? (current.meaning ? { word: current.word, meaning: current.meaning, examples: [] } : undefined)}
          loading={details === null || cards === null}
          badge={
            current.wordId === null && (
              <Badge variant="outline" className="border-warning/40 font-normal text-warning">
                未收录
              </Badge>
            )
          }
          progress={
            generatingCard && cardJob ? (
              <JobPanel job={cardJob} title="AI 正在生成单词卡" />
            ) : current.wordId === null && !card && cardError ? (
              <InlineError
                title="无法生成单词卡"
                actions={
                  <Button variant="outline" size="sm" className="h-7" onClick={() => void startCards()}>
                    再试一次
                  </Button>
                }
              >
                {cardError}
              </InlineError>
            ) : undefined
          }
          aiWordId={info ? aiWordId : null}
          wordId={current.wordId ?? undefined}
          onOpenPassage={onOpenPassage}
          excludePassageId={passage.id}
          nav={{ index, total: words.length, onChange: setIndex }}
        >
          {sentences.length > 0 && (
            <StudySection title="本文中">
              <div className="flex flex-col gap-1.5">
                {sentences.map((s, i) => (
                  <StudySentence key={i} en={s.en} zh={s.zh} word={current.word} onPlay={() => audio.playText(s.en, undefined, { style: 'sentence' }).catch(() => {})} />
                ))}
              </div>
            </StudySection>
          )}
        </WordStudyCard>
      )}
    </div>
  );
};
