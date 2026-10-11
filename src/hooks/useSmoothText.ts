import { useEffect, useRef, useState } from 'react';

/**
 * 流式文字的平滑显示：显示内容逐帧追上目标文字，积压越多追得越快（约 10 帧追平），
 * 模型一次吐出一大块时不会「卡一下出来一堆」。`active` 为 false（不在流式输出）时直接显示全文。
 */
export function useSmoothText(target: string, active: boolean): string {
  const [shown, setShown] = useState(active ? '' : target);
  const shownRef = useRef(shown);

  useEffect(() => {
    const show = (text: string) => {
      shownRef.current = text;
      setShown(text);
    };
    if (!active) {
      show(target);
      return;
    }
    let frame = 0;
    const tick = () => {
      const prev = shownRef.current;
      // 目标被整体替换（如 text_end 给出的最终文字与增量不同）：从共同前缀接着显示
      const base = target.startsWith(prev) ? prev : target.slice(0, Math.min(prev.length, target.length));
      const backlog = target.length - base.length;
      if (backlog <= 0) {
        if (prev !== target) show(target);
        return; // 追平了：等下一次目标变化再动
      }
      show(target.slice(0, base.length + Math.max(1, Math.ceil(backlog / 10))));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return shown;
}
