import { useCallback, useMemo, useRef } from 'react';
import { isImeEnter } from '../utils/imeEnter';

/**
 * 输入框的输入法（IME）防护：把返回的 `compositionHandlers` 挂到 input 上，
 * 在 keydown 里用 `isImeEnter(e)` 跳过中文等输入法选词时按下的回车。
 */
export function useImeGuard() {
  const composingRef = useRef(false);
  const compositionEndRef = useRef(0);

  const compositionHandlers = useMemo(
    () => ({
      onCompositionStart: () => {
        composingRef.current = true;
      },
      onCompositionEnd: () => {
        composingRef.current = false;
        compositionEndRef.current = Date.now();
      },
    }),
    []
  );

  const isImeEnterKey = useCallback(
    (e: React.KeyboardEvent) => isImeEnter(e.nativeEvent, composingRef.current, compositionEndRef.current),
    []
  );

  return { compositionHandlers, isImeEnter: isImeEnterKey };
}
