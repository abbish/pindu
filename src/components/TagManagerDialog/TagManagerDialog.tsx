import React, { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/InlineError';
import { useToast } from '@/components/Toast/ToastContainer';
import { tagService } from '@/services/tagService';
import type { TagUsage } from '@/types/material';

export interface TagManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 有改动（改名 / 合并 / 删除）后调用，筛选与列表据此刷新 */
  onChanged?: () => void;
}

/** 「词汇本 3 · 短文 5 · 视频 1」 */
const usageText = (t: TagUsage) =>
  [t.wordBooks && `词汇本 ${t.wordBooks}`, t.passages && `短文 ${t.passages}`, t.clips && `片段 ${t.clips}`, t.videos && `视频 ${t.videos}`].filter(Boolean).join(' · ') ||
  '没有素材';

/**
 * 管理标签：所有素材共用的标签列表（各类素材数量），改名（改成已有的名字即合并）、删除（素材不受影响）。
 */
export const TagManagerDialog: React.FC<TagManagerDialogProps> = ({ open, onOpenChange, onChanged }) => {
  const toast = useToast();
  const [tags, setTags] = useState<TagUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<TagUsage | null>(null);

  const load = async () => {
    const r = await tagService.getTags();
    if (r.success) {
      setTags(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  useEffect(() => {
    if (open) {
      setTags(null);
      setEditing(null);
      void load();
    }
  }, [open]);

  const rename = async () => {
    if (!editing) return;
    const before = tags?.find((t) => t.id === editing.id);
    setBusy(true);
    const r = await tagService.renameTag(editing.id, editing.name);
    setBusy(false);
    if (!r.success) {
      toast.showError('无法改名', r.error);
      return;
    }
    if (r.data.id !== editing.id) toast.showSuccess(`已合并到「${r.data.name}」`);
    else if (before?.name !== r.data.name) toast.showSuccess('已改名');
    setEditing(null);
    await load();
    onChanged?.();
  };

  const remove = async () => {
    if (!deleting) return;
    const r = await tagService.deleteTag(deleting.id);
    setDeleting(null);
    if (!r.success) {
      toast.showError('无法删除标签', r.error);
      return;
    }
    await load();
    onChanged?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>管理标签</DialogTitle>
          </DialogHeader>
          {error ? (
            <InlineError title="无法加载标签">{error}</InlineError>
          ) : tags === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载中…
            </div>
          ) : tags.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有标签</p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-lg border">
              {tags.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  {editing?.id === t.id ? (
                    <>
                      <Input
                        value={editing.name}
                        maxLength={10}
                        autoFocus
                        className="h-8 flex-1"
                        onChange={(e) => setEditing({ id: t.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        aria-label="标签名称"
                      />
                      <Button size="icon" variant="ghost" className="size-8" onClick={rename} disabled={busy || !editing.name.trim()} aria-label="保存">
                        {busy ? <Loader2 className="animate-spin" /> : <Check />}
                      </Button>
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(null)} aria-label="取消">
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {t.name}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">{usageText(t)}</div>
                      </div>
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing({ id: t.id, name: t.name })} aria-label={`改名「${t.name}」`}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDeleting(t)} aria-label={`删除「${t.name}」`}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除标签「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>素材不会删除，只是不再带这个标签。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
