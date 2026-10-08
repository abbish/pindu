import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from './catalog.ts';

test('内置目录包含 RedLark 预置的四个提供商及其模型能力', () => {
  const catalog = buildCatalog();
  const byId = new Map(catalog.map(p => [p.id, p]));
  for (const id of ['openrouter', 'moonshotai-cn', 'deepseek', 'minimax-cn']) assert.ok(byId.has(id), id);
  const k3 = byId.get('moonshotai-cn')!.models.find(m => m.id === 'kimi-k3')!;
  assert.equal(k3.reasoning, true);
  assert.ok(k3.contextWindow >= 1_000_000);
  assert.ok(k3.thinkingLevels.includes('low'));
  assert.equal(byId.get('minimax-cn')!.api, 'anthropic-messages');
});

test('提供商名称与鉴权方式来自 pi', () => {
  const byId = new Map(buildCatalog().map(p => [p.id, p]));
  const deepseek = byId.get('deepseek')!;
  assert.equal(deepseek.name, 'DeepSeek');
  assert.ok(deepseek.apiKeyLabel);
  assert.equal(deepseek.keyOnly, true);
  // 只能登录授权
  assert.equal(byId.get('openai-codex')?.apiKeyLabel ?? null, null);
  assert.equal(byId.get('openai-codex')?.keyOnly ?? false, false);
  // 地址需要账户 / 区域参数
  assert.equal(byId.get('amazon-bedrock')?.keyOnly ?? false, false);
  assert.equal(byId.get('cloudflare-workers-ai')?.keyOnly ?? false, false);
  assert.equal(byId.get('google-vertex')?.keyOnly ?? false, false);
  assert.equal(byId.get('azure')?.keyOnly ?? false, false);
  // 地址写在每个模型上、只要一个密钥
  for (const id of ['opencode', 'opencode-go', 'radius']) assert.equal(byId.get(id)?.keyOnly, true, id);
});
