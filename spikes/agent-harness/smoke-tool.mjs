import { PiRpc } from './lib/rpc.mjs';
import { providerKey } from './lib/env.mjs';
const pi = new PiRpc({ tools: ['lookup_word'], systemPrompt: 'Always call lookup_word for the word the user asks about, then answer in one sentence.',
  provider: 'moonshotai-cn', model: 'kimi-k3', thinking: 'low', env: { MOONSHOT_API_KEY: providerKey('moonshot') } });
try {
  await pi.send('get_state'); console.log('ready in', Date.now() - pi.startedAt, 'ms');
  const r = await pi.run('How do I read "zebra"?');
  console.log(r.ms + 'ms', JSON.stringify(r.toolCalls), '|', r.text, r.error ?? '');
} catch (e) { console.error('ERR', e.message); }
await pi.stop(); if (pi.stderr) console.log('stderr:', pi.stderr.slice(0, 1500));
