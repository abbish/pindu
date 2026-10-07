import { useEffect, useState } from 'react';
import { localToday, msUntilNextLocalMidnight } from '@/utils/datetime';

/**
 * 今天的本地日期 `YYYY-MM-DD`，跨过本地零点时自动更新（应用常驻桌面，不能只在加载时取一次）。
 * 依赖它的 useMemo / useEffect 会在零点后重新计算。
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localToday());

  useEffect(() => {
    // 比零点晚 1 秒触发，避开计时器提前几毫秒的情况
    const timer = setTimeout(() => setToday(localToday()), msUntilNextLocalMidnight() + 1000);
    return () => clearTimeout(timer);
  }, [today]);

  return today;
}
