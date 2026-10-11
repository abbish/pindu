import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { AiWorking } from '@/components/AiWorking';
import { InlineError } from '@/components/InlineError';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { loadMaterialSettings } from '@/hooks/useMaterialSettings';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import type { Passage, TargetWordPick } from '@/types/passage';

/** 没读到「设置 → 素材」时挑几个 */
const DEFAULT_COUNT = 10;

interface Row extends TargetWordPick {
  /** 现在就是目标词 */
  current: boolean;
  /** AI 这次建议的 */
  suggested: boolean;
}

export interface RepickTargetWordsDialogProps {
  passage: Passage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存后的短文 */
  onSaved: (passage: Passage) => void;
}

/**
 * 重新挑选目标词：打开即请 AI 从原文里挑一组建议（个数按「设置 → 素材 → AI 选词数量」），
 * 和现在的目标词合成一张勾选表——建议的默认勾上、现在有但没被建议的默认不勾；确认后整体替换。
 */
export const RepickTargetWordsDialog: React.FC<RepickTargetWordsDialogProps> = ({ passage, open, onOpenChange, onSaved }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 最近一次挑选的编号：关掉或再挑一次后，之前的结果不再写回 */
  const request = useRef(0);

  const suggest = useCallback(async () => {
    const id = ++request.current;
    setRows(null);
    setError(null);
    const settings = await loadMaterialSettings();
    const result = await passageService.suggestTargetWords(passage.id, settings?.passagePickCount ?? DEFAULT_COUNT);
    if (id !== request.current) return;
    if (!result.success) {
      setError(result.error);
      return;
    }
    const key = (w: string) => w.toLowerCase();
    const suggestedKeys = new Set(result.data.map((s) => key(s.word)));
    const currentKeys = new Set(passage.targetWords.map((t) => key(t.word)));
    const next: Row[] = [
      ...result.data.map((s) => ({ word: s.word, forms: s.forms, meaning: s.meaning, suggested: true, current: currentKeys.has(key(s.word)) })),
      ...passage.targetWords
        .filter((t) => !suggestedKeys.has(key(t.word)))
        .map((t) => ({ word: t.word, forms: t.forms, meaning: t.meaning, suggested: false, current: true })),
    ];
    setRows(next);
    setChecked(new Set(result.data.map((s) => key(s.word))));
  }, [passage.id, passage.targetWords]);

  useEffect(() => {
    if (open) void suggest();
    else request.current++;
    // 只在打开时挑一次；「再挑一次」手动触发
  }, [open]);

  const toggle = (word: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const k = word.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    setError(null);
    const words = rows.filter((r) => checked.has(r.word.toLowerCase())).map(({ word, forms, meaning }) => ({ word, forms, meaning }));
    const result = await passageService.setTargetWords(passage.id, words);
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>重新挑选目标词</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          {error && <InlineError title={rows ? '无法保存目标词' : '没能挑出目标词'}>{error}</InlineError>}
          {!rows && !error && <AiWorking title="正在挑选目标词" />}
          {rows && (
            <ul className="divide-y rounded-lg border">
              {rows.map((r) => (
                <li key={r.word}>
                  <label className={cn('flex cursor-default items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50', saving && 'opacity-60')}>
                    <Checkbox checked={checked.has(r.word.toLowerCase())} disabled={saving} onCheckedChange={() => toggle(r.word)} aria-label={`选择 ${r.word}`} />
                    <span className="font-medium">{r.word}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.meaning}</span>
                    {r.current && (
                      <Badge variant="outline" className="shrink-0 font-normal">
                        现有
                      </Badge>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <Button variant="ghost" onClick={() => void suggest()} disabled={saving || (!rows && !error)}>
            <RotateCw />
            再挑一次
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={save} disabled={saving || !rows || checked.size === 0}>
              {saving && <Loader2 className="animate-spin" />}
              换成选中的 {checked.size} 个
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
