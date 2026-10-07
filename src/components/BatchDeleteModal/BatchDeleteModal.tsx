import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';

export interface BatchDeleteModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框回调 */
  onClose: () => void;
  /** 确认删除回调 */
  onConfirm: () => void;
  /** 要删除的单词列表 */
  words: Array<{ id: number; word: string; meaning: string }>;
  /** 删除中状态 */
  deleting?: boolean;
  /** 删除失败的原因（显示在确认框里，框保持打开可重试） */
  error?: string | null;
}

/** 删除单词确认（单个 / 批量共用，shadcn AlertDialog）：列出前 10 个，删除后不可恢复 */
export const BatchDeleteModal: React.FC<BatchDeleteModalProps> = ({ isOpen, onClose, onConfirm, words, deleting = false, error }) => {
  const single = words.length === 1;
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && !deleting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{single ? `删除单词“${words[0]?.word}”？` : `删除 ${words.length} 个单词？`}</AlertDialogTitle>
          <AlertDialogDescription>删除后无法恢复。如果学习计划里用到了这些单词，也会从计划中移除，相关的练习记录和记忆进度一并删除。</AlertDialogDescription>
        </AlertDialogHeader>
        {!single && words.length > 0 && (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-sm">
            {words.slice(0, 10).map((w) => (
              <li key={w.id} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="font-medium">{w.word}</span>
                <span className="truncate text-muted-foreground">{w.meaning}</span>
              </li>
            ))}
            {words.length > 10 && <li className="px-3 py-1.5 text-muted-foreground">还有 {words.length - 10} 个单词…</li>}
          </ul>
        )}
        {error && <InlineError title="无法删除单词">{error}</InlineError>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" />}
            {single ? '删除单词' : `删除 ${words.length} 个单词`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
