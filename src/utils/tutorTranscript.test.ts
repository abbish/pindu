import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, dropAsk, emptyTranscript, friendlyError, splitAttachments, toAsk, toTurns, type TranscriptState } from './tutorTranscript.ts';
import type { PiEvent } from '../types/tutor.ts';

const run = (events: PiEvent[], state: TranscriptState = emptyTranscript()) => events.reduce(applyEvent, state);

const user = { role: 'user' as const, content: 'itinerary 是什么意思？', timestamp: 1 };

test('流式回答：增量拼成正文，message_end 以完整消息为准', () => {
  const streaming = run([
    { type: 'agent_start' },
    { type: 'message_end', message: user },
    { type: 'message_start', message: { role: 'assistant', content: [], timestamp: 2 } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '行程' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '表' } },
  ]);
  let turns = toTurns(streaming);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[1], {
    role: 'agent',
    key: 'partial',
    items: [{ kind: 'text', key: 'partial-0', text: '行程表' }],
    steps: [],
    suggestions: [],
    running: true,
  });

  const done = run(
    [
      {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: '行程表。' }], stopReason: 'stop', timestamp: 2 },
      },
      { type: 'agent_settled' },
    ],
    streaming
  );
  turns = toTurns(done);
  assert.deepEqual(turns[1].role === 'agent' && turns[1].items.map((i) => i.kind === 'text' && i.text), ['行程表。']);
  assert.equal(turns[1].role === 'agent' && turns[1].running, false);
});

test('工具调用成为步骤：说明取自 details.redlark，进行中 → 完成', () => {
  const call = { type: 'toolCall' as const, id: 'c1', name: 'mcp__pindu__find_words', arguments: {} };
  const state = run([
    { type: 'agent_start' },
    { type: 'message_end', message: user },
    { type: 'message_end', message: { role: 'assistant', content: [call], stopReason: 'toolUse', timestamp: 2 } },
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: call.name },
  ]);
  let agent = toTurns(state)[1];
  assert.equal(agent.role === 'agent' && agent.steps[0].status, 'running');
  assert.equal(agent.role === 'agent' && agent.steps[0].label, '正在处理');

  const finished = run(
    [
      {
        type: 'message_end',
        message: {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: call.name,
          content: [],
          details: { redlark: { step: '查了你的词汇本：还没有学过这个词' } },
          isError: false,
          timestamp: 3,
        },
      },
    ],
    state
  );
  agent = toTurns(finished)[1];
  assert.equal(agent.role === 'agent' && agent.steps[0].label, '查了你的词汇本：还没有学过这个词');
  assert.equal(agent.role === 'agent' && agent.steps[0].status, 'done');
});

test('同一条消息重复到达只算一次；先显示没确认的消息', () => {
  const state = run([{ type: 'message_end', message: user }, { type: 'message_end', message: user }]);
  assert.equal(state.messages.length, 1);

  const pending = { ...emptyTranscript(), pendingUser: { text: '你好', images: [], files: [] } };
  assert.equal(toTurns(pending)[0].role === 'user' && toTurns(pending)[0].pending, true);
  assert.equal(run([{ type: 'message_end', message: user }], pending).pendingUser, null);
});

test('工具的提问：按顺序排队，一次答一个，结束后清掉', () => {
  const asked = run([
    { type: 'agent_start' },
    { type: 'extension_ui_request', id: 'q1', method: 'select', title: '放哪？', options: ['加进《机场英语》', '新建一个词汇本'] },
    { type: 'extension_ui_request', id: 'q2', method: 'editor', title: '改一下这段', prefill: 'Hello' },
    // 重复到达（重新打开对话时补上的）只算一次
    { type: 'extension_ui_request', id: 'q1', method: 'select', title: '放哪？', options: [] },
  ]);
  assert.deepEqual(asked.asks.map((a) => a.id), ['q1', 'q2']);
  assert.deepEqual(asked.asks[0].options, ['加进《机场英语》', '新建一个词汇本']);
  assert.equal(asked.asks[1].prefill, 'Hello');
  assert.deepEqual(dropAsk(asked, 'q1').asks.map((a) => a.id), ['q2']);
  assert.deepEqual(run([{ type: 'agent_settled' }], asked).asks, []);
  // 通知类的不算提问
  assert.deepEqual(run([{ type: 'extension_ui_request', id: 'n', method: 'notify' }]).asks, []);
  // 带超时的记下过期时刻
  assert.equal(toAsk({ id: 'c', method: 'confirm', title: '确定？', timeout: 5000 }, 1000)?.expiresAt, 6000);
});

