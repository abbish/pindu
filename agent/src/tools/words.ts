// 提词任务工具：tokenize_text（确定性分词计数）、submit_words（结构化交付，terminate 结束本轮）
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
        word: Type.String({ description: "dictionary form: lowercase, except proper nouns keep their capital letter (e.g. Tom, Sunday)" }),
        frequency: Type.Integer({ minimum: 1, description: "taken from tokenize_text" }),
        pos: Type.String({ description: "part of speech abbreviation: n. v. adj. adv. prep. conj. pron. art. int. det." }),
        translation: Type.String({ description: "concise common Chinese meaning, 1-3 characters" }),
      }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "1-3 reusable Chinese tags (scene or topic, e.g. 出国旅行 / 点餐 / 动物), each at most 10 characters; reuse existing tag names from the user message when they fit",
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
        word: Type.String({ description: "one English word in dictionary form (no phrases): lowercase, except proper nouns keep their capital letter" }),
        pos: Type.String({ description: "part of speech abbreviation: n. v. adj. adv. prep. conj. pron. int. num." }),
        translation: Type.String({ description: "concise Chinese meaning in this topic, 2-4 characters" }),
      }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "1-3 reusable Chinese tags (scene or topic, e.g. 出国旅行 / 点餐 / 动物), each at most 10 characters; reuse existing tag names from the user message when they fit",
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
