// AI 老师答疑试跑：同一个单词问几个问题（含跑题），打印回答、长度与耗时。
// 用法：EVAL_MOONSHOT_KEY=... node agent/eval/eval-tutor.mjs [thinking]
import { promptFile, runTask } from './lib.mjs';

const thinking = process.argv[2] ?? 'low';
const facts = ['【单词资料】', '单词：ways', '中文释义：方法', '词性：名词', '音标：/weɪz/', '音节：ways',
  '拼读规则：Vowel Teams | 元音组合', '已有例句：', '1. There are many ways to learn. —— 学习有很多方法。'].join('\n');
const questions = [
  '我刚才写成了 way，为什么要加 s？',
  'way 和 ways 有什么不一样？可以举个例子吗',
  '你喜欢玩游戏吗？我家住在哪里你知道吗',
];
for (const q of questions) {
  const r = await runTask({ systemPrompt: promptFile('word_tutor.md'), tools: [], thinking, message: `${facts}\n\n【学生这次的问题】\n${q}` });
  console.log(`\n== ${q}  (${(r.ms / 1000).toFixed(1)}s, ${[...r.text].length} 字)\n${r.text.trim()}`);
}
