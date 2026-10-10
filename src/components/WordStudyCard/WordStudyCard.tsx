import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Clapperboard, GraduationCap, Quote, Snail, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiTeacherPanel } from '@/components/AiTeacher';
import { WordMaterialsList } from '@/components/WordMaterialsSheet/WordMaterialsSheet';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { parsePhonicsSegments } from '@/utils/phonics';
import { isPhrase, isPhrasePart, targetSpans, tokenize } from '@/utils/passage';
import type { Word } from '@/types';
import type { WordCard } from '@/types/material';

/** 单词卡上显示的学习资料（词汇本里的词与未收录词的单词卡统一成这一种） */
export interface StudyWordInfo {
  word: string;
  ipa?: string;
  meaning?: string;
  /** 词性（中文优先） */
  pos?: string;
  /** 拼读分段 */
  segments?: string[];
  syllables?: string;
  phonicsRule?: string;
  /** 拼读说明 */
  explanation?: string;
  examples: { sentence: string; translation: string }[];
  /** 词组（D45）：类型与能否拆开 */
  phrase?: { type?: string; separable: boolean };
}

/** 词组类型的显示名 */
export const PHRASE_TYPE_LABEL: Record<string, string> = {
  phrasal_verb: '短语动词',
  collocation: '固定搭配',
  idiom: '习语',
  fixed: '固定短语',
};

export const studyInfoFromWord = (w: Word): StudyWordInfo => ({
  word: w.word,
  ipa: w.ipa,
  meaning: w.meaning,
  pos: w.pos_chinese || w.part_of_speech,
  segments: parsePhonicsSegments(w.phonics_segments),
  syllables: w.syllables,
  phonicsRule: w.phonics_rule,
  explanation: w.analysis_explanation,
  examples: w.examples ?? [],
  phrase: w.kind === 'phrase' || /\s/.test(w.word.trim()) ? { type: w.phrase_type ?? undefined, separable: Boolean(w.separable) } : undefined,
});

export const studyInfoFromCard = (c: WordCard): StudyWordInfo => ({
  word: c.word,
  ipa: c.ipa || undefined,
  meaning: c.meaning || undefined,
  pos: c.posChinese || c.posAbbreviation || undefined,
  syllables: c.syllables || undefined,
  phonicsRule: c.phonicsRule || undefined,
  explanation: c.analysisExplanation || undefined,
  examples: c.examples,
  phrase: c.kind === 'phrase' || /\s/.test(c.word.trim()) ? { type: c.phraseType || undefined, separable: c.separable } : undefined,
});

/** 句子里把这个单词或词组（含变形；拆开用的按标注的写法 forms）标出来 */
export const Highlighted: React.FC<{ text: string; word: string; forms?: string[] }> = ({ text, word, forms }) => {
  const tokens = tokenize(text);
  const spans = targetSpans(tokens, [word], forms ? { [word.toLowerCase()]: forms } : {});
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === 'word' && spans.has(t.index) && (!isPhrase(word) || isPhrasePart(t.text, word))) {
          return (
            <mark key={i} className="rounded-sm bg-warning-soft px-0.5 font-semibold text-foreground">
              {t.text}
            </mark>
          );
        }
        // 词组中间的空格也一起标出，读起来是一整块
        const prev = tokens[i - 1];
        const next = tokens[i + 1];
        const part = (x: typeof prev) => x?.kind === 'word' && (!isPhrase(word) || isPhrasePart(x.text, word));
        const a = prev?.kind === 'word' && part(prev) ? spans.get(prev.index) : undefined;
        const b = next?.kind === 'word' && part(next) ? spans.get(next.index) : undefined;
        const inside = t.kind === 'other' && a !== undefined && b !== undefined && a.start === b.start;
        return inside ? (
          <mark key={i} className="bg-warning-soft">
            {t.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        );
      })}
    </>
  );
};

/** 单词卡上的一节（拼读 / 本文中 …） */
export const StudySection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/** 可以点着听的一句（英文里标出这个词 + 译文） */
export const StudySentence: React.FC<{ en: string; zh: string; word: string; forms?: string[]; onPlay: () => void }> = ({ en, zh, word, forms, onPlay }) => (
  <button type="button" onClick={onPlay} className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
    <Volume2 className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    <span className="min-w-0">
      <span className="block">
        <Highlighted text={en} word={word} forms={forms} />
      </span>
      <span className="block text-sm text-muted-foreground">{zh}</span>
    </span>
  </button>
);

export interface WordStudyCardProps {
  /** 单词（资料还没加载时也能显示） */
  word: string;
  info?: StudyWordInfo;
  /** 资料加载中 */
  loading?: boolean;
  /** 单词旁的标记（如「未收录」） */
  badge?: React.ReactNode;
  /** 右上角的操作（发音按钮之后，如编辑、⋯） */
  actions?: React.ReactNode;
  /** 拼读之前的状态（如单词卡生成进度） */
  progress?: React.ReactNode;
  /** 拼读之后、页签之前的附加内容（如「本文中」） */
  children?: React.ReactNode;
  /** 讲解 / 答疑用的 id（词汇本的词为 wordId，单词卡为负数 id）；null 时不显示页签 */
  aiWordId: number | null;
  /** 词汇本里的 id（「其他素材」按它与单词查） */
  wordId?: number;
  /** 「其他素材」里打开短文 / 片段 */
  onOpenPassage?: (passageId: number, isClip: boolean) => void;
  /** 「其他素材」里排除这一篇（在短文 / 片段里看时排除它自己） */
  excludePassageId?: number;
  /** 底部切换（上一个 / 下一个） */
  nav?: { index: number; total: number; onChange: (index: number) => void };
}

