// 短文库的工具：submit_passage（写短文）、submit_questions（出一套阅读理解题）、submit_grade（开放题评分）、submit_translation（导入材料逐句翻译）。
// 校验不通过时抛错，模型看到问题列表后只改被指出的地方再重交；Rust 侧（services::passage_rules）会按请求再校验一次。

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

/** token 是否是 word 本身或常见屈折形式（与 Rust passage_rules::inflection_matches 同规则） */
export function inflectionMatches(token: string, word: string): boolean {
  const t = token.trim().toLowerCase();
  const w = word.trim().toLowerCase();
  if (!t || !w) return false;
  if (t === w) return true;
  if (["s", "es", "ed", "d", "ing", "er", "est"].some(s => t === w + s)) return true;
  if (w.endsWith("e") && ["ing", "ed", "er", "est"].some(s => t === w.slice(0, -1) + s)) return true;
  if (w.endsWith("y") && ["ies", "ied", "ier", "iest"].some(s => t === w.slice(0, -1) + s)) return true;
  const last = w[w.length - 1];
  return !"aeiouwxy".includes(last) && ["ing", "ed", "er", "est"].some(s => t === w + last + s);
}

const wordsOf = (text: string) => (text.match(/[A-Za-z']+/g) ?? []).map(w => w.replace(/^'+|'+$/g, "")).filter(Boolean);
const uses = (tokens: string[], word: string) => tokens.some(t => inflectionMatches(t, word));
const fail = (problems: string[]) => {
  throw new Error(`提交未通过校验（${problems.length} 处），请修正后重新提交：\n- ${problems.join("\n- ")}`);
};

// ==================== submit_passage ====================

const PassageParams = Type.Object({
  required_words: Type.Array(Type.String(), { description: "copy of the required word list from the user message" }),
  ai_pick: Type.Integer({ description: "copy of how many extra words you must choose from the candidate pool" }),
  min_words: Type.Integer({ description: "copy of the minimum English word count" }),
  max_words: Type.Integer({ description: "copy of the maximum English word count" }),
  outline: Type.Object(
    {
      goal: Type.String({ description: "who the main character is and what they want or plan to do" }),
      problem: Type.String({ description: "the small problem, surprise or misunderstanding at the heart of the story" }),
      turn: Type.String({ description: "how it develops or gets solved (who helps, what is discovered)" }),
      ending: Type.String({ description: "a satisfying ending: what changes, what the character feels or learns" }),
    },
    { description: "plan the story BEFORE writing the sentences; the passage must follow this outline" },
  ),
  title: Type.String({ description: "short English title" }),
  sentences: Type.Array(
    Type.Object({
      en: Type.String({ description: "one English sentence" }),
      zh: Type.String({ description: "natural Chinese translation of the sentence" }),
    }),
  ),
  chosen_words: Type.Array(Type.String(), { description: "the words you chose from the candidate pool and used in the passage (exact spelling from the pool)" }),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "1-3 reusable Chinese tags for this passage (scene or topic, e.g. 旅行 / 点餐 / 校园生活), each at most 10 characters; pick from the existing tags listed in the user message first; create a new tag only when none fits, and never a synonym or a broader/narrower variant of an existing one (existing 旅行 → use 旅行, not 出国旅行)",
    }),
  ),
});
export type PassageSubmission = Static<typeof PassageParams>;

/** 返回不合格项的说明；空数组表示通过 */
export function passageProblems(p: PassageSubmission): string[] {
  const problems: string[] = [];
  if (!p.title.trim()) problems.push("title 不能为空");
  for (const key of ["goal", "problem", "turn", "ending"] as const) {
    if (!p.outline?.[key]?.trim()) problems.push(`outline.${key} 不能为空：先构思故事（主角想做什么、遇到什么麻烦、怎么发展、怎么收尾）再写句子`);
  }
  if (p.sentences.length < 3) problems.push("sentences 至少 3 句");
  p.sentences.forEach((s, i) => {
    if (!s.en.trim()) problems.push(`sentences[${i + 1}].en 为空`);
    if (!s.zh.trim()) problems.push(`sentences[${i + 1}].zh 缺少中文翻译`);
  });
  const tokens = p.sentences.flatMap(s => wordsOf(s.en));
  const missing = p.required_words.filter(w => w.trim() && !uses(tokens, w));
  if (missing.length > 0) problems.push(`正文没有用到这些必用词：${missing.join(", ")}（每个都要用上）`);
  if (p.chosen_words.length > p.ai_pick) problems.push(`chosen_words 最多 ${p.ai_pick} 个（当前 ${p.chosen_words.length} 个）`);
  const unused = p.chosen_words.filter(w => !uses(tokens, w));
  if (unused.length > 0) problems.push(`chosen_words 里这些词没有出现在正文中：${unused.join(", ")}`);
  // 篇幅只是长度与丰富程度的参考：只拦明显没写完整的短文，不按区间退回（避免为凑字数改写出模式化的句子）
  const count = tokens.length;
  if (p.min_words > 0 && count < p.min_words * 0.6) {
    problems.push(`短文只有 ${count} 个英文单词，明显短于参考篇幅（约 ${p.min_words}–${p.max_words}），请把故事写完整`);
  }
  return problems;
}

