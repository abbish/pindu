import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface SelectionActionProps {
  /** 选中的文字是否可以操作（不可以时不显示按钮） */
  accept: (text: string) => boolean;
  /** 按钮文字 */
  label: string;
  onAction: (text: string) => void;
  children: React.ReactNode;
}

/**
 * 在一段文字里选中内容后，在选区上方浮出一个操作按钮（如「加入目标词」）。
 * 点按钮外的地方、滚动、按 Esc 或选区消失时收起。
 */
export const SelectionAction: React.FC<SelectionActionProps> = ({ accept, label, onAction, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!pick) return;
    const close = () => setPick(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onSelection = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('selectionchange', onSelection);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [pick]);

  const onMouseUp = () => {
    // 等浏览器更新完选区（双击选词时）
    window.setTimeout(() => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0 || !ref.current?.contains(s.anchorNode)) return setPick(null);
      const text = s.toString().trim();
      if (!accept(text)) return setPick(null);
      const rect = s.getRangeAt(0).getBoundingClientRect();
      setPick({ text, x: rect.left + rect.width / 2, y: rect.top });
    }, 0);
  };

  return (
    <div ref={ref} onMouseUp={onMouseUp}>
      {children}
      {pick && (
        <div className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2" style={{ left: pick.x, top: pick.y }}>
          <Button
            size="sm"
            className="shadow-md"
            // 不让按下按钮时清掉选区
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAction(pick.text);
              setPick(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <Plus />
            {label}
          </Button>
        </div>
      )}
    </div>
  );
};