/**
 * 单词卡（词汇本、短文与视频片段的目标词共用）：单词、音标、常速 / 慢速发音与 AI 老师（右侧与卡片等高的对话面板）、词性与释义 →
 * 拼读分段与规则 → 附加内容（如本文中的句子）→ 例句 / 其他素材 → 上一个 / 下一个。
 */
export const WordStudyCard: React.FC<WordStudyCardProps> = ({ word, info, loading, badge, actions, progress, children, aiWordId, wordId, onOpenPassage, excludePassageId, nav }) => {
  const audio = useAudioPlayer();
  /** AI 老师的对话面板（换词时保持打开，老师跟着讲新的词） */
  const [teacherOpen, setTeacherOpen] = useState(false);
  const teacherAvailable = aiWordId !== null && Boolean(info);
  const showTeacher = teacherOpen && teacherAvailable;
  const speak = (text: string, style: 'word' | 'sentence', slow = false) => audio.playText(text, undefined, { style, speed: slow ? 'slow' : 'normal' }).catch(() => {});
  const display = info?.word ?? word;
  const segments = info?.segments ?? (info?.syllables ? [info.syllables] : undefined);
  const hasPhonics = Boolean(segments?.length || info?.phonicsRule || info?.explanation);

  return (
    <div className="relative">
    <Card className="gap-6 px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-3xl font-semibold tracking-tight">{display}</h2>
            {info?.ipa && <span className="text-muted-foreground">{info.ipa}</span>}
            {info?.phrase && (
              <Badge variant="secondary" className="font-normal">
                {PHRASE_TYPE_LABEL[info.phrase.type ?? ''] ?? '词组'}
              </Badge>
            )}
            {info?.phrase?.separable && (
              <Badge variant="outline" className="font-normal" title="宾语可以放在中间，如 pick it up">
                可拆开
              </Badge>
            )}
            {badge}
          </div>
          {info?.meaning && (
            <p>
              {info.pos && <span className="mr-1.5 text-muted-foreground">{info.pos}</span>}
              {info.meaning}
            </p>
          )}
        </div>
        <Button variant="outline" size="icon" aria-label="发音" onClick={() => speak(display, /\s/.test(display) ? 'sentence' : 'word')}>
          <Volume2 />
        </Button>
        <Button variant="outline" size="icon" aria-label="慢速发音" onClick={() => speak(display, /\s/.test(display) ? 'sentence' : 'word', true)}>
          <Snail />
        </Button>
        {teacherAvailable && (
          <Button
            variant={showTeacher ? 'default' : 'outline'}
            size="icon"
            aria-label="AI 老师"
            aria-pressed={showTeacher}
            title="AI 老师"
            onClick={() => setTeacherOpen((v) => !v)}
          >
            <GraduationCap />
          </Button>
        )}
        {actions}
      </header>

      {progress}
      {loading ? (
        <Skeleton className="h-24" />
      ) : (
        hasPhonics && (
          <StudySection title={info?.phrase ? '用法' : '拼读'}>
            <div className="flex flex-wrap items-center gap-1.5">
              {(segments ?? []).map((s, i) => (
                <span key={i} className="rounded-md bg-muted px-2.5 py-1 text-lg font-medium tracking-wide">
                  {s}
                </span>
              ))}
              {info?.phonicsRule && <span className="ml-1 text-sm text-muted-foreground">{info.phonicsRule}</span>}
            </div>
            {info?.explanation && <p className="text-sm text-muted-foreground">{info.explanation}</p>}
          </StudySection>
        )
      )}

      {children}

      {info && aiWordId !== null && (
        <Tabs defaultValue="examples" className="gap-3" key={aiWordId}>
          <TabsList>
            <TabsTrigger value="examples">
              <Quote />
              例句
            </TabsTrigger>
            <TabsTrigger value="materials">
              <Clapperboard />
              其他素材
            </TabsTrigger>
          </TabsList>
          <TabsContent value="examples">
            {info.examples.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">还没有例句</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {info.examples.map((e, i) => (
                  <StudySentence key={i} en={e.sentence} zh={e.translation} word={display} onPlay={() => speak(e.sentence, 'sentence')} />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="materials" className="max-h-[60vh] overflow-y-auto">
            <WordMaterialsList word={display} wordId={wordId} onOpenPassage={onOpenPassage} excludePassageId={excludePassageId} />
          </TabsContent>
        </Tabs>
      )}

      {nav && nav.total > 1 && (
        <footer className="flex items-center justify-between border-t pt-4">
          <Button variant="ghost" size="sm" disabled={nav.index === 0} onClick={() => nav.onChange(nav.index - 1)}>
            <ChevronLeft />
            上一个
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {nav.index + 1} / {nav.total}
          </span>
          <Button variant="ghost" size="sm" disabled={nav.index >= nav.total - 1} onClick={() => nav.onChange(nav.index + 1)}>
            下一个
            <ChevronRight />
          </Button>
        </footer>
      )}
    </Card>
    {showTeacher && aiWordId !== null && <AiTeacherPanel word={display} wordId={aiWordId} onClose={() => setTeacherOpen(false)} />}
    </div>
  );
};
