import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGenerationForm, generationFormFromModel, parseGenerationForm } from './modelGeneration';
import type { AIModelConfig } from '../types';

test('空表单 = 全部不设置', () => {
  assert.deepEqual(parseGenerationForm(emptyGenerationForm()), {
    ok: true,
    generation: { maxTokens: null, temperature: null, thinkingLevel: null, extraParams: null, contextWindow: null, reasoning: null },
  });
});

test('填写的字段按类型转换', () => {
  const result = parseGenerationForm({
    maxTokens: '32000', temperature: '1', thinkingLevel: 'low',
    extraParams: '{"top_p": 0.95}', contextWindow: ' 128000 ', reasoning: 'false',
  });
  assert.deepEqual(result, {
    ok: true,
    generation: { maxTokens: 32000, temperature: 1, thinkingLevel: 'low', extraParams: { top_p: 0.95 }, contextWindow: 128000, reasoning: false },
  });
});

test('格式错误给出提示', () => {
  const bad = (patch: Partial<ReturnType<typeof emptyGenerationForm>>) =>
    parseGenerationForm({ ...emptyGenerationForm(), ...patch });
  assert.equal(bad({ maxTokens: '1.5' }).ok, false);
  assert.equal(bad({ temperature: 'hot' }).ok, false);
  assert.equal(bad({ extraParams: '[1,2]' }).ok, false);
  assert.equal(bad({ extraParams: '{oops' }).ok, false);
});

test('从模型配置回填表单（往返一致）', () => {
  const model = {
    maxTokens: 32000, temperature: 0, thinkingLevel: 'high', extraParams: { top_p: 0.9 },
    contextWindow: null, reasoning: true,
  } as unknown as AIModelConfig;
  const form = generationFormFromModel(model);
  assert.equal(form.temperature, '0');
  assert.equal(form.reasoning, 'true');
  const parsed = parseGenerationForm(form);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.generation.extraParams, { top_p: 0.9 });
});
