/**
 * 句子拆词（精听填空用）。纯函数，便于测试。
 */

/** 句子里的词（保留词内撇号与连字符，去掉标点） */
export function sentenceWords(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
    .filter(Boolean);
}
