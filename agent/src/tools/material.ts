// 素材阅读任务的工具：pi 自主决定读文字层还是看页面图片，最后用 submit_material 交回结构化结果。
// 只能访问本次任务的工作目录（REDLARK_MATERIAL_DIR，由 Rust 准备并放好素材文件）；
// 当前模型不能看图时（REDLARK_MODEL_IMAGES=0），看图工具直接告诉模型改用文字工具。
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { PDFiumLibrary } from "@hyzyla/pdfium/inline";
import { encode } from "fast-png";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const TEXT_TYPES = new Set([".txt", ".md"]);
/** 单张图片上限：太大的照片模型也处理不了 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 一次读文字层最多返回的字符数 */
const MAX_TEXT_CHARS = 40_000;

const NO_VISION =
  "The current model cannot view images. Use read_pdf_text / read_text instead; if the material has no text layer (scanned pages or photos), submit what you can and explain in `note` that a model that can view images is needed.";

export function materialDir(): string {
  const dir = process.env.REDLARK_MATERIAL_DIR;
  if (!dir) throw new Error("material workspace is not configured");
  return dir;
}

export const canViewImages = () => process.env.REDLARK_MODEL_IMAGES === "1";

/** 只接受工作目录里的文件名（去掉任何路径部分，防止读到目录外） */
export function resolveFile(file: string, dir = materialDir()): string {
  const name = basename(file.trim());
  const path = join(dir, name);
  if (!name || name.startsWith(".") || !existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`no such file in the material folder: ${file}. Call list_material to see the files.`);
  }
  return path;
}

const text = (t: string) => ({ type: "text" as const, text: t });

let pdfium: Promise<PDFiumLibrary> | null = null;
const library = () => (pdfium ??= PDFiumLibrary.init({ disableBase64Warning: true }));

async function withPdf<T>(path: string, fn: (doc: Awaited<ReturnType<PDFiumLibrary["loadDocument"]>>) => Promise<T> | T): Promise<T> {
  const doc = await (await library()).loadDocument(readFileSync(path));
  try {
    return await fn(doc);
  } finally {
    doc.destroy();
  }
}

export const listMaterialTool = defineTool({
  name: "list_material",
  label: "查看素材文件",
  description:
    "List the files of this material (name, kind, size; for PDFs the page count and how much text each page's text layer has) and whether the current model can view images. Call this first.",
  parameters: Type.Object({}),
  async execute() {
    const dir = materialDir();
    const files = [];
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (name.startsWith(".") || !statSync(path).isFile()) continue;
      const ext = extname(name).toLowerCase();
      const size = statSync(path).size;
      if (ext === ".pdf") {
        const pages = await withPdf(path, (doc) => Array.from(doc.pages(), (p) => p.getText().trim().length));
        files.push({ name, kind: "pdf", size, pages: pages.length, textCharsPerPage: pages });
      } else if (IMAGE_TYPES[ext]) {
        files.push({ name, kind: "image", size });
      } else if (TEXT_TYPES.has(ext)) {
        files.push({ name, kind: "text", size });
      }
    }
    const result = { files, canViewImages: canViewImages() };
    return { content: [text(JSON.stringify(result))], details: result };
  },
});

export const readPdfTextTool = defineTool({
  name: "read_pdf_text",
  label: "读取 PDF 文字",
  description:
    "Read the text layer of PDF pages. The text layer of designed handouts is often out of order (columns interleaved, notes mixed into sentences); use it to confirm exact spelling, and view the page image to understand the layout.",
  parameters: Type.Object({
    file: Type.String(),
    pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { description: "1-based page numbers; omit for all pages" })),
  }),
  async execute(_id, { file, pages }) {
    const path = resolveFile(file);
    const out = await withPdf(path, (doc) => {
      const count = doc.getPageCount();
      const wanted = (pages?.length ? pages : Array.from({ length: count }, (_, i) => i + 1)).filter((p) => p <= count);
      let total = 0;
      const parts: string[] = [];
      for (const p of wanted) {
        const t = doc.getPage(p - 1).getText().replace(/\r\n/g, "\n").trim();
        if (total + t.length > MAX_TEXT_CHARS) {
          parts.push(`=== page ${p} === (stopped: too much text at once; request fewer pages)`);
          break;
        }
        total += t.length;
        parts.push(`=== page ${p} ===\n${t || "(no text layer on this page)"}`);
      }
      return parts.join("\n\n");
    });
    return { content: [text(out)], details: { file, pages } };
  },
});

export const viewPdfPageTool = defineTool({
  name: "view_pdf_page",
  label: "查看 PDF 页面",
  description: "Render one PDF page as an image and look at it (layout, underlines, notes beside words, tables, scanned pages).",
  parameters: Type.Object({
    file: Type.String(),
    page: Type.Integer({ minimum: 1, description: "1-based page number" }),
    scale: Type.Optional(Type.Number({ minimum: 1, maximum: 3, description: "zoom; default 1.6, use 2.5 to read small print" })),
  }),
  async execute(_id, { file, page, scale }) {
    if (!canViewImages()) return { content: [text(NO_VISION)], details: { refused: true, file, page } };
    const path = resolveFile(file);
    const png = await withPdf(path, async (doc) => {
      if (page > doc.getPageCount()) throw new Error(`page ${page} does not exist; the PDF has ${doc.getPageCount()} pages`);
      const img = await doc.getPage(page - 1).render({ scale: scale ?? 1.6, render: "bitmap" });
      return encode({ width: img.width, height: img.height, data: img.data, channels: 4 });
    });
    return {
      content: [text(`page ${page} of ${file}`), { type: "image" as const, data: Buffer.from(png).toString("base64"), mimeType: "image/png" }],
      details: { refused: false, file, page },
    };
  },
});

