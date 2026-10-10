import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizeBookColor } from '@/components/WordBookIcon/WordBookIcon';
import { wordBookService } from '@/services/wordbookService';

/** 未收录词加到哪里：现有词汇本 / 新建一本 */
export type BookTarget = { kind: 'existing'; bookId: number } | { kind: 'new'; title: string };

const NEW = 'new';

export interface BookTargetPickerProps {
  value: BookTarget | null;
  onChange: (value: BookTarget | null) => void;
  /** 新建时的默认名称（如「材料名 词汇」） */
  defaultTitle: string;
  /** 默认选「新建词汇本」 */
  preferNew?: boolean;
  disabled?: boolean;
}

/**
 * 选择未收录词加进哪个词汇本：列出现有词汇本，最后一项「新建词汇本…」，选中后填名称。
 * 短文详情的「未收录词」与导入完成后的「将未收录词加入词汇本」共用。
 */
export const BookTargetPicker: React.FC<BookTargetPickerProps> = ({ value, onChange, defaultTitle, preferNew, disabled }) => {
  const [books, setBooks] = useState<{ id: number; title: string }[] | null>(null);
  // 选中的词汇本不在列表里（刚新建的）时重新拉取，下拉框才能显示它
  const selectedId = value?.kind === 'existing' ? value.bookId : null;
  const missing = selectedId !== null && books !== null && !books.some((b) => b.id === selectedId);

  const refetchedFor = useRef<number | null>(null);

  useEffect(() => {
    if (books !== null && !missing) return;
    // 每个缺失的 id 只补拉一次（词汇本被删掉时不会反复请求）
    if (missing) {
      if (refetchedFor.current === selectedId) return;
      refetchedFor.current = selectedId;
    }
    let stale = false;
    wordBookService.getAllWordBooks(false, 'normal').then((result) => {
      if (stale) return;
      setBooks(result.success ? result.data.map((b) => ({ id: b.id, title: b.title })) : []);
    });
    return () => {
      stale = true;
    };
  }, [books, missing, selectedId]);

  // 没有词汇本时，或要求默认新建时，直接给出新建
  useEffect(() => {
    if (value === null && preferNew) onChange({ kind: 'new', title: defaultTitle });
  }, [value, preferNew, defaultTitle, onChange]);

  const selectValue = value?.kind === 'new' ? NEW : value ? String(value.bookId) : '';

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={selectValue}
        onValueChange={(v) => onChange(v === NEW ? { kind: 'new', title: value?.kind === 'new' ? value.title : defaultTitle } : { kind: 'existing', bookId: Number(v) })}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-full" aria-label="加入哪个词汇本">
          <SelectValue placeholder="选择词汇本" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW}>新建词汇本…</SelectItem>
          {(books?.length ?? 0) > 0 && <SelectSeparator />}
          {(books ?? []).map((b) => (
            <SelectItem key={b.id} value={String(b.id)}>
              {b.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value?.kind === 'new' && (
        <Input
          value={value.title}
          onChange={(e) => onChange({ kind: 'new', title: e.target.value })}
          placeholder="新词汇本的名称"
          aria-label="新词汇本的名称"
          maxLength={100}
          className="h-8"
          disabled={disabled}
        />
      )}
    </div>
  );
};

/** 目标是否填好（新建时名称不能为空） */
export const isBookTargetReady = (t: BookTarget | null): t is BookTarget => t !== null && (t.kind === 'existing' || t.title.trim().length > 0);

/**
 * 解析目标：新建时先创建词汇本（场景写明来自哪份材料，之后拼读分析与例句会参考），返回词汇本 id 与名称。
 * 失败返回 { error }（已是用户能看懂的话）。
 */
export async function resolveBookTarget(target: BookTarget, sourceLabel: string | null): Promise<{ bookId: number; title: string; created: boolean } | { error: string }> {
  if (target.kind === 'existing') {
    const result = await wordBookService.getAllWordBooks(false, 'normal');
    const title = result.success ? (result.data.find((b) => b.id === target.bookId)?.title ?? '词汇本') : '词汇本';
    return { bookId: target.bookId, title, created: false };
  }
  const title = target.title.trim();
  const result = await wordBookService.createWordBook({
    title,
    description: sourceLabel ? `来自材料「${sourceLabel}」的词汇` : '来自导入材料的词汇',
    icon: 'bookmark',
    icon_color: normalizeBookColor(),
  });
  if (!result.success) return { error: result.error };
  return { bookId: result.data, title, created: true };
}

/** 材料名去掉后缀后的默认词汇本名 */
export const defaultBookTitle = (sourceLabel: string | null | undefined) => {
  const base = (sourceLabel ?? '').replace(/\.[A-Za-z0-9]{1,8}$/, '').trim();
  return base && base !== '粘贴的文本' ? `${base} 词汇` : '导入词汇';
};
