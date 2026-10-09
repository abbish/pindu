import { useEffect, useState } from 'react';
import { instantMs } from '@/utils/datetime';

/** 从 since（时刻字符串或毫秒时间戳）到现在的秒数，active 时每秒刷新；since 为空返回 null */
export function useElapsed(since: string | number | null | undefined, active = true): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || since == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, since]);
  if (since == null) return null;
  const start = typeof since === 'number' ? since : instantMs(since);
  return Math.max(0, Math.round((now - start) / 1000));
}
