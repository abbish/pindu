import { useCallback, useEffect, useState } from 'react';
import { useOnJobFinished } from '@/hooks/useJobs';
import { passageService } from '@/services/passageService';
import type { Word } from '@/types';
import type { WordCard } from '@/types/material';
import type { Passage } from '@/types/passage';

/** 单词卡 → 单词资料的形状（点词小卡片按同一套字段显示） */
const fromCard = (c: WordCard): Word => ({
  id: 0,
  word: c.word,
  meaning: c.meaning,
  ipa: c.ipa || undefined,
  syllables: c.syllables || undefined,
  part_of_speech: c.posAbbreviation || undefined,
  pos_chinese: c.posChinese || undefined,
  phonics_rule: c.phonicsRule || undefined,
  analysis_explanation: c.analysisExplanation || undefined,
  examples: c.examples,
  created_at: '',
  updated_at: '',
});

/**
 * 一篇短文（含视频片段）目标词的学习资料：词汇本里的词用词汇本的资料，未收录的用单词卡（063）。
 * 原文与台词里点词弹出的小卡片共用；单词卡生成完（word_cards 任务结束）自动刷新。
 */
export function useTargetWordInfo(passage: Pick<Passage, 'id' | 'targetWords'>): Map<string, Word> {
  const [info, setInfo] = useState<Map<string, Word>>(new Map());
  const load = useCallback(async () => {
    const [words, cards] = await Promise.all([passageService.getPassageWords(passage.id), passageService.getWordCards(passage.id)]);
    const map = new Map<string, Word>();
    for (const c of cards.success ? cards.data : []) map.set(c.word.toLowerCase(), fromCard(c));
    for (const w of words.success ? words.data : []) map.set(w.word.toLowerCase(), w);
    setInfo(map);
  }, [passage.id]);
  useEffect(() => {
    void load();
  }, [load, passage.targetWords]);
  useOnJobFinished((job) => {
    if (job.kind === 'word_cards' && (job.link?.params as { passageId?: number } | null)?.passageId === passage.id) void load();
  });
  return info;
}
