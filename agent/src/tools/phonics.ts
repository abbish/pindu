// 拼读分析任务工具：submit_phonics。提交时做确定性校验，不合格返回错误让模型修正后重交（不结束本轮）。

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { annotatedForms, usesWord } from "../../../shared/lemma/phrase.ts";

/** 规则名称表（与提示词一致，格式「专业术语 | 直观描述」） */
export const PHONICS_RULES = [
  "CVC Pattern | 短元音规则",
  "VCE Pattern | 魔法e规则",
  "Open Syllable | 开音节规则",
  "R-Controlled Vowel | r控制元音",
  "Vowel Teams | 元音组合",
  "Consonant Blends | 辅音连读",
  "Consonant Digraphs | 辅音字母组合",
  "Diphthongs | 双元音",
  "Consonant-le | 辅音+le结尾",
  "Sight Word | 高频词",
  "Soft/Hard C,G | 软硬音规则",
  "Silent Letters | 不发音字母",
  "Suffix Rules | 后缀规则",
  "Syllable Division | 音节划分",
  "Irregular | 不规则拼读",
];

/** 词组类型（D45） */
export const PHRASE_TYPES = ["phrasal_verb", "collocation", "idiom", "fixed"];

const PhonicsEntry = Type.Object({
  word: Type.String({ description: "the word or phrase exactly as given" }),
  chinese_translation: Type.String({ description: "concise Chinese meaning" }),
  pos_abbreviation: Type.String({ description: "n. v. adj. adv. prep. conj. pron. art. int. det." }),
  pos_english: Type.String({ description: "Noun / Verb / Adjective ..." }),
  pos_chinese: Type.String({ description: "名词 / 动词 / 形容词 ..." }),
  ipa: Type.String({ description: "IPA wrapped in slashes, e.g. /ˈkæt/" }),
  syllables: Type.String({ description: "single word: syllables joined by '-', letters must spell the word, e.g. ba-king; phrase: empty string" }),
  phonics_rule: Type.String({ description: "single word: one label from the rule table, format 'Term | 中文'; phrase: empty string" }),
  phrase_type: Type.Optional(Type.String({ description: "phrase only: phrasal_verb / collocation / idiom / fixed" })),
  separable: Type.Optional(Type.Boolean({ description: "phrasal verb only: true if an object can go between the verb and the particle (pick it up)" })),
  analysis_explanation: Type.String({ description: "1-3 sentences in Chinese explaining the rule for this word" }),
  examples: Type.Array(
    Type.Object({
      sentence: Type.String({ description: "short, simple English sentence containing the word in the given meaning" }),
      translation: Type.String({ description: "natural Chinese translation of the sentence" }),
      uses: Type.Optional(Type.String({ description: "for a phrase used in a split or changed form: how it is written in this sentence, copied exactly (e.g. gave it up)" })),
    }),
    { description: "5-8 example sentences in different everyday scenes; the first one is the simplest" },
  ),
});

export type PhonicsEntry = Static<typeof PhonicsEntry>;

/** 例句长度上限（单词数），保证孩子能听完、跟读 */
export const EXAMPLE_MAX_WORDS = 12;
/** 每个单词的例句条数范围 */
export const EXAMPLES_MIN = 5;
export const EXAMPLES_MAX = 8;

/** 例句中是否用到该单词或词组（与前端、Rust 同一实现 shared/lemma：单词按词形库；词组连着出现可变形，
 * 拆开用时按例句标注的写法 uses 核对，D47）。所有格 's 先去掉 */