test('停止：没有结果的步骤显示为没完成，回答标记已停止', () => {
  const call = { type: 'toolCall' as const, id: 'c1', name: 'view_image', arguments: { reason: '看一下截图' } };
  const state = run([
    { type: 'message_end', message: user },
    { type: 'message_end', message: { role: 'assistant', content: [call], stopReason: 'aborted', timestamp: 2 } },
  ]);
  const agent = toTurns(state)[1];
  assert.equal(agent.role === 'agent' && agent.stopped, true);
  assert.equal(agent.role === 'agent' && agent.steps[0].status, 'error');
  assert.equal(agent.role === 'agent' && agent.steps[0].label, '看一下截图');
});

test('附件标记：拆成正文与文件名', () => {
  assert.deepEqual(splitAttachments('看看这份讲义\n\n〔附件：讲义.pdf、讲义-image1.png〕'), {
    text: '看看这份讲义',
    files: ['讲义.pdf', '讲义-image1.png'],
  });
  assert.deepEqual(splitAttachments('〔附件：a.pdf〕'), { text: '', files: ['a.pdf'] });
  assert.deepEqual(splitAttachments('没有附件'), { text: '没有附件', files: [] });
});

test('说的话与工具调用按发生顺序排列，连着的工具调用成一组', () => {
  const read = (id: string) => ({
    type: 'toolCall' as const,
    id,
    name: 'mcp__pindu__list_word_books',
    arguments: { reason: '看看你有哪些词汇本' },
  });
  const state = run([
    { type: 'agent_start' },
    { type: 'message_end', message: user },
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '我先看看你的素材。' }, read('c1'), read('c2')],
        stopReason: 'toolUse',
        timestamp: 2,
      },
    },
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'mcp__pindu__list_word_books' },
  ]);
  const agent = toTurns(state)[1];
  assert.ok(agent.role === 'agent');
  assert.deepEqual(
    agent.items.map((i) => i.kind),
    ['text', 'steps']
  );
  const group = agent.items[1];
  assert.ok(group.kind === 'steps');
  // 进行中显示模型写的调用意图
  assert.deepEqual(group.steps.map((s) => s.label), ['看看你有哪些词汇本', '看看你有哪些词汇本']);
});

test('读 skill 显示成看了哪类做法', () => {
  const call = {
    type: 'toolCall' as const,
    id: 'r1',
    name: 'read',
    arguments: { path: '/data/agent/skills/tutor-passages/SKILL.md' },
  };
  const state = run([
    { type: 'message_end', message: user },
    { type: 'message_end', message: { role: 'assistant', content: [call], stopReason: 'toolUse', timestamp: 2 } },
    {
      type: 'message_end',
      message: { role: 'toolResult', toolCallId: 'r1', toolName: 'read', content: [], isError: false, timestamp: 3 },
    },
  ]);
  const agent = toTurns(state)[1];
  assert.equal(agent.role === 'agent' && agent.steps[0].label, '看了「短文与题组」的做法');
});