export const viewImageTool = defineTool({
  name: "view_image",
  label: "查看图片",
  description: "Look at an image file of the material (poster, photo, scanned page, picture extracted from a document).",
  parameters: Type.Object({ file: Type.String() }),
  async execute(_id, { file }) {
    if (!canViewImages()) return { content: [text(NO_VISION)], details: { refused: true, file } };
    const path = resolveFile(file);
    const mimeType = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mimeType) throw new Error(`${file} is not an image; supported: ${Object.keys(IMAGE_TYPES).join(" ")}`);
    if (statSync(path).size > MAX_IMAGE_BYTES) {
      return { content: [text(`${file} is larger than 8 MB and cannot be viewed; say so in note.`)], details: { refused: true, file } };
    }
    return {
      content: [text(file), { type: "image" as const, data: readFileSync(path).toString("base64"), mimeType }],
      details: { refused: false, file },
    };
  },
});

export const readTextTool = defineTool({
  name: "read_text",
  label: "读取文本文件",
  description: "Read a text file of the material (e.g. document.txt extracted from a Word file).",
  parameters: Type.Object({ file: Type.String() }),
  async execute(_id, { file }) {
    const path = resolveFile(file);
    if (!TEXT_TYPES.has(extname(path).toLowerCase())) throw new Error(`${file} is not a text file`);
    const body = readFileSync(path, "utf8");
    return { content: [text(body.length > MAX_TEXT_CHARS ? `${body.slice(0, MAX_TEXT_CHARS)}\n(truncated)` : body)], details: { file } };
  },
});

const MaterialSchema = Type.Object({
  title: Type.Optional(Type.String({ description: "title of the material in its original language, if it has one" })),
  passages: Type.Array(
    Type.Object({
      title: Type.Optional(Type.String()),
      sentences: Type.Array(
        Type.Object({
          en: Type.String({ description: "one English sentence copied exactly as printed (do not fix, shorten or paraphrase); join lines that wrap" }),
          zh: Type.Optional(Type.String({ description: "the Chinese translation printed in the material for this sentence; omit if the material has none — never translate yourself" })),
          paragraph: Type.Optional(Type.Integer({ minimum: 1, description: "paragraph number within this passage" })),
        }),
      ),
    }),
    { description: "the reading text(s) of the material in reading order; empty if the material is only a word list" },
  ),
  phrases: Type.Array(
    Type.Object({
      text: Type.String({ description: "the word or phrase exactly as written in a passage sentence (e.g. got through, air traffic control)" }),
      meaning: Type.String({ description: "the Chinese note printed for it in the material" }),
    }),
    { description: "words / phrases the material marks inside the text (underlined, highlighted, glossed); empty if none" },
  ),
  vocabulary: Type.Array(
    Type.Object({
      word: Type.String({ description: "the headword as printed" }),
      ipa: Type.Optional(Type.String({ description: "phonetic transcription as printed, without brackets" })),
      pos: Type.Optional(Type.String({ description: "part of speech as printed, e.g. n. / v. / adj." })),
      meaning: Type.Optional(Type.String({ description: "Chinese meaning as printed" })),
    }),
    { description: "a word list / vocabulary box / poster of the material; empty if none" },
  ),
  note: Type.Optional(Type.String({ description: "in Chinese, only when something could not be read or was skipped and the learner should know" })),
});

export type MaterialSubmission = Static<typeof MaterialSchema>;

/** 基本检查（Rust 侧另按文字层核对原文）：至少有短文或词汇；句子非空 */
export function checkMaterial(m: MaterialSubmission): string | null {
  const sentences = m.passages.flatMap((p) => p.sentences);
  if (sentences.length === 0 && m.vocabulary.length === 0) return "Nothing was submitted: include the passage sentences and/or the vocabulary list.";
  const empty = sentences.findIndex((s) => !s.en.trim());
  if (empty >= 0) return `Sentence ${empty + 1} has no English text.`;
  const notEnglish = sentences.findIndex((s) => !/[A-Za-z]/.test(s.en));
  if (notEnglish >= 0) return `Sentence ${notEnglish + 1} is not English: put Chinese translations in zh.`;
  return null;
}

export const submitMaterialTool = defineTool({
  name: "submit_material",
  label: "提交素材内容",
  description: "Submit the organized content of the material. Call exactly once at the end.",
  parameters: MaterialSchema,
  async execute(_id, params) {
    const problem = checkMaterial(params);
    if (problem) throw new Error(`提交未通过校验，请修正后重新提交：${problem}`);
    return { content: [text("Received.")], details: params, terminate: true };
  },
});

export const MATERIAL_TOOLS = [listMaterialTool, readPdfTextTool, viewPdfPageTool, viewImageTool, readTextTool, submitMaterialTool];
