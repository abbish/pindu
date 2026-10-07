/**
 * 时间与时区的唯一前端入口（规范：.claude/skills/deliver-contract-and-data/references/time-and-timezone.md）。
 *
 * 两类值：
 * - 时刻 instant：后端一律 UTC。规范格式 `YYYY-MM-DDTHH:MM:SS.sssZ`；过渡期兼容 SQLite 默认的
 *   `YYYY-MM-DD HH:MM:SS`（无时区标记，按 UTC）与 RFC3339（带偏移）。展示时换算到本机时区。
 * - 日历日期 local date：`YYYY-MM-DD`，表示本地日历上的一天，永不做时区换算。
 *
 * 页面与组件不得直接 `new Date(<字符串>)` / `Date.parse` / `toLocale{Date,Time}String`（ESLint 拦截），
 * 一律经本模块。纯函数，有 node 测试（datetime.test.ts）。
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number) => String(n).padStart(2, '0');

// ==================== 解析 ====================

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 无时区标记的时间（SQLite 默认格式或不带偏移的 ISO）：按 UTC 解释 */
const ZONELESS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** 解析日历日期 `YYYY-MM-DD` 为本地零点；格式不符返回 null */
export function parseLocalDate(value: string | null | undefined): Date | null {
  const m = value ? LOCAL_DATE_RE.exec(value.trim()) : null;
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 解析时刻：带 `Z` / 偏移的按其时区；无时区标记的按 UTC（后端约定）；
 * 纯日期按本地日历日期（宽松兼容）。无法解析返回 null。
 */
export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.trim();
  if (LOCAL_DATE_RE.test(s)) return parseLocalDate(s);
  const iso = ZONELESS_RE.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

/** 时刻的毫秒时间戳（排序用）；无法解析为 0 */
export function instantMs(value: string | null | undefined): number {
  return parseInstant(value)?.getTime() ?? 0;
}

/** 当前时刻的规范字符串（前端极少需要；后端负责写入时刻） */
export function nowInstant(now: Date = new Date()): string {
  return now.toISOString();
}

// ==================== 本地日期 ====================

/** 本地日期键 `YYYY-MM-DD`（不能用 toISOString：那是 UTC，东八区 0–8 点会得到昨天） */
export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 今天的本地日期 `YYYY-MM-DD` */
export function localToday(now: Date = new Date()): string {
  return toLocalDateKey(now);
}

/** 两个本地日期相差的天数（b - a）；按日历日计算，不受夏令时影响 */
export function localDaysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / DAY_MS);
}

/** 日历日期加减天数 */
export function addLocalDays(dateKey: string, days: number): string {
  const d = parseLocalDate(dateKey);
  if (!d) return dateKey;
  return toLocalDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** 时刻所在的本地日期 `YYYY-MM-DD`（按本机时区归日，不截取 UTC 字符串） */
export function localDateOf(value: string | null | undefined): string {
  const d = parseInstant(value);
  return d ? toLocalDateKey(d) : '';
}

/** 距下一个本地零点的毫秒数（useToday 用） */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ==================== 展示（zh-CN，本机时区） ====================

/** 可展示的时间值：Date、毫秒时间戳、时刻字符串或日历日期字符串 */
export type TimeValue = Date | number | string | null | undefined;

/** 统一转成 Date：`YYYY-MM-DD` 按日历日期，其余字符串按时刻，数字按毫秒时间戳 */
function toDate(value: TimeValue): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : parseInstant(value);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** 日期：今年 `10月7日`，其他年份 `2025年12月31日` */
export function formatDate(value: TimeValue, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 年月：`2026年10月` */
export function formatMonth(value: TimeValue): string {
  const d = toDate(value);
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月` : '';
}

/** 星期：`周三` */
export function formatWeekday(value: TimeValue): string {
  const d = toDate(value);
  return d ? `周${WEEKDAYS[d.getDay()]}` : '';
}

/** 时间：`14:05`，`withSeconds` 时 `14:05:09` */
export function formatTime(value: TimeValue, withSeconds = false): string {
  const d = toDate(value);
  if (!d) return '';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${hm}:${pad(d.getSeconds())}` : hm;
}

/** 日期 + 时间：`10月7日 14:05` */
export function formatDateTime(value: TimeValue, now: Date = new Date(), withSeconds = false): string {
  const d = toDate(value);
  return d ? `${formatDate(d, now)} ${formatTime(d, withSeconds)}` : '';
}

/** 按日的相对文案：今天 / 昨天 / N 天前（7 天内）/ 日期 */
export function formatRelativeDay(value: TimeValue, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const days = localDaysBetween(d, now);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days > 1 && days < 7) return `${days} 天前`;
  return formatDate(d, now);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前（今天内）/ 昨天 / N 天前（7 天内）/ 日期 */
export function formatRelative(value: TimeValue, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (localDaysBetween(d, now) <= 0) return `${Math.floor(minutes / 60)} 小时前`;
  return formatRelativeDay(d, now);
}

/** 两个时刻是否在同一分钟内（判断“从未使用”：last_used 默认等于 created_at） */
export function sameMinute(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = parseInstant(a);
  const db = parseInstant(b);
  return !!da && !!db && Math.abs(da.getTime() - db.getTime()) < 60_000;
}

/** 时长（毫秒）：text `11 秒` / `3 分 20 秒` / `1 小时 5 分`；clock `03:20` / `1:05:00` */
export function formatDuration(ms: number | null | undefined, style: 'text' | 'clock' = 'text'): string {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (style === 'clock') return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (total < 60) return `${total} 秒`;
  if (h === 0) return `${m} 分 ${s} 秒`;
  return `${h} 小时 ${m} 分`;
}
