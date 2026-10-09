/** 列表排序的纯函数：各列表定义自己的排序项，界面用 components/SortSelect */
import { instantMs } from './datetime';

export interface SortOption<T> {
  value: string;
  label: string;
  compare: (a: T, b: T) => number;
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

/** 名称升序（中文按拼音，数字按大小） */
export const byText =
  <T>(get: (item: T) => string) =>
  (a: T, b: T) =>
    collator.compare(get(a), get(b));

/** 数值；desc 为大的在前。null 永远排在最后 */
export const byNumber =
  <T>(get: (item: T) => number | null | undefined, desc = true) =>
  (a: T, b: T) => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return desc ? y - x : x - y;
  };

/** 时刻；desc 为新的在前。没有时刻的排在最后 */
export const byInstant = <T>(get: (item: T) => string | null | undefined, desc = true) =>
  byNumber<T>((item) => {
    const v = get(item);
    return v ? instantMs(v) : null;
  }, desc);

/** 按选中的排序项排（稳定排序，不改原数组）；找不到时用第一项 */
export function sortItems<T>(items: T[], options: SortOption<T>[], value: string): T[] {
  const option = options.find((o) => o.value === value) ?? options[0];
  return option ? [...items].sort(option.compare) : items;
}
