import React, { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { BookTargetPicker, defaultBookTitle, isBookTargetReady, resolveBookTarget, type BookTarget } from '@/components/BookTargetPicker';
import { useToast } from '@/components/Toast/ToastContainer';
import { InlineError } from '@/components/InlineError';
import { passageService } from '@/services/passageService';
import type { PassageNewWord } from '@/types/passage';

export interface NewWordsCardProps {
  passageId: number;
  /** 材料来源（新建单词本时的默认名与场景） */
  sourceLabel: string | null;
  /** 加词后刷新短文（目标词补上 wordId，点词能看完整卡片） */
  onAdded: () => void;
  /** 打开单词本 */
  onOpenBook?: (bookId: number) => void;
}

/**
 * 导入材料的「生词」：AI 标出的重点词里还不在任何单词本的，勾选后加进现有单词本或新建一本（passage-import B5）。
 * 后端一步完成拼读分析与例句；没有生词时不显示。
 */
export const NewWordsCard: React.FC<NewWordsCardProps> = ({ passageId, sourceLabel, onAdded, onOpenBook }) => {
  const toast = useToast();
  const [words, setWords] = useState<PassageNewWord[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<BookTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    let stale = false;
    passageService.getNewWords(passageId).then((result) => {
      if (stale) return;
      const list = result.success ? result.data : [];
      setWords(list);
      setPicked(new Set(list.map((w) => w.word)));
    });
    return () => {
      stale = true;
    };
  }, [passageId]);

  if (!words || words.length === 0) return null;

  const toggle = (word: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });

  const add = async () => {
    if (!isBookTargetReady(target) || picked.size === 0) return;
    setSaving(true);
    setError(null);
    const book = await resolveBookTarget(target, sourceLabel);
    if ('error' in book) {
      setSaving(false);
      setError({ title: '无法新建单词本', message: book.error });
      return;
    }
    const result = await passageService.addWordsToBook({ passageId, bookId: book.bookId, words: [...picked] });
    setSaving(false);
    if (!result.success) {
      setError({ title: '无法加入单词本', message: book.created ? `已新建「${book.title}」，可以直接重试加入。${result.error}` : result.error });
      if (book.created) setTarget({ kind: 'existing', bookId: book.bookId });
      return;
    }
    toast.showToast({
      type: 'success',
      title: book.created ? `已新建「${book.title}」，加入 ${picked.size} 个词` : `已把 ${picked.size} 个词加入「${book.title}」`,
      message: result.data.length < picked.size ? `其中 ${picked.size - result.data.length} 个本里已有，直接关联` : undefined,
      action: onOpenBook ? { label: '打开单词本', onClick: () => onOpenBook(book.bookId) } : undefined,
    });
    setWords((prev) => prev?.filter((w) => !picked.has(w.word)) ?? null);
    setPicked(new Set());
    setTarget({ kind: 'existing', bookId: book.bookId });
    onAdded();
  };

  return (
    <Card className="gap-3 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold">材料里的生词</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">AI 标出的重点词里还不在单词本的，加进单词本（或新建一本）后可以按计划学习</p>
      </div>
      <ul className="max-h-60 space-y-0.5 overflow-y-auto">
        {words.map((w) => (
          <li key={w.word}>
            <label className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
              <Checkbox checked={picked.has(w.word)} onCheckedChange={() => toggle(w.word)} className="mt-0.5" disabled={saving} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{w.word}</span>
                {w.meaning && <span className="ml-1.5 text-xs text-muted-foreground">{w.meaning}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <BookTargetPicker value={target} onChange={setTarget} defaultTitle={defaultBookTitle(sourceLabel)} disabled={saving} />
      <Button size="sm" onClick={add} disabled={saving || !isBookTargetReady(target) || picked.size === 0}>
        {saving ? <Loader2 className="animate-spin" /> : <Plus />}
        {saving ? '正在加入…' : `${target?.kind === 'new' ? '新建并加入' : '加入'}${picked.size > 0 ? ` ${picked.size} 个词` : ''}`}
      </Button>
      {saving && <p className="text-xs text-muted-foreground">正在补全音标、拼读和例句，大约需要十几秒到一分钟</p>}
      {error && <InlineError title={error.title}>{error.message}</InlineError>}
    </Card>
  );
};
