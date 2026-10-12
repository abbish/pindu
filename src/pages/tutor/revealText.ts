/** 搜索结果打开对话后标出匹配处的高亮名（样式在 app.css 的 ::highlight(tutor-find)） */
const HIGHLIGHT = 'tutor-find';

/**
 * 在对话区里找到第一处 query（不分大小写），滚到那里并标出来（CSS Custom Highlight，不改 DOM；不支持时只滚动）。
 * 找到返回 true。收起的步骤里的文字不在页面上，找不到。
 */
export function revealText(root: HTMLElement, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? '').toLowerCase().indexOf(q);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + q.length);
    node.parentElement?.scrollIntoView({ block: 'center' });
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
    return true;
  }
  return false;
}

/** 去掉标出的匹配处 */
export function clearReveal() {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT);
}
