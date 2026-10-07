/** 字节数 → 人读的大小：0 B / 512 B / 1.5 KB / 18.4 MB / 1.2 GB（1024 进制，保留 1 位小数，整数不带 .0） */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Math.max(0, bytes ?? 0);
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[i]}`;
}
