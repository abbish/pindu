import React from 'react';
import { Snail, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Word } from '@/types';

export interface TargetWordProps {
  /** 原文中的写法（可能是变形，如 tickets） */
  text: string;
  /** 对应的目标词 */
  target: string;
  /** 正在读到这个词 */
  active: boolean;
  /** 单词资料（手动输入的词没有） */
  word?: Word;
  /** 读单词：slow 为慢速 */
  onSpeak: (word: string, slow: boolean) => void;
}

/**
 * 正文里的目标词：点击弹出单词卡片（音标、释义、音节与拼读、讲解、例句），可以常速 / 慢速听单词。
 */
export const TargetWord: React.FC<TargetWordProps> = ({ text, target, active, word, onSpeak }) => {
  const example = word?.examples?.[0];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-block rounded-sm font-semibold text-warning underline decoration-overdue decoration-wavy decoration-2 underline-offset-[5px] outline-none transition-[color,background-color,transform] duration-150 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
            active && 'relative z-10 inline-block -mx-0.5 scale-[1.15] rounded-md bg-primary px-0.5 text-primary-foreground shadow-sm no-underline ring-2 ring-warning ring-offset-1 ring-offset-background hover:bg-primary'
          )}
          aria-label={`查看 ${target}`}
        >
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 select-text">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold">{word?.word ?? target}</div>
            {word?.ipa && <div className="text-sm text-muted-foreground">{word.ipa}</div>}
          </div>
          <Button variant="outline" size="icon" className="size-8" aria-label="朗读单词" onClick={() => onSpeak(word?.word ?? target, false)}>
            <Volume2 />
          </Button>
          <Button variant="outline" size="icon" className="size-8" aria-label="慢速朗读单词" onClick={() => onSpeak(word?.word ?? target, true)}>
            <Snail />
          </Button>
        </div>
        {word ? (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <div>
              {(word.pos_chinese || word.part_of_speech) && <span className="mr-1.5 text-muted-foreground">{word.pos_chinese || word.part_of_speech}</span>}
              {word.meaning}
            </div>
            {(word.syllables || word.phonics_rule) && (
              <div className="flex flex-wrap items-center gap-2">
                {word.syllables && <span className="rounded-md bg-muted px-2 py-0.5 font-medium tracking-wide">{word.syllables}</span>}
                {word.phonics_rule && <span className="text-xs text-muted-foreground">{word.phonics_rule}</span>}
              </div>
            )}
            {word.analysis_explanation && <p className="text-muted-foreground">{word.analysis_explanation}</p>}
            {example && (
              <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
                <div>{example.sentence}</div>
                <div className="text-xs text-muted-foreground">{example.translation}</div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">这是手动输入的词，没有单词本里的拼读资料。</p>
        )}
      </PopoverContent>
    </Popover>
  );
};
