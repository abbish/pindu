import { useCallback, useEffect, useRef, useState } from 'react';
import { NEAR_BOTTOM, nextPinned } from '@/utils/stickToBottom';

/**
 * 对话区的贴底跟随（规则见 utils/stickToBottom.ts）。内容的高度变化（流式文字逐帧长出来、步骤展开、图片加载）
 * 用 ResizeObserver 跟，不只在轮次变化时滚。
 * - scrollRef：滚动容器；contentRef：里面的内容（回调 ref，内容区换了元素也能接上）
 * - atBottom：是否在跟随（不在时显示「回到最新」）；scrollToBottom：回到底部并接着跟随
 */
export function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastScrollTop = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [content, setContent] = useState<HTMLElement | null>(null);

  const setPinned = useCallback((value: boolean) => {
    pinned.current = value;
    setAtBottom(value);
  }, []);

  const jump = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  /** 回到底部并接着跟随（点「回到最新」、发消息、换对话） */
  const scrollToBottom = useCallback(
    (smooth = false) => {
      setPinned(true);
      jump(smooth);
    },
    [jump, setPinned]
  );

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = nextPinned(pinned.current, {
      scrollTop: el.scrollTop,
      lastScrollTop: lastScrollTop.current,
      distance: el.scrollHeight - el.scrollTop - el.clientHeight,
    });
    lastScrollTop.current = el.scrollTop;
    if (next !== pinned.current) setPinned(next);
  }, [setPinned]);

  // 内容变高 / 变矮、对话区变大变小（输入框长高、窗口缩放）：跟随时滚到底；
  // 不跟随时如果已经到底（如内容收起后不用滚了），恢复跟随、收起「回到最新」
  useEffect(() => {
    const el = scrollRef.current;
    if (!content || !el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) jump(false);
      else if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM) setPinned(true);
    });
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
  }, [content, jump, setPinned]);

  return { scrollRef, contentRef: setContent, onScroll, atBottom, scrollToBottom };
}
