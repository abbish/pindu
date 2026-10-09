import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { WordBookIconPicker } from '@/components/WordBookIconPicker/WordBookIconPicker';
import { useToast } from '@/components/Toast/ToastContainer';
import { WORD_BOOK_ICONS, normalizeBookColor } from '@/components/WordBookIcon/WordBookIcon';
import { wordBookService } from '@/services/wordbookService';
import type { WordBook } from '@/types';
import type { Tag } from '@/types/material';
import { tagService } from '@/services/tagService';
import { InlineError } from '@/components/InlineError';

export interface WordBookFormDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭（取消或保存成功后） */
  onClose: () => void;
  /** 编辑的单词本；不传为新建 */
  wordBook?: WordBook | null;
  /** 保存成功：新建时为新单词本 ID，编辑时为原 ID */
  onSaved: (id: number) => void;
}

interface FormValues {
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  tagIds: number[];
}

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;

const initialValues = (book?: WordBook | null): FormValues => ({
  title: book?.title ?? '',
  description: book?.description ?? '',
  icon: book?.icon && WORD_BOOK_ICONS.some((i) => i.value === book.icon) ? book.icon : 'bookmark',
  iconColor: normalizeBookColor(book?.icon_color),
  tagIds: book?.tags.map((t) => t.id) ?? [],
});

/** 与后端 services/wordbook.rs 的 validate_title / validate_description 同一规则 */
function validate(values: FormValues): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  const title = values.title.trim();
  if (!title) errors.title = '请填写单词本名称';
  else if ([...title].length > TITLE_MAX) errors.title = `名称不能超过 ${TITLE_MAX} 个字`;
  if ([...values.description].length > DESCRIPTION_MAX) errors.description = `描述不能超过 ${DESCRIPTION_MAX} 个字`;
  return errors;
}

/**
 * 新建 / 编辑单词本（同一个表单、同一套校验）：名称、图标与颜色、标签、描述。
 * 新建只建空单词本，单词在详情页里添加（先建对象，再填内容）。保存失败时弹窗保持打开并显示原因。
 */
export const WordBookFormDialog: React.FC<WordBookFormDialogProps> = ({ isOpen, onClose, wordBook, onSaved }) => {
  const editing = Boolean(wordBook);
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(() => initialValues(wordBook));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allTags, setTags] = useState<Tag[] | null>(null);
  const [tagsFailed, setTagsFailed] = useState(false);

  // 每次打开按当前单词本回填（取消后再打开不残留未保存的修改）
  useEffect(() => {
    if (!isOpen) return;
    setValues(initialValues(wordBook));
    setErrors({});
    setSubmitError(null);
  }, [isOpen, wordBook]);

  useEffect(() => {
    if (!isOpen || allTags) return;
    tagService.getTags().then((result) => {
      if (result.success) setTags(result.data);
      else setTagsFailed(true);
    });
  }, [isOpen, allTags]);

  /** 新建标签后加入列表；失败时提示原因 */
  const createTag = async (name: string): Promise<Tag | null> => {
    const result = await tagService.createTag(name);
    if (!result.success) {
      toast.showError('无法新建标签', result.error);
      return null;
    }
    setTags((prev) => (prev && !prev.some((t) => t.id === result.data.id) ? [...prev, result.data] : prev));
    return result.data;
  };

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    setSubmitError(null);
    const payload = {
      title: values.title.trim(),
      description: values.description.trim(),
      icon: values.icon,
      icon_color: values.iconColor,
      tag_ids: values.tagIds,
    };
    const result = wordBook
      ? await wordBookService.updateWordBook(wordBook.id, payload)
      : await wordBookService.createWordBook(payload);
    setSaving(false);
    if (!result.success) {
      setSubmitError(result.error);
      return;
    }
    toast.showSuccess(editing ? '已保存单词本信息' : `已创建「${payload.title}」`);
    onSaved(wordBook ? wordBook.id : (result.data as number));
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑单词本' : '新建单词本'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="wb-title">名称</Label>
            <div className="flex gap-2">
              <WordBookIconPicker
                icon={values.icon}
                color={values.iconColor}
                onChange={({ icon, color }) => setValues((prev) => ({ ...prev, icon, iconColor: color }))}
                className="size-9"
              />
              <Input
                id="wb-title"
                value={values.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="例如：三年级上册 Unit 1"
                maxLength={TITLE_MAX}
                autoFocus
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'wb-title-error' : undefined}
              />
            </div>
            {errors.title && (
              <p id="wb-title-error" className="text-sm text-destructive">
                {errors.title}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wb-tags">标签</Label>
            {allTags ? (
              <TagPicker id="wb-tags" tags={allTags} value={values.tagIds} onChange={(ids) => set('tagIds', ids)} onCreate={createTag} />
            ) : tagsFailed ? (
              <p className="text-sm text-muted-foreground">标签加载失败</p>
            ) : (
              <Skeleton className="h-9 w-full" />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wb-desc">场景描述</Label>
            <Textarea
              id="wb-desc"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="例如：出国旅行常用词"
              rows={2}
              maxLength={DESCRIPTION_MAX}
              aria-invalid={Boolean(errors.description)}
            />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>

          {submitError && <InlineError title={editing ? '无法保存单词本' : '无法新建单词本'}>{submitError}</InlineError>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {editing ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
