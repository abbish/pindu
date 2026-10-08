import React, { useEffect, useMemo, useState } from 'react';
import { BookPlus, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineError } from '@/components/InlineError';
import { BookTargetPicker, defaultBookTitle, isBookTargetReady, resolveBookTarget, type BookTarget } from '@/components/BookTargetPicker';
import { useToast } from '@/components/Toast/ToastContainer';
import { passageService } from '@/services/passageService';

export interface CollectWordsCardProps {
  /** 这次导入成功的短文 */
  passages: { passageId: number; title: string }[];
  sourceLabel: string | null;
  onOpenBook: (bookId: number) => void;
}

interface CollectedWord {
  word: string;
  meaning: string | null;
  /** 出现在哪几篇（按导入顺序） */
  passageIds: number[];
}

/**
 * 导入完成后「整理成单词本」：把这批短文里还不在单词本的重点词去重汇总，勾选后新建一本（或加进现有的）。
 * 逐篇调用 add_passage_words_to_book：同一个词在后面的篇里直接关联、不重复分析，并补上每篇短文目标词的 wordId。
 */
export const CollectWordsCard: React.FC<CollectWordsCardProps> = ({ passages, sourceLabel, onOpenBook }) => {
  const toast = useToast();
  const [words, setWords] = useState<CollectedWord[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<BookTarget | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ bookId: number; title: string; count: number } | null>(null);
  const passageKey = passages.map((p) => p.passageId).join(',');

  useEffect(() => {
    let stale = false;
    const ids = passageKey ? passageKey.split(',').map(Number) : [];
    Promise.all(ids.map((id) => passageService.getNewWords(id).then((r) => ({ id, list: r.success ? r.data : [] })))).then((all) => {
      if (stale) return;
      const merged = new Map<string, CollectedWord>();
      for (const { id, list } of all) {
        for (const w of list) {
          const key = w.word.toLowerCase();
          const hit = merged.get(key);
          if (hit) {
            hit.passageIds.push(id);
            hit.meaning ??= w.meaning;
          } else merged.set(key, { word: w.word, meaning: w.meaning, passageIds: [id] });
        }
      }
      const list = [...merged.values()];
      setWords(list);
      setPicked(new Set(list.map((w) => w.word)));
    });
    return () => {
      stale = true;
    };
  }, [passageKey]);

  const groups = useMemo(() => {
    // 每篇要加的词：只在它第一次出现的那篇里新建，后面的篇再关联一次（补 wordId）
    const byPassage = new Map<number, string[]>();
    for (const w of words ?? []) {
      if (!picked.has(w.word)) continue;
      for (const id of w.passageIds) byPassage.set(id, [...(byPassage.get(id) ?? []), w.word]);
    }
    return passages.map((p) => ({ passageId: p.passageId, words: byPassage.get(p.passageId) ?? [] })).filter((g) => g.words.length > 0);
  }, [words, picked, passages]);

  if (words === null) {
    return (
      <Card className="flex-row items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在汇总生词…
      </Card>
    );
  }
  if (words.length === 0 && !result) return null;

  if (result) {
    return (
      <Card className="flex-row items-center gap-3 px-5 py-4">
        <Check className="size-5 shrink-0 text-success" />
        <div className="min-w-0 flex-1 text-sm">
          已整理到「{result.title}」：{result.count} 个词，音标、拼读和例句已补全
        </div>
        <Button size="sm" variant="outline" onClick={() => onOpenBook(result.bookId)}>
          打开单词本
        </Button>
      </Card>
    );
  }

  const running = progress !== null;
  const toggle = (word: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });

  const collect = async () => {
    if (!isBookTargetReady(target) || groups.length === 0) return;
    setError(null);
    setProgress({ done: 0, total: groups.length });
    const book = await resolveBookTarget(target, sourceLabel);
    if ('error' in book) {
      setProgress(null);
      setError(book.error);
      return;
    }
    // 新建成功后，失败重试时加进同一本，不再新建
    setTarget({ kind: 'existing', bookId: book.bookId });
    const failures: string[] = [];
    for (const [i, g] of groups.entries()) {
      const r = await passageService.addWordsToBook({ passageId: g.passageId, bookId: book.bookId, words: g.words });
      if (!r.success) failures.push(`${passages.find((p) => p.passageId === g.passageId)?.title ?? '一篇短文'}：${r.error}`);
      setProgress({ done: i + 1, total: groups.length });
    }
    setProgress(null);
    if (failures.length > 0) {
      setError(failures.join('；'));
      return;
    }
    const count = picked.size;
    setResult({ bookId: book.bookId, title: book.title, count });
    toast.showToast({
      type: 'success',
      title: book.created ? `已新建「${book.title}」，整理了 ${count} 个词` : `已把 ${count} 个词加入「${book.title}」`,
      action: { label: '打开单词本', onClick: () => onOpenBook(book.bookId) },
    });
  };

  return (
    <Card className="gap-4 px-5 py-4">
      <div className="flex items-start gap-3">
        <BookPlus className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">生词整理成单词本</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{words.length} 个词还不在单词本里</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {words.map((w) => (
          <label
            key={w.word}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-accent/40"
            title={w.meaning ?? undefined}
          >
            <Checkbox checked={picked.has(w.word)} onCheckedChange={() => toggle(w.word)} className="size-3.5" disabled={running} />
            <span className="font-medium">{w.word}</span>
            {w.meaning && <span className="max-w-40 truncate text-xs text-muted-foreground">{w.meaning}</span>}
          </label>
        ))}
      </div>
      <div className="flex items-start gap-3">
        <div className="w-72">
          <BookTargetPicker value={target} onChange={setTarget} defaultTitle={defaultBookTitle(sourceLabel)} preferNew disabled={running} />
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setPicked(picked.size === words.length ? new Set() : new Set(words.map((w) => w.word)))} disabled={running}>
          {picked.size === words.length ? '全不选' : '全选'}
        </Button>
        <Button onClick={collect} disabled={running || !isBookTargetReady(target) || picked.size === 0}>
          {running ? <Loader2 className="animate-spin" /> : <BookPlus />}
          {running
            ? `正在整理第 ${Math.min(progress.done + 1, progress.total)} / ${progress.total} 篇…`
            : `${target?.kind === 'new' ? '新建单词本' : '加入单词本'}（${picked.size} 个词）`}
        </Button>
      </div>
      {error && <InlineError title="有些词没有整理进去">{error}</InlineError>}
    </Card>
  );
};
