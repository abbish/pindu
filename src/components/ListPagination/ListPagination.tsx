import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 页码按钮：页数多时首尾 + 当前页附近，中间用 … */
export function pageNumbers(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'gap', total];
  if (current >= total - 3) return [1, 'gap', total - 4, total - 3, total - 2, total - 1, total];
  return [1, 'gap', current - 1, current, current + 1, 'gap', total];
}

export interface ListPaginationProps {
  /** 当前页，从 1 开始 */
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  /** 「显示第 1–24 条」的量词 */
  unit?: string;
  /** 只有一页时整行不显示（卡片网格的工具栏已经有总数） */
  hideSinglePage?: boolean;
  className?: string;
}

/** 列表底部的分页：左边「显示第 x–y 条，共 n 条」，右边上一页 / 页码 / 下一页（只有一页时不显示按钮） */
export const ListPagination: React.FC<ListPaginationProps> = ({ page, pageSize, total, onChange, unit = '条', hideSinglePage, className }) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0 || (hideSinglePage && pageCount <= 1)) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className={cn('flex items-center justify-between text-sm', className)}>
      <span className="text-muted-foreground tabular-nums">
        显示第 {first}–{last} {unit}，共 {total} {unit}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
            上一页
          </Button>
          {pageNumbers(page, pageCount).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'outline' : 'ghost'}
                size="icon"
                className={cn('size-8 tabular-nums', p === page && 'border-primary')}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => onChange(p)}
              >
                {p}
              </Button>
            )
          )}
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
            下一页
          </Button>
        </div>
      )}
    </div>
  );
};

/** 素材卡片网格每页张数（2 / 3 / 4 / 6 列都能排满） */
export const GRID_PAGE_SIZE = 24;

/** 各列表最后停在第几页（只放内存）：从详情返回时回到原来那页；筛选条件变了就回第一页 */
const lastPage = new Map<string, { key: string; page: number }>();

/**
 * 已在内存里的列表（筛选后）按页切片。id 区分列表，resetKey 是筛选条件（变了回到第一页）；
 * 删除后页数变少时停在最后一页。翻页时把 anchorRef 所在的位置（工具栏）滚回视野。
 */
export function usePagination<T>(items: T[] | null, { id, resetKey = '', pageSize = GRID_PAGE_SIZE }: { id: string; resetKey?: string; pageSize?: number }) {
  const [state, setState] = useState(() => {
    const saved = lastPage.get(id);
    return saved && saved.key === resetKey ? saved : { key: resetKey, page: 1 };
  });
  const anchorRef = useRef<HTMLDivElement>(null);
  const total = items?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const wanted = state.key === resetKey ? state.page : 1;
  // 还在加载时不按 0 条去夹页码
  const page = items === null ? wanted : Math.min(wanted, pageCount);

  useEffect(() => {
    if (items !== null) lastPage.set(id, { key: resetKey, page });
  }, [id, resetKey, page, items]);

  const pageItems = useMemo(() => (items === null ? null : items.slice((page - 1) * pageSize, page * pageSize)), [items, page, pageSize]);

  const setPage = (next: number) => {
    setState({ key: resetKey, page: next });
    anchorRef.current?.scrollIntoView({ block: 'start' });
  };

  return { page, pageSize, total, pageItems, setPage, anchorRef };
}