test('排队的消息：按 pi 的完整队列显示，结束时清空', () => {
  const queued = run([
    { type: 'agent_start' },
    { type: 'queue_update', steering: ['再简单一点', '加个例句'], followUp: [] },
  ]);
  assert.deepEqual(queued.queue, ['再简单一点', '加个例句']);
  assert.deepEqual(run([{ type: 'queue_update', steering: ['加个例句'], followUp: [] }], queued).queue, ['加个例句']);
  assert.deepEqual(run([{ type: 'agent_settled' }], queued).queue, []);
});

test('推荐下一步来自 suggest_replies 工具；它和起标题都不算步骤', () => {
  const done = run([
    { type: 'message_end', message: user },
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '行程表的意思。' },
          { type: 'toolCall', id: 't', name: 'name_conversation', arguments: { title: '查 itinerary' } },
          { type: 'toolCall', id: 's', name: 'suggest_replies', arguments: { replies: ['用它造个句子', '再来两个例句'] } },
        ],
        stopReason: 'toolUse',
        timestamp: 2,
      },
    },
  ]);
  const agent = toTurns(done)[1];
  assert.ok(agent.role === 'agent');
  assert.deepEqual(agent.suggestions, ['用它造个句子', '再来两个例句']);
  assert.deepEqual(agent.steps, []);
  assert.deepEqual(agent.items.map((i) => i.kind), ['text']);
});

test('一轮的用时：学习者发出到最后一条回答', () => {
  const state = run([
    { type: 'message_end', message: { role: 'user', content: '考考我', timestamp: 1_000 } },
    { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'toolUse', timestamp: 4_000 } },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '第 1 题' }], stopReason: 'stop', timestamp: 13_000 } },
  ]);
  const agent = toTurns(state)[1];
  assert.equal(agent.role === 'agent' && agent.seconds, 12);
});

test('后台任务结束的通知显示成系统提示，AI 老师接着说的话另起一轮', () => {
  const state = run([
    { type: 'message_end', message: user },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '存好了，正在翻译。' }], stopReason: 'stop', timestamp: 2 } },
    {
      type: 'message_end',
      message: { role: 'custom', customType: 'pindu-job', content: '后台任务完成：导入短文 · A Day', display: true, timestamp: 3 },
    },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '翻译好了，要出题吗？' }], stopReason: 'stop', timestamp: 4 } },
  ]);
  const turns = toTurns(state);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'agent', 'notice', 'agent']);
  assert.equal(turns[2].role === 'notice' && turns[2].text, '后台任务完成：导入短文 · A Day');
});

test('自动重试成功后不显示前面那次的错误；常见错误换成好懂的话', () => {
  const failed = { role: 'assistant' as const, content: [], stopReason: 'error' as const, errorMessage: '429 {"error":{"type":"rate_limit_error"}}', timestamp: 2 };
  const ok = { role: 'assistant' as const, content: [{ type: 'text' as const, text: '今天可以做的练习有……' }], stopReason: 'stop' as const, timestamp: 3 };
  const retried = toTurns(run([{ type: 'message_end', message: user }, { type: 'message_end', message: failed }, { type: 'message_end', message: ok }]));
  assert.equal(retried[1].role === 'agent' && retried[1].error, undefined);
  const gaveUp = toTurns(run([{ type: 'message_end', message: user }, { type: 'message_end', message: failed }]));
  assert.equal(gaveUp[1].role === 'agent' && gaveUp[1].error, failed.errorMessage);
  // 还在重试：不显示
  const retrying = toTurns(run([{ type: 'agent_start' }, { type: 'message_end', message: user }, { type: 'message_end', message: failed }, { type: 'auto_retry_start' }]));
  assert.equal(retrying[1].role === 'agent' && retrying[1].error, undefined);
  assert.equal(friendlyError(failed.errorMessage), 'AI 服务现在太忙，请稍后再试');
  assert.equal(friendlyError('401 invalid api key'), 'AI 服务的密钥不对，请在「设置 → AI 模型」检查');
  assert.equal(friendlyError('something odd'), 'AI 老师这次没能回答完，请再试一次');
});