export const submitPassageTool = defineTool({
  name: "submit_passage",
  label: "提交短文",
  description:
    "Submit the reading passage (title, sentences with translations, chosen words) in one call. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: PassageParams,
  async execute(_toolCallId, params) {
    const problems = passageProblems(params);
    if (problems.length > 0) fail(problems);
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});

// ==================== submit_passage_plan ====================

const Outline = Type.Object({
  goal: Type.String({ description: "主角与目标（中文一句）" }),
  problem: Type.String({ description: "麻烦或意外（中文一句）" }),
  turn: Type.String({ description: "怎么发展或解决（中文一句）" }),
  ending: Type.String({ description: "怎样收尾（中文一句）" }),
});

const PlanParams = Type.Object({
  required_words: Type.Array(Type.String(), { description: "copy of the required word list from the user message" }),
  ai_pick: Type.Integer({ description: "copy of the max number of candidate words you may choose" }),
  note: Type.String({ description: "一两句中文：为什么这样规划" }),
  passages: Type.Array(
    Type.Object({
      title: Type.String({ description: "English title" }),
      outline: Outline,
      words: Type.Array(Type.String(), { description: "required words + chosen candidate words used in THIS passage" }),
      length: Type.String({ description: "short / standard / long" }),
    }),
    { description: "1-4 passages" },
  ),
});
export type PlanSubmission = Static<typeof PlanParams>;

export function planProblems(p: PlanSubmission): string[] {
  const problems: string[] = [];
  if (p.passages.length < 1 || p.passages.length > 4) problems.push(`passages 需要 1–4 篇（当前 ${p.passages.length} 篇）`);
  if (!p.note.trim()) problems.push("note 不能为空：用一两句中文说明为什么这样规划");
  const seen = new Map<string, number>();
  p.passages.forEach((ps, i) => {
    const where = `passages[${i + 1}]`;
    if (!ps.title.trim()) problems.push(`${where}.title 不能为空`);
    for (const key of ["goal", "problem", "turn", "ending"] as const) {
      if (!ps.outline?.[key]?.trim()) problems.push(`${where}.outline.${key} 不能为空`);
    }
    if (!["short", "standard", "long"].includes(ps.length)) problems.push(`${where}.length 应为 short / standard / long`);
    if (ps.words.length === 0) problems.push(`${where}.words 不能为空`);
    ps.words.forEach(w => {
      const key = w.trim().toLowerCase();
      if (seen.has(key)) problems.push(`「${w}」同时出现在第 ${seen.get(key)} 篇和第 ${i + 1} 篇，每个词只放进一篇`);
      else seen.set(key, i + 1);
    });
  });
  const missing = p.required_words.filter(w => !seen.has(w.trim().toLowerCase()));
  if (missing.length > 0) problems.push(`这些必用词没有分到任何一篇：${missing.join(", ")}`);
  const required = new Set(p.required_words.map(w => w.trim().toLowerCase()));
  const extra = [...seen.keys()].filter(w => !required.has(w));
  if (extra.length > p.ai_pick) problems.push(`从候选词里最多挑 ${p.ai_pick} 个（当前 ${extra.length} 个：${extra.join(", ")}）`);
  return problems;
}

export const submitPassagePlanTool = defineTool({
  name: "submit_passage_plan",
  label: "提交内容规划",
  description: "Submit the content plan (how many passages, each passage's outline and words) in one call. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: PlanParams,
  async execute(_toolCallId, params) {
    const problems = planProblems(params);
    if (problems.length > 0) fail(problems);
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});

// ==================== submit_questions ====================

const QuestionParams = Type.Object({
  expected: Type.Object(
    {
      cloze: Type.Integer(),
      choice: Type.Integer(),
      true_false: Type.Integer(),
      open: Type.Integer(),
    },
    { description: "copy of the requested question counts from the user message" },
  ),
  cloze: Type.Array(
    Type.Object({
      sentence: Type.Integer({ description: "sentence number from the user message, starting at 1" }),
      word: Type.String({ description: "the word to blank out, spelled exactly as in that sentence" }),
      hint: Type.Optional(Type.String({ description: "short Chinese hint, e.g. 名词：海关" })),
    }),
  ),
  cloze_distractors: Type.Array(Type.String(), { description: "1-3 extra English words for the word bank that do NOT fit any blank" }),
  choice: Type.Array(
    Type.Object({
      stem: Type.String(),
      options: Type.Array(Type.String(), { description: "3-4 options" }),
      answer: Type.Integer({ description: "index of the correct option, starting at 0" }),
      explanation: Type.String({ description: "short Chinese explanation pointing to the evidence in the passage" }),
    }),
  ),
  true_false: Type.Array(
    Type.Object({
      statement: Type.String(),
      answer: Type.Boolean(),
      explanation: Type.String({ description: "short Chinese explanation" }),
    }),
  ),
  open: Type.Array(
    Type.Object({
      question: Type.String(),
      reference_answer: Type.String(),
      rubric: Type.Array(Type.String(), { description: "2-4 scoring points in Chinese" }),
    }),
  ),
});
export type QuestionSubmission = Static<typeof QuestionParams>;

export function questionProblems(q: QuestionSubmission): string[] {
  const problems: string[] = [];
  const count = (name: string, got: number, want: number) => {
    if (got !== want) problems.push(`${name} 需要 ${want} 道（当前 ${got} 道）`);
  };
  count("cloze（选词填空）", q.cloze.length, q.expected.cloze);
  count("choice（选择题）", q.choice.length, q.expected.choice);
  count("true_false（判断题）", q.true_false.length, q.expected.true_false);
  count("open（开放题）", q.open.length, q.expected.open);
  const blanked = new Set<string>();
  q.cloze.forEach((c, i) => {
    const key = c.word.trim().toLowerCase();
    if (c.sentence < 1) problems.push(`cloze[${i + 1}].sentence 从 1 开始`);
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(c.word.trim())) problems.push(`cloze[${i + 1}].word 应是一个英文单词`);
    if (blanked.has(key)) problems.push(`cloze 里的「${c.word}」重复了，每个词只挖一次`);
    blanked.add(key);
  });
  if (q.expected.cloze > 0 && q.cloze_distractors.length === 0) problems.push("cloze_distractors 需要 1–3 个干扰词");
  q.cloze_distractors.forEach(d => {
    if (blanked.has(d.trim().toLowerCase())) problems.push(`干扰词「${d}」与空位答案重复`);
  });
  q.choice.forEach((c, i) => {
    const where = `choice[${i + 1}]`;
    if (!c.stem.trim()) problems.push(`${where}.stem 为空`);
    const options = c.options.map(o => o.trim().toLowerCase());
    if (options.length < 3 || options.length > 4) problems.push(`${where} 需要 3–4 个选项`);
    if (new Set(options).size !== options.length || options.some(o => !o)) problems.push(`${where} 选项不能为空或重复`);
    if (!(c.answer >= 0 && c.answer < c.options.length)) problems.push(`${where}.answer 应是正确选项的下标（从 0 开始）`);
  });
  q.true_false.forEach((t, i) => {
    if (!t.statement.trim()) problems.push(`true_false[${i + 1}].statement 为空`);
  });
  if (q.true_false.length >= 2 && q.true_false.every(t => t.answer === q.true_false[0].answer)) {
    problems.push("判断题的答案要有对也有错");
  }
  q.open.forEach((o, i) => {
    if (!o.question.trim() || !o.reference_answer.trim()) problems.push(`open[${i + 1}] 需要题目和参考答案`);
    if (o.rubric.length < 2 || o.rubric.length > 4) problems.push(`open[${i + 1}].rubric 需要 2–4 条评分要点`);
  });
  return problems;
}

export const submitQuestionsTool = defineTool({
  name: "submit_questions",
  label: "提交阅读理解题",
  description:
    "Submit ALL questions of the set in one call. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: QuestionParams,
  async execute(_toolCallId, params) {
    const problems = questionProblems(params);
    if (problems.length > 0) fail(problems);
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});

// ==================== submit_grade ====================

const GradeParams = Type.Object({
  grades: Type.Array(
    Type.Object({
      index: Type.Integer({ description: "the answer number from the user message, starting at 1" }),
      score: Type.Integer({ description: "0-4" }),
      feedback: Type.String({ description: "1-3 short sentences: what is good and what to improve" }),
      suggestion: Type.Optional(Type.String({ description: "an improved version of the student's answer" })),
    }),
  ),
});

export const submitGradeTool = defineTool({
  name: "submit_grade",
  label: "提交评分",
  description: "Submit the scores and feedback for ALL answers in one call.",
  parameters: GradeParams,
  async execute(_toolCallId, params) {
    const problems: string[] = [];
    if (params.grades.length === 0) problems.push("grades 为空");
    params.grades.forEach(g => {
      if (g.score < 0 || g.score > 4) problems.push(`第 ${g.index} 题 score 应为 0–4`);
      if (!g.feedback.trim()) problems.push(`第 ${g.index} 题缺少 feedback`);
    });
    if (problems.length > 0) fail(problems);
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});

// ==================== submit_translation ====================

const LEVELS = ["a1", "a2", "b1", "b2"];

const TranslationParams = Type.Object({
  expected_count: Type.Integer({ description: "total number of sentences in the user message" }),
  translations: Type.Array(
    Type.Object({
      index: Type.Integer({ description: "sentence number from the user message, starting at 1" }),
      zh: Type.String({ description: "Chinese translation of that sentence" }),
    }),
  ),
  title: Type.String({ description: "short English title (copy the given title if there is one)" }),
  level: Type.String({ description: "CEFR level: a1, a2, b1 or b2" }),
  key_words: Type.Array(
    Type.Object({
      word: Type.String({ description: "base form of a word that appears in the text" }),
      meaning: Type.String({ description: "Chinese meaning in this text" }),
    }),
    { description: "5-12 key words when requested, otherwise an empty array" },
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "1-3 reusable Chinese tags for this passage (scene or topic, e.g. 旅行 / 点餐 / 校园生活), each at most 10 characters; pick from the existing tags listed in the user message first; create a new tag only when none fits, and never a synonym or a broader/narrower variant of an existing one (existing 旅行 → use 旅行, not 出国旅行)",
    }),
  ),
});
export type TranslationSubmission = Static<typeof TranslationParams>;

export function translationProblems(t: TranslationSubmission): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  t.translations.forEach(item => {
    if (item.index < 1 || item.index > t.expected_count) problems.push(`translations 里的编号 ${item.index} 超出范围（1–${t.expected_count}）`);
    else if (seen.has(item.index)) problems.push(`第 ${item.index} 句译了两次`);
    seen.add(item.index);
    if (!item.zh.trim()) problems.push(`第 ${item.index} 句译文为空`);
  });
  const missing: number[] = [];
  for (let i = 1; i <= t.expected_count; i++) if (!seen.has(i)) missing.push(i);
  if (missing.length > 0) problems.push(`缺少这些句子的译文：${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " …" : ""}`);
  if (!t.title.trim()) problems.push("title 为空");
  if (!LEVELS.includes(t.level.trim().toLowerCase())) problems.push("level 只能是 a1、a2、b1、b2 之一");
  t.key_words.forEach((k, i) => {
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(k.word.trim())) problems.push(`key_words[${i + 1}].word 应是一个英文单词`);
    if (!k.meaning.trim()) problems.push(`key_words[${i + 1}] 缺少中文意思`);
  });
  if (t.key_words.length > 12) problems.push("key_words 最多 12 个");
  return problems;
}

export const submitTranslationTool = defineTool({
  name: "submit_translation",
  label: "提交译文",
  description:
    "Submit the Chinese translation of EVERY sentence, the title, the level and the key words in one call. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: TranslationParams,
  async execute(_toolCallId, params) {
    const problems = translationProblems(params);
    if (problems.length > 0) fail(problems);
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});
