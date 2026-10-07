import { PiRpc } from './lib/rpc.mjs';
import { providerKey } from './lib/env.mjs';
const pi = new PiRpc({ tools: ['submit_words', 'lookup_word', 'record_mistake'], systemPrompt: 'You are a test.',
  provider: 'moonshotai-cn', model: 'kimi-k3', thinking: 'low', env: { MOONSHOT_API_KEY: providerKey('moonshot') } });
try {
  const state = await pi.send('get_state');
  console.log('ready in', Date.now() - pi.startedAt, 'ms');
  console.log({ model: state.model?.id, provider: state.model?.provider, thinking: state.thinkingLevel, session: state.sessionFile ?? null });
  const msgs = await pi.send('get_messages');
  console.log('messages', msgs.messages.length);
} catch (e) { console.error('ERR', e.message, '\nstderr:', pi.stderr.slice(0, 2000)); }
await pi.stop();
console.log('stderr:', pi.stderr.slice(0, 800) || '(empty)');
