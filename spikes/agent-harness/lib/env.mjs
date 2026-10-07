// 测试密钥：从 RedLark 隔离测试库读取（不打印、不落盘），通过环境变量传给子进程
import { execFileSync } from 'node:child_process';

const SCRATCH = '/private/tmp/claude-502/-Users-ztzhao-Workspace-abbish-redlark/1661d0b8-6155-4bbb-9012-49c33ea143a2/scratchpad';
export const TEST_DB = `${SCRATCH}/e2e-home/Library/Application Support/com.redlark.pindu-app/vocabulary.db`;

export function providerKey(name) {
  const key = execFileSync('sqlite3', [TEST_DB, `select api_key from ai_providers where name = '${name}'`]).toString().trim();
  if (!key || key === 'PLEASE_SET_YOUR_API_KEY') throw new Error(`测试库中 ${name} 未配置 API Key`);
  return key;
}

export const MOONSHOT = { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', temperature: 1, maxTokens: 32000 };
