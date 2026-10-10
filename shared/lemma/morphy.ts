// 词形还原（lemmatization）：WordNet 的 morphy 算法 + WordNet 3.0 词典（shared/lemma/wordnet.json，scripts/lemma/build.mjs 生成）。
// 前端与 sidecar 共用这一份实现；Rust 端 src-tauri/src/lemma.rs 按同一算法读同一份数据，两端用 cases.json 核对结果（D47）。
//
// morphy：先查不规则变形表（went → go），再按各词性的去词尾规则还原（-s / -es / -ed / -ing / -er / -est 等），
// 还原结果必须是词典里有的词；这个词本身已是该词性的基本词时不再去词尾（避免 bed → be）。词典里没有的词（人名、生僻词）只按同样的去词尾规则比较，不另加任何规则。

import data from './wordnet.json' with { type: 'json' };

type Pos = 'n' | 'v' | 'a' | 'r';
const POS: Pos[] = ['n', 'v', 'a', 'r'];

/** WordNet morph.c 的去词尾规则（词尾 → 替换） */
const DETACH: Record<Pos, [string, string][]> = {
  n: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  v: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  a: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
  r: [],
};

let tables: { index: Record<Pos, Set<string>>; exceptions: Record<Pos, Map<string, string[]>> } | null = null;
function load() {
  if (tables) return tables;
  const index = {} as Record<Pos, Set<string>>;
  const exceptions = {} as Record<Pos, Map<string, string[]>>;
  for (const p of POS) {
    index[p] = new Set(data.index[p].split(' '));
    exceptions[p] = new Map(
      data.exceptions[p]
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [form, ...lemmas] = line.split(' ');
          return [form, lemmas] as [string, string[]];
        })
    );
  }
  tables = { index, exceptions };
  return tables;
}

/** 一个词可能的原形（各词性合并，含它自己，小写）。词典里查不到的词按去词尾规则给出候选 */
export function lemmas(word: string): string[] {
  const w = word.trim().toLowerCase().replace(/[‘’]/g, "'");
  if (!w) return [];
  const { index, exceptions } = load();
  const out = new Set<string>([w]);
  for (const p of POS) {
    for (const l of exceptions[p].get(w) ?? []) out.add(l);
    // 本身就是这个词性的基本词时不再去词尾（bed 不还原成 be，customs「海关」不还原成 custom）
    if (index[p].has(w)) continue;
    for (const [suffix, repl] of DETACH[p]) {
      if (w.length > suffix.length && w.endsWith(suffix)) {
        const base = w.slice(0, -suffix.length) + repl;
        if (index[p].has(base)) out.add(base);
      }
    }
  }
  return [...out];
}

/** 这个词在词典里吗（任一词性） */
export function known(word: string): boolean {
  const { index } = load();
  const w = word.toLowerCase();
  return POS.some((p) => index[p].has(w));
}

/**
 * token 是不是 base 的某种形式（went 与 go、children 与 child、studied 与 study）。
 * base 不在词典里时（人名、生僻词），按 WordNet 的去词尾规则比较（dinos 与 dino）。
 */
export function isFormOf(token: string, base: string): boolean {
  const t = token.trim().toLowerCase().replace(/[‘’]/g, "'");
  const b = base.trim().toLowerCase().replace(/[‘’]/g, "'");
  if (!t || !b) return false;
  if (t === b || lemmas(t).includes(b)) return true;
  if (known(b)) return false;
  return POS.some((p) => DETACH[p].some(([suffix, repl]) => t.length > suffix.length && t.endsWith(suffix) && t.slice(0, -suffix.length) + repl === b));
}
