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
  /** 材料来源（新建词汇本时的默认名与场景） */
  sourceLabel: string | null;
  /** 加词后刷新短文（目标词补上 wordId，点词能看完整卡片） */
  onAdded: () => void;
  /** 打开词汇本 */
  onOpenBook?: (bookId: number) => void;
}

/**
 * 导入材料的「未收录词」：AI 标出的重点词里还不在任何词汇本的，勾选后加进现有词汇本或新建一本（passage-import B5）。
 * 后端一步完成拼读分析与例句；没有未收录词时不显示。
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
      setError({ title: '无法新建词汇本', message: book.error });
      return;
    }
    const result = await passageService.addWordsToBook({ passageId, bookId: book.bookId, words: [...picked] });
    setSaving(false);
    if (!result.success) {
      setError({ title: '无法加入词汇本', message: book.created ? `已新建「${book.title}」，可重试加入。${result.error}` : result.error });
      if (book.created) setTarget({ kind: 'existing', bookId: book.bookId });
      return;
    }
    toast.showToast({
      type: 'success',
      title: book.created ? `已新建「${book.title}」并加入 ${picked.size} 词` : `已将 ${picked.size} 词加入「${book.title}」`,
      message: result.data.length < picked.size ? `${picked.size - result.data.length} 个已在该词汇本中` : undefined,
      action: onOpenBook ? { label: '打开词汇本', onClick: () => onOpenBook(book.bookId) } : undefined,
    });
    setWords((prev) => prev?.filter((w) => !picked.has(w.word)) ?? null);
    setPicked(new Set());
    setTarget({ kind: 'existing', bookId: book.bookId });
    onAdded();
  };

  return (
    <Card className="gap-3 px-5 py-4">
      <h2 className="text-sm font-semibold">未收录词</h2>
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
        {saving ? '正在加入…' : `${target?.kind === 'new' ? '新建词汇本并加入' : '加入词汇本'}${picked.size > 0 ? `（${picked.size} 词）` : ''}`}
      </Button>
      {error && <InlineError title={error.title}>{error.message}</InlineError>}
    </Card>
  );
};
