import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIpcError, toUserMessage } from './errors';

test('解析后端 AppError 的 {code, message}', () => {
  assert.deepEqual(
    parseIpcError({ code: 'VALIDATION_ERROR', message: '验证错误: 单词本标题不能为空' }),
    { code: 'VALIDATION_ERROR', message: '验证错误: 单词本标题不能为空' },
  );
});

test('未知 code 只保留 message', () => {
  assert.deepEqual(parseIpcError({ code: 'WHATEVER', message: 'x' }), { code: undefined, message: 'x' });
});

test('Tauri 自身返回的字符串错误', () => {
  assert.deepEqual(parseIpcError('command foo not found'), { message: 'command foo not found' });
});

test('前端 Error 对象', () => {
  assert.deepEqual(parseIpcError(new Error('boom')), { message: 'boom' });
});

test('旧的外部标签形状被标记为未识别格式，而不是静默显示', () => {
  const parsed = parseIpcError({ DatabaseError: 'x' });
  assert.equal(parsed.code, undefined);
  assert.match(parsed.message, /^未识别的错误格式/);
});

test('去掉后端类别前缀，校验信息原样给用户', () => {
  assert.equal(toUserMessage('验证错误: 单词本标题不能为空', 'VALIDATION_ERROR'), '单词本标题不能为空');
  assert.equal(toUserMessage('未找到资源: 短文 3 不存在', 'NOT_FOUND'), '短文 3 不存在');
});

test('数据库原始信息不给用户看', () => {
  assert.equal(toUserMessage('数据库错误: error returned from database: (code: 5) database is locked', 'DATABASE_ERROR'), '数据正忙，请稍后再试');
  assert.equal(toUserMessage("数据库错误: Failed to insert word 'a': boom", 'DATABASE_ERROR'), '读写数据时出错了，请再试一次');
  assert.equal(toUserMessage('数据库错误: 新建主题后读取失败', 'DATABASE_ERROR'), '新建主题后读取失败');
});

test('内部错误：中文说明留下，英文尾巴去掉', () => {
  assert.equal(toUserMessage('内部服务器错误: 读取日志失败：No such file or directory', 'INTERNAL_ERROR'), '读取日志失败');
  assert.equal(toUserMessage('内部服务器错误: Date overflow', 'INTERNAL_ERROR'), '应用内部出错了，请再试一次');
});

test('AI 服务常见失败给出处理办法', () => {
  assert.match(toUserMessage('外部服务错误: 401 Unauthorized: invalid api key', 'EXTERNAL_SERVICE_ERROR'), /密钥无效.*设置 → AI 模型/);
  assert.match(toUserMessage('外部服务错误: 豆包语音合成失败：401', 'EXTERNAL_SERVICE_ERROR'), /语音服务.*设置 → 语音合成/);
  assert.match(toUserMessage('外部服务错误: 429 Too Many Requests', 'EXTERNAL_SERVICE_ERROR'), /额度/);
  assert.match(toUserMessage('外部服务错误: request timed out', 'EXTERNAL_SERVICE_ERROR'), /超时/);
  assert.equal(toUserMessage('外部服务错误: 模型没有提交例句', 'EXTERNAL_SERVICE_ERROR'), '模型没有提交例句');
  assert.equal(toUserMessage('外部服务错误: 无法启动 agent：spawn ENOENT', 'EXTERNAL_SERVICE_ERROR'), 'AI 助手没能启动，请重启应用后再试');
});

test('取消不是失败', () => {
  assert.equal(toUserMessage('外部服务错误: 已取消：用户取消了本次任务', 'EXTERNAL_SERVICE_ERROR'), '已取消');
});

test('Tauri 自身的错误换成通用说法', () => {
  assert.equal(toUserMessage('command foo not found'), '应用内部出错了，请重启应用后再试');
  assert.equal(toUserMessage('请先选择单词本'), '请先选择单词本');
});
