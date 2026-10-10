/**
 * 新建词汇本后直接添加单词：新建成功时记下这本书，详情页打开时取走一次（只生效一次；后退回到详情页不会再弹出）。
 */
let pending: number | null = null;

/** 新建词汇本后调用：打开它的详情页时直接进入「添加单词 · AI 生成」 */
export function addWordsAfterCreate(bookId: number) {
  pending = bookId;
}

/** 详情页打开时取走：是这本书就返回 true */
export function takePendingAddWords(bookId: number): boolean {
  if (pending !== bookId) return false;
  pending = null;
  return true;
}
