import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type BuiltinCatalog, type RedLarkModel, type RedLarkProvider, toPiModelsJson } from './config.ts';

const catalog: BuiltinCatalog = {
  hasProvider: id => ['moonshotai-cn', 'openrouter'].includes(id),
  hasModel: (p, m) => p === 'moonshotai-cn' && m === 'kimi-k3',
};

const model = (overrides: Partial<RedLarkModel> = {}): RedLarkModel => ({
  modelId: 'kimi-k3', name: 'Kimi K3', maxTokens: null, temperature: null,
  extraParams: null, contextWindow: null, reasoning: null, ...overrides,
});

const provider = (overrides: Partial<RedLarkProvider> = {}): RedLarkProvider => ({
  key: 'moonshotai-cn', piProvider: 'moonshotai-cn', name: '月之暗面', baseUrl: 'https://api.moonshot.cn/v1',
  api: 'openai-completions', apiKeyEnv: 'REDLARK_KEY_2', model: model(), ...overrides,
});

test('内置 provider + 目录中已有模型：只写 modelOverrides，保留 pi 兼容参数', () => {
  const json = toPiModelsJson({ provider: provider({ model: model({ maxTokens: 32000, temperature: 1, extraParams: { top_p: 0.95 } }) }) }, catalog);
  assert.deepEqual(json, {
    providers: {
      'moonshotai-cn': {
        apiKey: '$REDLARK_KEY_2',
        modelOverrides: { 'kimi-k3': { maxTokens: 32000, samplingParams: { top_p: 0.95, temperature: 1 } } },
      },
    },
  });
});

test('内置 provider + 未设置任何参数：不写 overrides，只注入 Key 引用', () => {
  assert.deepEqual(toPiModelsJson({ provider: provider() }, catalog), {
    providers: { 'moonshotai-cn': { apiKey: '$REDLARK_KEY_2' } },
  });
});

test('内置 provider + 目录中没有的模型：追加到 models', () => {
  const json = toPiModelsJson({
    provider: provider({ key: 'openrouter', piProvider: 'openrouter', apiKeyEnv: 'REDLARK_KEY_1',
      model: model({ modelId: 'vendor/new-model', name: 'New Model', contextWindow: 128000, reasoning: false }) }),
  }, catalog);
  assert.deepEqual(json.providers.openrouter, {
    apiKey: '$REDLARK_KEY_1',
    models: [{ id: 'vendor/new-model', name: 'New Model', contextWindow: 128000, reasoning: false }],
  });
});

test('自定义 provider：完整定义，密钥只以环境变量引用出现', () => {
  const json = toPiModelsJson({
    provider: provider({ key: 'redlark-p7', piProvider: null, name: 'My Proxy', baseUrl: 'https://proxy.example/v1',
      apiKeyEnv: 'REDLARK_KEY_7', model: model({ modelId: 'some-model', name: 'Some', maxTokens: 8000, temperature: 0.3 }) }),
  }, catalog);
  assert.deepEqual(json.providers['redlark-p7'], {
    name: 'My Proxy', baseUrl: 'https://proxy.example/v1', api: 'openai-completions', apiKey: '$REDLARK_KEY_7',
    models: [{ id: 'some-model', name: 'Some', maxTokens: 8000, samplingParams: { temperature: 0.3 } }],
  });
});

test('映射的内置 provider 不存在于目录时按自定义处理', () => {
  const json = toPiModelsJson({ provider: provider({ key: 'gone-provider', piProvider: 'gone-provider' }) }, catalog);
  assert.equal(json.providers['gone-provider'].baseUrl, 'https://api.moonshot.cn/v1');
  assert.equal(json.providers['gone-provider'].api, 'openai-completions');
});
