// 例句补充提示词试跑：给定单词与已有例句，跑一次 submit_examples，打印新例句与校验退回次数。
// 用法：EVAL_MOONSHOT_KEY=... node agent/eval/eval-examples.mjs [thinking]
import { promptFile, runTask } from './lib.mjs';

const thinking = process.argv[2] ?? 'low';
const cases = [
  { word: 'all', meaning: '全部', pos: '限定词', existing: [['All the students are in class.', '所有的学生都在教室里。']] },
  { word: 'rain', meaning: '雨', pos: '名词', existing: [] },
];
for (const c of cases) {
  const message = [`单词：${c.word}`, `中文释义：${c.meaning}`, `词性：${c.pos}`,
    c.existing.length ? '已有例句：' : '已有例句：无', ...c.existing.map(([en, zh], i) => `${i + 1}. ${en} —— ${zh}`),
    '本次任务：补充 5–8 条新例句，场景和句式都要与已有例句不同。'].join('\n');
  const r = await runTask({ systemPrompt: promptFile('word_examples.md'), tools: ['submit_examples'], thinking, message });
  const calls = r.toolCalls.filter(t => t.name === 'submit_examples');
  const ok = calls.find(t => !t.isError);
  console.log(`\n== ${c.word}  ${(r.ms / 1000).toFixed(1)}s  退回 ${calls.filter(t => t.isError).length} 次  $${r.stats?.cost?.toFixed(4)}`);
  for (const e of ok?.args?.examples ?? []) console.log(`  ${e.sentence} | ${e.translation}`);
  if (r.error) console.log('  错误：', r.error);
}