export function sentenceContainsWord(sentence: string, word: string, uses?: string): boolean {
  const tokens = (sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).map(t => t.replace(/['’]s$/i, ""));
  const forms = uses ? annotatedForms(tokens, word, [{ phrase: word, text: uses }]) : [];
  return usesWord(tokens, word, forms);
}

/** 单条例句检查：有内容、长度适中、是完整句子、包含该单词，并有中文翻译 */
function sentenceProblems(sentence: string, translation: string, word: string, where: string, uses?: string): string[] {
  const problems: string[] = [];
  if (!sentence) return [`${where} sentence 不能为空`];
  const count = sentence.split(/\s+/).length;
  if (count < 3 || count > EXAMPLE_MAX_WORDS) {
    problems.push(`${where} 应为 3–${EXAMPLE_MAX_WORDS} 个词的简单句（当前 ${count} 个）`);
  }
  if (!/^[A-Z"']/.test(sentence) || !/[.!?]["']?$/.test(sentence)) {
    problems.push(`${where} 应以大写字母开头、以 . ! ? 结尾`);
  }
  if (/[^\x20-\x7E’]/.test(sentence)) problems.push(`${where} 只能包含英文字符`);
  if (!sentenceContainsWord(sentence, word, uses)) {
    problems.push(`${where} 必须包含单词或词组 ${word} 本身（尽量用原形；词组拆开用时在 uses 里照抄它在句中的写法）`);
  }
  if (!/[\u4e00-\u9fff]/.test(translation)) problems.push(`${where} translation 需为该句的中文翻译`);
  return problems;
}

/** 例句组检查：条数、逐条格式、不重复（拼读分析与例句生成共用） */
export function examplesProblems(
  rawWord: string,
  examples: { sentence: string; translation: string; uses?: string }[],
  label: string,
): string[] {
  const word = rawWord.trim();
  const problems: string[] = [];
  if (examples.length < EXAMPLES_MIN || examples.length > EXAMPLES_MAX) {
    problems.push(`${label} examples 需要 ${EXAMPLES_MIN}–${EXAMPLES_MAX} 条（当前 ${examples.length} 条）`);
  }
  const seen = new Set<string>();
  examples.forEach((e, i) => {
    const sentence = e.sentence.trim();
    const where = `${label} examples[${i + 1}]`;
    problems.push(...sentenceProblems(sentence, e.translation, word, where, e.uses));
    const key = sentence.toLowerCase();
    if (sentence && seen.has(key)) problems.push(`${where} 与前面的例句重复`);
    seen.add(key);
  });
  return problems;
}

/** 返回每条不合格项的说明；空数组表示通过 */
export function validatePhonics(words: PhonicsEntry[]): string[] {
  const problems: string[] = [];
  if (words.length === 0) problems.push("words 为空：请提交全部单词的分析");
  for (const w of words) {
    const word = w.word.trim();
    const label = `「${word || "(空)"}」`;
    const phrase = /\s/.test(word);
    if (!/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)*$/.test(word)) problems.push(`${label} word 只能包含英文字母`);
    if (phrase) {
      // 词组：不拆音节、不套拼读规则，要给出词组类型
      if (!PHRASE_TYPES.includes((w.phrase_type ?? "").trim())) {
        problems.push(`${label} 是词组，phrase_type 需为 phrasal_verb / collocation / idiom / fixed 之一`);
      }
    } else {
      const letters = w.syllables.replace(/[-·\s]/g, "").toLowerCase();
      if (letters !== word.toLowerCase().replace(/['-]/g, "")) {
        problems.push(`${label} syllables「${w.syllables}」去掉连字符后应与单词拼写完全一致`);
      }
      if (!PHONICS_RULES.includes(w.phonics_rule.trim())) {
        problems.push(`${label} phonics_rule「${w.phonics_rule}」不在规则表中，请从规则表中选择一项（原样复制）`);
      }
    }
    if (!/^\/[^/]+\/$/.test(w.ipa.trim())) problems.push(`${label} ipa 需用斜杠包围，如 /ˈkæt/`);
    for (const field of ["chinese_translation", "pos_abbreviation", "pos_chinese", "analysis_explanation"] as const) {
      if (!w[field].trim()) problems.push(`${label} ${field} 不能为空`);
    }
    problems.push(...examplesProblems(w.word, w.examples ?? [], label));
  }
  return problems;
}

export const submitPhonicsTool = defineTool({
  name: "submit_phonics",
  label: "提交拼读分析",
  description:
    "Submit the phonics analysis for ALL given words in one call. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: Type.Object({ words: Type.Array(PhonicsEntry) }),
  async execute(_toolCallId, params) {
    const problems = validatePhonics(params.words);
    if (problems.length > 0) {
      // 抛错 = 工具错误结果，模型会看到问题列表并重交
      throw new Error(`提交未通过校验（${problems.length} 处），请修正后重新提交：\n- ${problems.join("\n- ")}`);
    }
    return {
      content: [{ type: "text", text: `Accepted ${params.words.length} words.` }],
      details: params,
      terminate: true,
    };
  },
});
