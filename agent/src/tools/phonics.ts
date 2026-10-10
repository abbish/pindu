// 拼读分析任务工具：submit_phonics。提交时做确定性校验，不合格返回错误让模型修正后重交（不结束本轮）。

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { isFormOf } from "../../../shared/lemma/morphy.ts";

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
      sentence: Type.String({ description: "short, simple English sentence for kids containing the word in the given meaning" }),
      translation: Type.String({ description: "natural Chinese translation of the sentence" }),
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

/** 词组里代表某人 / 某物的占位词（例句里换成具体的词） */
const PLACEHOLDERS = new Set(["sb", "sth", "somebody", "something", "someone", "one's", "sb's", "oneself"]);

/** 一个词是否是 word 的某种形式（词形库 shared/lemma，D47；所有格 's 先去掉） */
const tokenIsForm = (token: string, word: string) => isFormOf(token.replace(/'s$/, ""), word);

/** 例句中是否出现该单词或词组（允许常见词形变化；词组的各个词按顺序出现、中间可插入少量词，占位词不要求） */
export function sentenceContainsWord(sentence: string, word: string): boolean {
  const tokens = sentence.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const parts = word.toLowerCase().trim().split(/\s+/).filter(p => !PLACEHOLDERS.has(p));
  if (parts.length > 1) {
    for (let start = 0; start < tokens.length; start++) {
      if (!tokenIsForm(tokens[start], parts[0])) continue;
      let i = start + 1;
      let ok = true;
      for (const p of parts.slice(1)) {
        let found = -1;
        for (let j = i; j < Math.min(tokens.length, i + 4); j++) if (tokenIsForm(tokens[j], p)) { found = j; break; }
        if (found < 0) { ok = false; break; }
        i = found + 1;
      }
      if (ok) return true;
    }
    return false;
  }
  const w = word.toLowerCase();
  const stems = [w];
  if (/[ey]$/.test(w) && w.length > 2) stems.push(w.slice(0, -1));
  return tokens.some(t => {
    const bare = t.replace(/'s$/, "");
    return stems.some(stem => bare.startsWith(stem) && bare.length - w.length <= 4);
  });
}

/** 单条例句检查：有内容、长度适中、是完整句子、包含该单词，并有中文翻译 */
function sentenceProblems(sentence: string, translation: string, word: string, where: string): string[] {
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
  if (!sentenceContainsWord(sentence, word)) {
    problems.push(`${where} 必须包含单词或词组 ${word} 本身（尽量用原形）`);
  }
  if (!/[\u4e00-\u9fff]/.test(translation)) problems.push(`${where} translation 需为该句的中文翻译`);
  return problems;
}

/** 例句组检查：条数、逐条格式、不重复（拼读分析与例句生成共用） */
export function examplesProblems(
  rawWord: string,
  examples: { sentence: string; translation: string }[],
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
    problems.push(...sentenceProblems(sentence, e.translation, word, where));
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
