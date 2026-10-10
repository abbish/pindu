// 提词任务工具：tokenize_text（确定性分词计数）、submit_words（结构化交付，terminate 结束本轮）
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { tokenizeWords } from "./tokenize.ts";

export const tokenizeTextTool = defineTool({
  name: "tokenize_text",
  label: "分词计数",
  description:
    "Deterministically tokenize English text and count word frequencies (lowercased, letters only, length 2-20, fragments joined with digits removed). Always use this instead of counting yourself.",
  parameters: Type.Object({ text: Type.String({ description: "the complete original text" }) }),
  async execute(_toolCallId, { text }) {
    const counts = tokenizeWords(text);
    return { content: [{ type: "text", text: JSON.stringify(counts) }], details: counts };
  },
});

export const submitWordsTool = defineTool({
  name: "submit_words",
  label: "提交单词列表",
  description:
    "Submit the final word list. Call exactly once with ALL selected words; never print the list as text.",
  parameters: Type.Object({
    words: Type.Array(
      Type.Object({
        word: Type.String({ description: "dictionary form: lowercase, except proper nouns keep their capital letter (e.g. Tom, Sunday); may also be a phrase worth learning as a whole (phrasal verb / collocation / idiom), in base form (gave up → give up)" }),
        frequency: Type.Integer({ minimum: 1, description: "taken from tokenize_text (phrases: how many times it appears)" }),
        pos: Type.String({ description: "part of speech abbreviation: n. v. adj. adv. prep. conj. pron. art. int. det." }),
        translation: Type.String({ description: "concise common Chinese meaning, 1-3 characters" }),
        uses: Type.Optional(Type.Array(Type.String(), { description: "for a phrase: how it is written in the text, copied exactly (e.g. picked them up); one entry per distinct writing" })),
      }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "1-3 reusable Chinese tags (scene or topic, e.g. 旅行 / 点餐 / 动物), each at most 10 characters; pick from the existing tags listed in the user message first; create a new tag only when none fits, and never a synonym or a broader/narrower variant of an existing one (existing 旅行 → use 旅行, not 出国旅行)",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Received ${params.words.length} words.` }],
      details: params,
      terminate: true,
    };
  },
});

export const submitGeneratedWordsTool = defineTool({
  name: "submit_generated_words",
  label: "提交生成的单词",
  description:
    "Submit the generated vocabulary list. Call exactly once with ALL words, most important first; never print the list as text.",
  parameters: Type.Object({
    words: Type.Array(
      Type.Object({
        word: Type.String({ description: "one English word, or a phrase worth learning as a whole (phrasal verb / collocation / idiom / fixed phrase), in dictionary form: lowercase, except proper nouns keep their capital letter" }),
        pos: Type.String({ description: "part of speech abbreviation: n. v. adj. adv. prep. conj. pron. int. num." }),
        translation: Type.String({ description: "concise Chinese meaning in this topic, 2-4 characters" }),
      }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "1-3 reusable Chinese tags (scene or topic, e.g. 旅行 / 点餐 / 动物), each at most 10 characters; pick from the existing tags listed in the user message first; create a new tag only when none fits, and never a synonym or a broader/narrower variant of an existing one (existing 旅行 → use 旅行, not 出国旅行)",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Received ${params.words.length} words.` }],
      details: params,
      terminate: true,
    };
  },
});

// ---------- submit_topic_suggestions：按词汇本场景给词汇需求的建议 ----------

const TopicSuggestionsParams = Type.Object({
  suggestions: Type.Array(Type.String(), { description: "4-6 Chinese sub-topics of this word book's scene (6-20 characters each), each usable as a request to generate a batch of words" }),
});
export type TopicSuggestionsSubmission = Static<typeof TopicSuggestionsParams>;

export function topicSuggestionsProblems(p: TopicSuggestionsSubmission): string[] {
  const problems: string[] = [];
  const items = p.suggestions.map((s) => s.trim()).filter(Boolean);
  if (items.length < 4 || items.length > 6) problems.push(`建议要 4–6 条（现在 ${items.length} 条）`);
  items.forEach((s, i) => {
    const n = [...s].length;
    if (n < 4 || n > 24) problems.push(`第 ${i + 1} 条「${s}」长度不合适（6–20 个字）`);
  });
  if (new Set(items).size !== items.length) problems.push("有重复的建议");
  return problems;
}

export const submitTopicSuggestionsTool = defineTool({
  name: "submit_topic_suggestions",
  label: "提交词汇需求建议",
  description: "Submit 4-6 Chinese sub-topics of this word book's scene. Fix only the listed problems if rejected.",
  parameters: TopicSuggestionsParams,
  async execute(_toolCallId, params) {
    const problems = topicSuggestionsProblems(params);
    if (problems.length > 0) {
      throw new Error(`提交未通过校验（${problems.length} 处），请修正后重新提交：\n- ${problems.join("\n- ")}`);
    }
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});
