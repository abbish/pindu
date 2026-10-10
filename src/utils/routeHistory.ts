/**
 * 页面浏览历史（前进 / 后退，像浏览器一样）：纯函数，App 持有状态。
 * 跳转时截掉「前进」的部分再追加；跳到与当前相同的页面不记；最多保留 MAX 条。
 * 前进 / 后退时跳过 skip 的页面（整窗练习等有自己退出流程的页面，不应回到一次已经结束的练习）。
 */
export interface RouteLike {
  page: string;
  params?: unknown;
}

export interface RouteHistory<R extends RouteLike> {
  entries: R[];
  index: number;
}

const MAX = 50;

const sameRoute = (a: RouteLike, b: RouteLike) => a.page === b.page && JSON.stringify(a.params ?? null) === JSON.stringify(b.params ?? null);

export function startHistory<R extends RouteLike>(route: R): RouteHistory<R> {
  return { entries: [route], index: 0 };
}

export function pushRoute<R extends RouteLike>(h: RouteHistory<R>, route: R): RouteHistory<R> {
  if (sameRoute(h.entries[h.index], route)) return h;
  const entries = [...h.entries.slice(0, h.index + 1), route].slice(-MAX);
  return { entries, index: entries.length - 1 };
}

/** 只是页签、来源这类视图参数不同的同一页（plan-detail X 与 plan-detail X 的某个页签） */
const VIEW_PARAMS = new Set(['tab', 'initialTab', 'fromPlan']);
const samePage = (a: RouteLike, b: RouteLike) => {
  if (a.page !== b.page) return false;
  const strip = (p: unknown) =>
    JSON.stringify(p && typeof p === 'object' ? Object.fromEntries(Object.entries(p).filter(([k, v]) => !VIEW_PARAMS.has(k) && v !== undefined).sort()) : (p ?? null));
  return strip(a.params) === strip(b.params);
};

/**
 * delta = -1 后退 / 1 前进；找不到可去的页面时返回 null。
 * 跳过 skip 的页面，也跳过和当前是同一页的记录（练完回到进入前那一页后，后退不会原地不动）。
 */
export function stepTarget<R extends RouteLike>(h: RouteHistory<R>, delta: -1 | 1, skip: (r: R) => boolean): number | null {
  const current = h.entries[h.index];
  for (let i = h.index + delta; i >= 0 && i < h.entries.length; i += delta) {
    if (!skip(h.entries[i]) && !samePage(h.entries[i], current)) return i;
  }
  return null;
}

export function stepRoute<R extends RouteLike>(h: RouteHistory<R>, delta: -1 | 1, skip: (r: R) => boolean): RouteHistory<R> {
  const target = stepTarget(h, delta, skip);
  return target === null ? h : { ...h, index: target };
}
