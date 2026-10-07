// RedLark 自定义工具（pi 扩展）。spike 只开放这些工具，内置 read/bash/edit/write 等全部不加载。
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** A：提词结果。模型必须调用一次；terminate 结束本轮，不再追加一次 LLM 回复 */
const submitWords = defineTool({
  name: "submit_words",
  label: "提交单词列表",
  description:
    "Submit the final extracted word list. Call exactly once with ALL words. Do not output the list as text.",
  parameters: Type.Object({
    words: Type.Array(
      Type.Object({
        word: Type.String({ description: "word as it appears (letters only)" }),
        frequency: Type.Integer({ minimum: 1 }),
        pos: Type.String({ description: "part of speech abbreviation, e.g. n. v. adj." }),
        translation: Type.String({ description: "concise Chinese meaning, 1-3 characters" }),
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

/** A'：确定性分词与计数交给代码，模型只做筛选与标注（与 lib/reference.mjs 同规则） */
const tokenizeText = defineTool({
  name: "tokenize_text",
  label: "分词计数",
  description:
    "Deterministically tokenize the given English text and count word frequencies (lowercased, letters only, length 2-20, numbers removed). Use this instead of counting yourself.",
  parameters: Type.Object({ text: Type.String() }),
  async execute(_toolCallId, { text }) {
    const counts: Record<string, number> = {};
    for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (/[0-9]/.test(raw) || raw.length < 2 || raw.length > 20) continue;
      counts[raw] = (counts[raw] ?? 0) + 1;
    }
    return { content: [{ type: "text", text: JSON.stringify(counts) }], details: counts };
  },
});

// B：场景对话 / 练习助手用的工具（数据为 spike 内置小词典，真实实现由 RedLark 后端提供）
const DICTIONARY: Record<string, { ipa: string; meaning: string; syllables: string }> = {
  elephant: { ipa: "/ˈelɪfənt/", meaning: "大象", syllables: "el-e-phant" },
  giraffe: { ipa: "/dʒəˈrɑːf/", meaning: "长颈鹿", syllables: "gi-raffe" },
  zebra: { ipa: "/ˈzebrə/", meaning: "斑马", syllables: "ze-bra" },
  ticket: { ipa: "/ˈtɪkɪt/", meaning: "票", syllables: "tick-et" },
  hungry: { ipa: "/ˈhʌŋɡri/", meaning: "饿的", syllables: "hun-gry" },
};

const lookupWord = defineTool({
  name: "lookup_word",
  label: "查词",
  description:
    "Look up a word in the student's dictionary to get IPA, Chinese meaning and syllables. Use it before explaining a word.",
  parameters: Type.Object({ word: Type.String() }),
  async execute(_toolCallId, { word }) {
    const entry = DICTIONARY[word.toLowerCase()];
    return {
      content: [{ type: "text", text: entry ? JSON.stringify({ word, ...entry }) : `No entry for "${word}".` }],
      details: entry ?? null,
    };
  },
});

const recordMistake = defineTool({
  name: "record_mistake",
  label: "记录错误",
  description:
    "Record a language mistake the student made (spelling, grammar or word choice) so it can be practised later. Call once per mistake.",
  parameters: Type.Object({
    wrong: Type.String({ description: "what the student wrote" }),
    correct: Type.String({ description: "the corrected form" }),
    kind: Type.Union([Type.Literal("spelling"), Type.Literal("grammar"), Type.Literal("word_choice")]),
  }),
  async execute(_toolCallId, params) {
    return { content: [{ type: "text", text: "Recorded." }], details: params };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(submitWords);
  pi.registerTool(tokenizeText);
  pi.registerTool(lookupWord);
  pi.registerTool(recordMistake);
}
