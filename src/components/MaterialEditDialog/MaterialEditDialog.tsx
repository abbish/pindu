import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { InlineError } from '@/components/InlineError';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { passageService } from '@/services/passageService';
import { tagService } from '@/services/tagService';
import { videoService } from '@/services/videoService';
import type { Tag } from '@/types/material';
import { LEVEL_LABEL } from '@/utils/passage';

const TITLE_MAX = 100;
const SCENE_MAX = 200;

/** 要编辑的素材：短文 / 场景片段（标题、难度、场景描述、标签）或原始视频（标题、标签） */
export type MaterialEditTarget =
  /** scene 为 undefined（列表里没有）时打开后读一次短文补上 */
  | { kind: 'passage'; id: number; title: string; level: string; scene?: string | null; tags: Tag[]; isClip?: boolean }
  | { kind: 'video'; id: number; title: string; tags: Tag[] };

export interface MaterialEditDialogProps {
  /** 为空时关闭 */
  target: MaterialEditTarget | null;
  onClose: () => void;
  /** 保存成功（调用方刷新） */
  onSaved: () => void;
}

/**
 * 素材的「编辑…」弹窗：卡片 ⋯ / 右键与详情页 ⋯ 共用这一个入口（与词汇本的编辑一致）。
 * 改基本信息与标签；标签用与词汇本相同的选择器，可新建。
 */
export const MaterialEditDialog: React.FC<MaterialEditDialogProps> = ({ target, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('a1');
  const [scene, setScene] = useState('');
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [allTags, setAllTags] = useState<Tag[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setTitle(target.title);
    setTagIds(target.tags.map((t) => t.id));
    if (target.kind === 'passage') {
      setLevel(target.level);
      setScene(target.scene ?? '');
      if (target.scene === undefined) {
        passageService.getPassage(target.id).then((r) => r.success && setScene(r.data.scene ?? ''));
      }
    }
    setError(null);
    // 每次打开重新取标签（别处可能新建、改名过）
    setAllTags(null);
    tagService.getTags().then((r) => setAllTags(r.success ? r.data : [...target.tags]));
  }, [target]);

  const createTag = async (name: string): Promise<Tag | null> => {
    const result = await tagService.createTag(name);
    if (!result.success) {
      setError(result.error);
      return null;
    }
    setAllTags((all) => (all && !all.some((t) => t.id === result.data.id) ? [...all, result.data] : all));
    return result.data;
  };

  const save = async () => {
    if (!target) return;
    setSaving(true);
    setError(null);
    const info =
      target.kind === 'passage'
        ? await passageService.updateInfo(target.id, { title, level, scene })
        : await videoService.rename(target.id, title);
    if (!info.success) {
      setSaving(false);
      setError(info.error);
      return;
    }
    const before = target.tags.map((t) => t.id);
    const changed = before.length !== tagIds.length || before.some((id) => !tagIds.includes(id));
    if (changed) {
      const tags = await tagService.setMaterialTags(target.kind, target.id, tagIds);
      if (!tags.success) {
        setSaving(false);
        setError(tags.error);
        return;
      }
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const heading = target?.kind === 'video' ? '编辑视频' : target?.isClip ? '编辑场景片段' : '编辑短文';

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="me-title">标题</Label>
            <Input id="me-title" value={title} maxLength={TITLE_MAX} disabled={saving} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          {target?.kind === 'passage' && (
            <>
              <div className="flex items-center justify-between gap-4">
                <Label>难度</Label>
                <ToggleGroup type="single" value={level} onValueChange={(v) => v && setLevel(v)} className="rounded-lg bg-muted p-0.5" aria-label="难度" disabled={saving}>
                  {Object.entries(LEVEL_LABEL).map(([value, label]) => (
                    <ToggleGroupItem key={value} value={value} className="h-7 rounded-md px-3 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm">
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="me-scene">场景描述</Label>
                <Textarea id="me-scene" value={scene} maxLength={SCENE_MAX} rows={3} disabled={saving} onChange={(e) => setScene(e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="me-tags">标签</Label>
            {allTags ? <TagPicker id="me-tags" tags={allTags} value={tagIds} onChange={setTagIds} onCreate={createTag} /> : <Skeleton className="h-9 w-full" />}
          </div>
          {error && <InlineError title="无法保存">{error}</InlineError>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
