// 句子分析的工具：submit_sentence_analysis（句式、成分、语法点、交际功能、词组、发音要点）。
// 校验不通过时抛错，模型只改被指出的地方再重交；Rust 侧（services::sentence_analysis）会按原句再校正。

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const SentenceAnalysisParams = Type.Object({
  sentence: Type.String({ description: "copy of the English sentence being analyzed" }),
  pattern: Type.String({ description: "reusable sentence pattern in Chinese role names + fixed English words, e.g. 主语 + would rather + do A + than do B" }),
  pattern_note: Type.String({ description: "Chinese: what the pattern expresses and how to reuse it, with one new example (English + Chinese)" }),
  chunks: Type.Array(
    Type.Object({
      text: Type.String({ description: "a contiguous part copied from the sentence" }),
      role: Type.String({ description: "Chinese role, e.g. 主语 / 谓语 / 宾语 / 时间状语从句" }),
    }),
    { description: "3-8 parts in sentence order covering the whole sentence" },
  ),
  grammar: Type.Array(
    Type.Object({
      title: Type.String({ description: "Chinese name of the grammar point" }),
      text: Type.String({ description: "the part of the sentence that shows it" }),
      explanation: Type.String({ description: "1-3 Chinese sentences" }),
    }),
    { description: "1-3 grammar points" },
  ),
  function: Type.String({ description: "communicative function in Chinese, 6-16 characters, e.g. 委婉地拒绝邀请" }),
  function_note: Type.String({ description: "Chinese: when to use it, formality, attitude" }),
  alternatives: Type.Array(Type.Object({ en: Type.String(), zh: Type.String() }), { description: "0-3 other ways to do the same thing" }),
  phrases: Type.Array(
    Type.Object({
      text: Type.String({ description: "as written in the sentence, e.g. gave up" }),
      base: Type.String({ description: "dictionary form, e.g. give up" }),
      meaning: Type.String({ description: "Chinese meaning here" }),
    }),
    { description: "0-4 multi-word phrases worth learning as a whole" },
  ),
  pronunciation: Type.Array(
    Type.Object({
      text: Type.String({ description: "part of the sentence" }),
      tip: Type.String({ description: "Chinese: linking, weak forms, stress or intonation; IPA allowed, no Chinese homophones" }),
    }),
    { description: "1-4 tips" },
  ),
});
export type SentenceAnalysisSubmission = Static<typeof SentenceAnalysisParams>;

const norm = (s: string) => s.replace(/[\u2018\u2019]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s: string) => norm(s).replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");

export function sentenceAnalysisProblems(p: SentenceAnalysisSubmission): string[] {
  const problems: string[] = [];
  const sentence = norm(p.sentence);
  const inSentence = (part: string) => clean(part) !== "" && sentence.includes(clean(part));
  if (!p.pattern.trim()) problems.push("pattern 不能为空");
  if (!p.function.trim()) problems.push("function 不能为空");
  if (p.chunks.length < 2 || p.chunks.length > 8) problems.push(`chunks 要 3–8 段（现在 ${p.chunks.length} 段）`);
  let at = 0;
  p.chunks.forEach((c, i) => {
    const part = clean(c.text);
    const found = part ? sentence.indexOf(part, at) : -1;
    if (!c.role.trim()) problems.push(`chunks[${i + 1}] 缺少 role`);
    if (found < 0) problems.push(`chunks[${i + 1}]「${c.text}」要照抄原句、按顺序排列`);
    else at = found + part.length;
  });
  if (p.grammar.length < 1 || p.grammar.length > 3) problems.push(`grammar 要 1–3 个（现在 ${p.grammar.length} 个）`);
  p.grammar.forEach((g, i) => {
    if (!g.title.trim() || !g.explanation.trim()) problems.push(`grammar[${i + 1}] 要有 title 和 explanation`);
    if (g.text.trim() && !inSentence(g.text)) problems.push(`grammar[${i + 1}].text「${g.text}」不在原句里`);
  });
  if (p.alternatives.length > 3) problems.push("alternatives 最多 3 个");
  if (p.phrases.length > 4) problems.push("phrases 最多 4 个");
  p.phrases.forEach((x, i) => {
    if (!/^[A-Za-z'-]+( [A-Za-z'-]+){1,5}$/.test(x.base.trim())) problems.push(`phrases[${i + 1}].base「${x.base}」应是 2–6 个词的英文词组原形`);
    if (!x.meaning.trim()) problems.push(`phrases[${i + 1}] 缺少 meaning`);
  });
  if (p.pronunciation.length > 4) problems.push("pronunciation 最多 4 个");
  p.pronunciation.forEach((x, i) => {
    if (!inSentence(x.text)) problems.push(`pronunciation[${i + 1}].text「${x.text}」不在原句里`);
    if (!x.tip.trim()) problems.push(`pronunciation[${i + 1}] 缺少 tip`);
  });
  return problems.slice(0, 12);
}

export const submitSentenceAnalysisTool = defineTool({
  name: "submit_sentence_analysis",
  label: "提交句子分析",
  description: "Submit the analysis of one English sentence (pattern, parts, grammar, function, phrases, pronunciation). Fix only the listed problems if rejected.",
  parameters: SentenceAnalysisParams,
  async execute(_toolCallId, params) {
    const problems = sentenceAnalysisProblems(params);
    if (problems.length > 0) {
      throw new Error(`提交未通过校验（${problems.length} 处），请修正后重新提交：\n- ${problems.join("\n- ")}`);
    }
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});
