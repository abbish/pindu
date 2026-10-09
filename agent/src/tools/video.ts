// 视频库的工具：submit_video_plan（规划场景切分）。
// 校验不通过时抛错，模型看到问题列表后只改被指出的地方再重交；Rust 侧（services::video_plan）会按字幕时间再换算与校正。

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const LEVELS = ["a1", "a2", "b1", "b2", "c1"];

const VideoPlanParams = Type.Object({
  cue_count: Type.Integer({ description: "copy of the total number of subtitle lines in the user message" }),
  segments: Type.Array(
    Type.Object({
      first: Type.Integer({ description: "number of the first subtitle line in this segment" }),
      last: Type.Integer({ description: "number of the last subtitle line in this segment (inclusive)" }),
      title: Type.String({ description: "short English title, at most 8 words" }),
      scene: Type.String({ description: "Chinese scene name, at most 10 characters" }),
      level: Type.String({ description: "CEFR level: a1, a2, b1, b2 or c1" }),
      focus: Type.String({ description: "one Chinese sentence: what this segment is good for learning" }),
      key_words: Type.Array(Type.String(), { description: "3-8 key words or phrases that appear in this segment's subtitles, base form" }),
      tags: Type.Array(Type.String(), { description: "1-3 reusable Chinese tags (scene type, communicative function or language point), each at most 10 characters; reuse existing tag names when they fit" }),
    }),
    { description: "segments in order, not overlapping; empty only when nothing in the given subtitles suits the learner" },
  ),
});
export type VideoPlanSubmission = Static<typeof VideoPlanParams>;

/** 返回不合格项的说明；空数组表示通过 */
export function videoPlanProblems(p: VideoPlanSubmission): string[] {
  const problems: string[] = [];
  let previousLast = 0;
  p.segments.forEach((s, i) => {
    const n = i + 1;
    if (s.first < 1 || s.last > p.cue_count) problems.push(`第 ${n} 段的字幕编号超出范围（1–${p.cue_count}）`);
    if (s.first > s.last) problems.push(`第 ${n} 段的 first 大于 last`);
    if (previousLast > 0 && s.first <= previousLast) problems.push(`第 ${n} 段和前一段重叠或顺序不对（应从第 ${previousLast + 1} 条之后开始）`);
    previousLast = Math.max(previousLast, s.last);
    if (!s.title.trim()) problems.push(`第 ${n} 段缺少 title`);
    if (!s.scene.trim()) problems.push(`第 ${n} 段缺少 scene`);
    if (!LEVELS.includes(s.level.trim().toLowerCase())) problems.push(`第 ${n} 段的 level 只能是 a1、a2、b1、b2、c1 之一`);
    if (!s.focus.trim()) problems.push(`第 ${n} 段缺少 focus`);
    if (s.key_words.length > 10) problems.push(`第 ${n} 段的 key_words 最多 10 个`);
    if (s.tags.length === 0 || s.tags.length > 3) problems.push(`第 ${n} 段的 tags 要 1–3 个`);
    s.tags.forEach((t) => {
      if ([...t.trim()].length > 10) problems.push(`第 ${n} 段的标签「${t}」超过 10 个字`);
    });
  });
  return problems;
}

export const submitVideoPlanTool = defineTool({
  name: "submit_video_plan",
  label: "提交切分规划",
  description:
    "Submit all segments of the video plan in one call. Each segment is a continuous range of subtitle lines. The submission is validated; if it returns errors, fix only the listed problems and call again.",
  parameters: VideoPlanParams,
  async execute(_toolCallId, params) {
    const problems = videoPlanProblems(params);
    if (problems.length > 0) {
      throw new Error(`提交未通过校验（${problems.length} 处），请修正后重新提交：\n- ${problems.join("\n- ")}`);
    }
    return { content: [{ type: "text", text: "Accepted." }], details: params, terminate: true };
  },
});
