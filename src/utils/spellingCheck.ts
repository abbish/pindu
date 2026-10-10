/**
 * 拼写检查（「查」）：把学生的拼写与正确单词逐字母对齐，标出错 / 漏的字母，并对应到拼读块。
 * 对齐用编辑距离（替换、漏写、多写各算一步），不区分大小写。
 */
export type LetterStatus = 'ok' | 'wrong' | 'missing';

export interface LetterMark {
  char: string;
  status: LetterStatus;
}

export interface SpellingCheck {
  correct: boolean;
  /** 正确单词的每个字母及其状态（用于高亮） */
  marks: LetterMark[];
  /** 多写的字母个数 */
  extra: number;
  /** 出错的拼读块（按出现顺序，去重）；没有拼读块时为空 */
  wrongChunks: string[];
}

export function checkSpelling(input: string, target: string, chunks: string[] = []): SpellingCheck {
  // 空白归一：词组里多打的空格不算错（D45）
  const a = input.trim().replace(/\s+/g, ' ').toLowerCase();
  const b = target.trim().replace(/\s+/g, ' ');
  const bl = b.toLowerCase();
  const n = a.length;
  const m = bl.length;
  // dp[i][j]：input 前 i 个字母对齐 target 前 j 个字母的最小编辑步数
  const dp = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + (a[i - 1] === bl[j - 1] ? 0 : 1),
        dp[i - 1][j] + 1, // 多写
        dp[i][j - 1] + 1 // 漏写
      );
    }
  }

  const status: LetterStatus[] = Array(m).fill('ok');
  /** 多写发生的位置（插在 target 第 j 个字母之前） */
  const extraAt: number[] = [];
  let i = n;
  let j = m;
  // 回溯时同样步数下的优先级：相同字母 > 多写 > 漏写 > 写错，让标出的错误更贴近孩子的实际拼法
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === bl[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // 先认定结尾多写的字母，让后面相同的字母对上（nite → night：e 多写，t 对上，igh 漏写）
      extraAt.push(j);
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      status[j - 1] = 'missing';
      j--;
    } else {
      status[j - 1] = 'wrong';
      i--;
      j--;
    }
  }

  const marks = [...b].map((char, k) => ({ char, status: status[k] }));
  const correct = a === bl;

  // 拼读块：拼起来要与单词一致才能对应（词组按词分块，块之间的空格跳过）
  const wrongChunks: string[] = [];
  if (!correct && chunks.join('').toLowerCase() === bl.replace(/ /g, '')) {
    let start = 0;
    for (const chunk of chunks) {
      while (bl[start] === ' ') start++;
      const end = start + chunk.length;
      const bad =
        status.slice(start, end).some(s => s !== 'ok') ||
        extraAt.some(p => p > start && p < end); // 多写的字母落在块内部
      if (bad && !wrongChunks.includes(chunk)) wrongChunks.push(chunk);
      start = end;
    }
  }
  return { correct, marks, extra: extraAt.length, wrongChunks };
}
