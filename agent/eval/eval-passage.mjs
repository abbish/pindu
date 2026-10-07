// 短文库评测：写短文（必用词覆盖、AI 挑词是否贴合场景、篇幅）→ 出一套阅读理解题（题量、空位是否在原文）→ 开放题评分（好 / 中 / 差三档是否单调）。
// 用法：先渲染提示词（见 lib.mjs），再 EVAL_MOONSHOT_KEY=... EVAL_PRESET=primary|secondary|adult node agent/eval/eval-passage.mjs
// 消息格式与 Rust agent::tasks::passage_message / passage_questions_message / passage_grade_message 一致。
import { EVAL_PRESET, promptFile, runTask, saveResult } from './lib.mjs';

const [minWords, maxWords] = { primary: [60, 100], secondary: [100, 160], adult: [100, 160] }[EVAL_PRESET];
const SCENE = `【单词本场景】
单词本：出国旅行
场景说明：出国旅行常用词，覆盖机场、海关、酒店、问路、点餐
（这是这些单词所在单词本的学习场景。一词多义时选这个场景里的意思；例句、讲解以这个场景为主，也可以有 1–2 处其它常见场景。场景与单词明显无关时按最常用的意思处理，不为贴合场景编造不常用的意思或用法。）`;
const REQUIRED = ['passport', 'customs', 'luggage'];
const POOL = ['gate', 'ticket', 'hotel', 'map', 'menu', 'delay', 'apple', 'homework', 'piano', 'visa'];
const OFF_SCENE = ['apple', 'homework', 'piano'];
const AI_PICK = 4;

const words = text => text.match(/[A-Za-z']+/g) ?? [];
const message = `${SCENE}\n\n必用词（${REQUIRED.length} 个，每个都要用上）：${REQUIRED.join(', ')}\n候选词（最多挑 ${AI_PICK} 个能自然融进故事的词）：${POOL.join(', ')}\n篇幅参考：约 ${minWords}–${maxWords} 个英文单词（为了自然用上所有必用词可以适当写长）`;
const gen = await runTask({ systemPrompt: promptFile('passage_generate.md'), tools: ['submit_passage'], message, thinking: 'medium' });
const call = gen.toolCalls.filter(c => c.name === 'submit_passage' && !c.isError).at(-1);
if (!call) { console.log('没有合格的短文', gen.error ?? gen.text); process.exit(1); }
const p = call.args;
const text = p.sentences.map(s => s.en).join(' ');
const offScene = p.chosen_words.filter(w => OFF_SCENE.includes(w));
console.log(`== ${EVAL_PRESET} 写短文：${(gen.ms / 1000).toFixed(1)}s，重交 ${gen.toolCalls.filter(c => c.isError).length} 次`);
console.log(`构思：${JSON.stringify(p.outline)}`);
console.log(`「${p.title}」${words(text).length} 词（参考 ${minWords}–${maxWords}）；AI 挑选 ${p.chosen_words.join(', ')}；场景外的词 ${offScene.length}`);
p.sentences.forEach((s, i) => console.log(`  ${i + 1}. ${s.en}`));

const spec = { cloze: 4, choice: 2, true_false: 2, open: 1 };
const qMessage = `短文《${p.title}》（逐句编号）：\n${p.sentences.map((s, i) => `${i + 1}. ${s.en}`).join('\n')}\n\n学习的目标词：${[...REQUIRED, ...p.chosen_words].join(', ')}\n\n题目数量：选词填空 ${spec.cloze} 空、选择题 ${spec.choice} 道、判断题 ${spec.true_false} 道、开放题 ${spec.open} 道\n难度：standard（标准）`;
const q = await runTask({ systemPrompt: promptFile('passage_questions.md'), tools: ['submit_questions'], message: qMessage });
const qs = q.toolCalls.filter(c => c.name === 'submit_questions' && !c.isError).at(-1)?.args;
if (!qs) { console.log('没有合格的题目', q.error ?? q.text); process.exit(1); }
const clozeInText = qs.cloze.filter(c => words(p.sentences[c.sentence - 1]?.en ?? '').some(w => w.toLowerCase() === c.word.toLowerCase()));
console.log(`== 出题：${(q.ms / 1000).toFixed(1)}s；空位在原文 ${clozeInText.length}/${qs.cloze.length}；干扰词 ${qs.cloze_distractors.join(', ')}`);
qs.choice.forEach(c => console.log(`  [选择] ${c.stem} | ${c.options.map((o, i) => (i === c.answer ? `*${o}` : o)).join(' / ')}`));
qs.true_false.forEach(t => console.log(`  [判断] ${t.statement} → ${t.answer}`));
const open = qs.open[0];
console.log(`  [开放] ${open.question}\n    参考：${open.reference_answer}`);

const answers = [open.reference_answer, 'I want go to Japan. It nice.', 'yes'];
const blocks = answers.map((a, i) => `第 ${i + 1} 题：${open.question}\n参考答案：${open.reference_answer}\n评分要点：${open.rubric.join('；')}\n学生的回答：${a}`);
const grade = await runTask({ systemPrompt: promptFile('passage_grade.md'), tools: ['submit_grade'], message: `短文：\n${text}\n\n${blocks.join('\n\n')}` });
const grades = (grade.toolCalls.filter(c => c.name === 'submit_grade' && !c.isError).at(-1)?.args?.grades ?? []).sort((a, b) => a.index - b.index);
const scores = grades.map(g => g.score);
console.log(`== 评分：${(grade.ms / 1000).toFixed(1)}s；${scores.join(' ≥ ')}（单调：${scores[0] >= scores[1] && scores[1] >= scores[2] ? '是' : '否'}）`);
saveResult(`passage-${EVAL_PRESET}`, { preset: EVAL_PRESET, generateMs: gen.ms, questionsMs: q.ms, chosen: p.chosen_words, offScene, clozeInText: clozeInText.length, scores, passage: p, questions: qs, grades });
