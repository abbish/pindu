/**
 * 导入材料的预览编辑（纯函数）：合并到上一篇、从某句拆开、改标题、篇幅统计。
 * 后端 prepare_passage_import 给出初始拆分，用户在预览里调整后逐篇导入。
 */

/** 一句原文（与后端 ImportSentence 同形） */
export interface ImportSentenceLike {
  en: string;
  /** 本句开始新段落 */
  paragraph: boolean;
}

/** 预览里的一篇（与后端 ImportPreviewItem 同形） */
export interface ImportItemLike<S extends ImportSentenceLike = ImportSentenceLike> {
  title: string;
  sentences: S[];
  wordCount: number;
  /** 材料自带的词汇（AI 读取的素材才有）；合并时合起来，拆开时两篇都带上（导入时按正文过滤） */
  words?: { word: string }[];
}

const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

/** 英文词数（与后端 english_word_count 口径一致：字母词，含 don't / well-known） */
export function englishWordCount(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

export function sentencesWordCount(sentences: ImportSentenceLike[]): number {
  return sentences.reduce((n, s) => n + englishWordCount(s.en), 0);
}

/** 把第 index 篇合并到上一篇（标题用上一篇的；第一篇不动） */
export function mergeWithPrevious<T extends ImportItemLike>(items: T[], index: number): T[] {
  if (index <= 0 || index >= items.length) return items;
  const prev = items[index - 1];
  const cur = items[index];
  // 合并处另起一段，保留原来的分篇边界
  const joined = cur.sentences.map((s, i) => (i === 0 ? { ...s, paragraph: true } : s));
  const words = [...(prev.words ?? []), ...(cur.words ?? []).filter((w) => !(prev.words ?? []).some((p) => p.word.toLowerCase() === w.word.toLowerCase()))];
  const merged = { ...prev, sentences: [...prev.sentences, ...joined], wordCount: prev.wordCount + cur.wordCount, ...(prev.words || cur.words ? { words } : {}) };
  return [...items.slice(0, index - 1), merged, ...items.slice(index + 1)];
}

/** 从第 itemIndex 篇的第 sentenceIndex 句开始拆成新的一篇（新篇标题取首句开头） */
export function splitAt<T extends ImportItemLike>(items: T[], itemIndex: number, sentenceIndex: number): T[] {
  const item = items[itemIndex];
  if (!item || sentenceIndex <= 0 || sentenceIndex >= item.sentences.length) return items;
  const head = item.sentences.slice(0, sentenceIndex);
  const tail = item.sentences.slice(sentenceIndex).map((s, i) => (i === 0 ? { ...s, paragraph: true } : s));
  const first = { ...item, sentences: head, wordCount: sentencesWordCount(head) };
  const second = { ...item, title: titleFrom(tail[0].en), sentences: tail, wordCount: sentencesWordCount(tail) };
  return [...items.slice(0, itemIndex), first, second, ...items.slice(itemIndex + 1)];
}

/**
 * 预览里改一句的英文（value 已去掉多余空白、非空）：用户核对过，去掉待核对标记；
 * 英文真改了的丢掉材料里的旧译文，导入时由 AI 重新翻译这句（后端只在译文为空时用 AI 的）。
 */
export function editSentenceText<S extends ImportSentenceLike & { zh?: string | null; unverified?: boolean }>(
  sentence: S,
  value: string,
): S {
  const changed = sentence.en.replace(/\s+/g, ' ').trim() !== value;
  return { ...sentence, en: value, unverified: false, ...(changed ? { zh: null } : {}) };
}

/** 改第 index 篇的标题 */
export function renameItem<T extends ImportItemLike>(items: T[], index: number, title: string): T[] {
  return items.map((it, i) => (i === index ? { ...it, title } : it));
}

/** 用一句话的开头当标题（最多 6 个词，去掉句末标点） */
export function titleFrom(sentence: string): string {
  const words = sentence.trim().split(/\s+/);
  const head = words.slice(0, 6).join(' ').replace(/[.,;:!?"'”’)\]]+$/, '');
  return words.length > 6 ? `${head}…` : head;
}

/** 预览里每篇的篇幅提示：太短不好出题，太长朗读与练习负担重 */
export function lengthHint(wordCount: number): 'short' | 'long' | null {
  if (wordCount < 60) return 'short';
  if (wordCount > 800) return 'long';
  return null;
}

/** 可导入的文件类型（后端按后缀解析；上限 10MB） */
export const IMPORT_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.srt', '.vtt', '.docx', '.pdf'];
/** 交给 AI 读取的素材（排版过的讲义、海报、照片、扫描件）：PDF、Word 与图片 */
export const AI_MATERIAL_EXTENSIONS = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 文件后缀（小写，含点）；没有后缀返回空串 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/** 字节 → base64（分块，避免大文件参数展开溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
