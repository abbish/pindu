/** 时间显示：`1:02:03.4` / `2:03.4`；withTenths = false 时不带小数 */
export function formatClock(ms: number, withTenths = true): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const clock = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return withTenths ? `${clock}.${Math.floor((safe % 1000) / 100)}` : clock;
}
