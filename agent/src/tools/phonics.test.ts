import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type PhonicsEntry, sentenceContainsWord, validatePhonics } from './phonics.ts';

const FIVE = [
  { sentence: 'Mom is baking a cake.', translation: '妈妈正在烤蛋糕。' },
  { sentence: 'We are baking cookies today.', translation: '我们今天在烤饼干。' },
  { sentence: 'Dad likes baking bread.', translation: '爸爸喜欢烤面包。' },
  { sentence: 'The kitchen smells good when Grandma is baking.', translation: '奶奶烘焙时厨房很香。' },
  { sentence: 'Baking is fun for kids.', translation: '烘焙对孩子来说很有趣。' },
];
const tomFive = FIVE.map((e, i) => ({ sentence: `Tom is my friend number ${['one', 'two', 'three', 'four', 'five'][i]}.`, translation: '汤姆是我的朋友。' }));

const entry = (patch: Partial<PhonicsEntry> = {}): PhonicsEntry => ({
  word: 'baking', chinese_translation: '烘烤', pos_abbreviation: 'v.', pos_english: 'Verb', pos_chinese: '动词',
  ipa: '/ˈbeɪkɪŋ/', syllables: 'ba-king', phonics_rule: 'VCE Pattern | 魔法e规则',
  analysis_explanation: '词根 bake 遵循魔法 e 规则。',
  examples: FIVE, ...patch,
});

test('合格条目通过', () => {
  assert.deepEqual(validatePhonics([entry(), entry({ word: 'Tom', syllables: 'Tom', ipa: '/tɒm/', phonics_rule: 'CVC Pattern | 短元音规则', examples: tomFive })]), []);
});

test('音节拼回单词、音标斜杠、规则表、必填字段', () => {
  const problems = validatePhonics([
    entry({ syllables: 'ba-kin' }),
    entry({ ipa: 'ˈbeɪkɪŋ' }),
    entry({ phonics_rule: 'Magic E' }),
    entry({ chinese_translation: ' ' }),
  ]);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /syllables/);
  assert.match(problems[1], /ipa/);
  assert.match(problems[2], /规则表/);
  assert.match(problems[3], /chinese_translation/);
});

test('空提交不通过', () => {
  assert.equal(validatePhonics([]).length, 1);
});

test('例句：条数、包含单词、长度、句式、中文翻译、不重复', () => {
  const withFirst = (patch: Partial<typeof FIVE[number]>) => [{ ...FIVE[0], ...patch }, ...FIVE.slice(1)];
  const problems = validatePhonics([
    entry({ examples: FIVE.slice(0, 4) }),
    entry({ examples: withFirst({ sentence: 'Mom made a cake.' }) }),
    entry({ examples: withFirst({ sentence: 'Mom is baking a very big and very sweet chocolate cake for us today.' }) }),
    entry({ examples: withFirst({ sentence: 'mom is baking a cake' }) }),
    entry({ examples: withFirst({ translation: 'Mom is baking.' }) }),
    entry({ examples: [...FIVE.slice(0, 4), { ...FIVE[0], sentence: 'mom is baking a cake.'.replace('m', 'M') }] }),
  ]);
  assert.equal(problems.length, 6, problems.join('\n'));
  assert.match(problems[0], /5–8 条/);
  assert.match(problems[1], /必须包含单词/);
  assert.match(problems[2], /3–12/);
  assert.match(problems[3], /大写字母开头/);
  assert.match(problems[4], /中文翻译/);
  assert.match(problems[5], /重复/);
});

test('例句允许常见词形变化', () => {
  for (const [s, w] of [
    ['I have two cats.', 'cat'], ['She is making a kite.', 'make'], ['The babies are sleeping.', 'baby'],
    ['He is running fast.', 'run'], ["It is Tom's book.", 'Tom'], ['This apple is bigger.', 'big'],
  ]) assert.ok(sentenceContainsWord(s, w), `${w} in ${s}`);
  assert.ok(!sentenceContainsWord('I like my cap.', 'cat'));
  assert.ok(!sentenceContainsWord('A category of things.', 'cat'));
});

test('词组：不要求音节与拼读规则，要求词组类型；例句里各个词按顺序出现即可', () => {
  const phraseExamples = [
    { sentence: 'Never give up on your dream.', translation: '永远不要放弃梦想。' },
    { sentence: 'She gave up chocolate.', translation: '她戒了巧克力。' },
    { sentence: 'He is giving up his seat.', translation: '他正在让座。' },
    { sentence: 'They gave it up last year.', translation: '他们去年放弃了。', uses: 'gave it up' },
    { sentence: 'Do not give up so soon.', translation: '别这么快放弃。' },
  ];
  const phrase = entry({ word: 'give up', syllables: '', phonics_rule: '', ipa: '/ɡɪv ʌp/', phrase_type: 'phrasal_verb', separable: true, examples: phraseExamples });
  assert.deepEqual(validatePhonics([phrase]), []);
  assert.ok(validatePhonics([{ ...phrase, phrase_type: undefined }]).some((p) => p.includes('phrase_type')));
  // 拆开用的写法要在 uses 里标注
  assert.ok(!sentenceContainsWord('They gave it up.', 'give up'));
  assert.ok(sentenceContainsWord('They gave it up.', 'give up', 'gave it up'));
  assert.ok(sentenceContainsWord('I take care of my cat.', 'take care of sb'));
  assert.ok(!sentenceContainsWord('Give me the cup.', 'give up'));
});
