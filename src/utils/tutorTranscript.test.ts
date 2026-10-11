import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyTranscript, splitAttachments, toTurns, type TranscriptState } from './tutorTranscript.ts';
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

test('工具的提问：select 显示选项，结束后清掉', () => {
  const asked = run([
    { type: 'agent_start' },
    { type: 'extension_ui_request', id: 'q1', method: 'select', title: '放哪？', options: ['加进《机场英语》', '新建一个词汇本'] },
  ]);
  assert.deepEqual(asked.ask?.options, ['加进《机场英语》', '新建一个词汇本']);
  assert.equal(run([{ type: 'agent_settled' }], asked).ask, null);
  // 通知类的不算提问
  assert.equal(run([{ type: 'extension_ui_request', id: 'n', method: 'notify' }]).ask, null);
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
