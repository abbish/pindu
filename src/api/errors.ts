/**
 * IPC 错误解析（纯函数，不依赖 Tauri 运行时，便于测试）。
 *
 * 后端 contract：`AppError` 序列化为 `{ code, message }`
 * （.claude/skills/deliver-contract-and-data/references/tauri-ipc-contract.md §4）。
 */

/** 后端 `AppError::code()` 的取值 */
export type AppErrorCode =
  | 'DATABASE_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'EXTERNAL_SERVICE_ERROR';

const KNOWN_CODES: ReadonlySet<string> = new Set<AppErrorCode>([
  'DATABASE_ERROR',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'INTERNAL_ERROR',
  'EXTERNAL_SERVICE_ERROR',
]);

export interface ParsedIpcError {
  message: string;
  code?: AppErrorCode;
}

/**
 * 把 `invoke` 抛出的任意值解析为 `{ message, code? }`。
 * - `{ code, message }`：后端 AppError（正常路径）
 * - `string`：Tauri 自身错误（如命令不存在、参数反序列化失败）
 * - `Error`：前端异常
 * - 其它：视为 contract 违反，字符串化以便排查
 */
export function parseIpcError(error: unknown): ParsedIpcError {
  if (typeof error === 'string') {
    return { message: error };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      const code = typeof obj.code === 'string' && KNOWN_CODES.has(obj.code) ? (obj.code as AppErrorCode) : undefined;
      return { message: obj.message, code };
    }
    try {
      return { message: `未识别的错误格式: ${JSON.stringify(error)}` };
    } catch {
      return { message: '未识别的错误格式' };
    }
  }
  return { message: `未知错误: ${String(error)}` };
}

/** 后端 `AppError` Display 自带的类别前缀（给日志看的，不给用户看） */
const CATEGORY_PREFIX = /^(数据库错误|验证错误|未找到资源|权限不足|内部服务器错误|外部服务错误)[:：]\s*/;

const HAS_CJK = /[一-鿿]/;

/** 冒号前是中文说明、冒号后是英文原始信息（如“读取日志失败：No such file”）时只留中文部分 */
const chineseHead = (message: string): string => {
  const match = /^(.*?[一-鿿][^:：]*)[:：]\s*(.+)$/.exec(message);
  if (match && !HAS_CJK.test(match[2])) return match[1].trim();
  return message;
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 应用内更新的错误（后端以「检查更新失败 / 安装更新失败」开头）：说成更新服务器的问题，而不是 AI 服务 */
const describeUpdate = (message: string): string => {
  const lower = message.toLowerCase();
  if (/signature|签名/.test(lower)) return '更新包的签名校验没有通过，为了安全没有安装';
  if (/\b404\b|not found|could not fetch a valid release json/.test(lower)) return '暂时获取不到更新信息，请稍后再试';
  if (/timed? ?out|timeout|超时/.test(lower)) return '连接 GitHub（更新服务器）超时，请稍后再试';
  if (/error sending request|connect|dns|network|unreachable|connection/.test(lower)) {
    return '连不上 GitHub（更新服务器），请检查网络后再试';
  }
  return chineseHead(message);
};

/** 外部服务（AI 模型 / 语音合成）的常见失败 → 能自己处理的说法 */
const describeExternal = (message: string): string => {
  if (message.startsWith('检查更新失败') || message.startsWith('安装更新失败')) return describeUpdate(message);
  const tts = message.includes('语音合成');
  const service = tts ? '语音服务' : 'AI 服务';
  const settings = tts ? '「设置 → 语音合成」' : '「设置 → AI 模型」';
  const lower = message.toLowerCase();

  if (message.startsWith('无法启动 agent')) return 'AI 助手没能启动，请重启应用后再试';
  if (/agent (进程|stdin|stdout|连接|未响应)|向 agent 发送命令失败/.test(message)) return 'AI 助手意外中断了，请再试一次';
  if (/\b(401|403)\b|unauthori[sz]ed|invalid.{0,20}(api.?key|token)|authentication|incorrect api key|鉴权|密钥无效/.test(lower)) {
    return `${service}拒绝了请求：密钥无效或没有权限，请到${settings}检查`;
  }
  if (/\b429\b|rate.?limit|too many requests|quota|insufficient|balance|余额|额度/.test(lower)) {
    return `${service}暂时不可用：请求太频繁或账户额度不足，请稍后再试或检查账户余额`;
  }
  if (/model.{0,40}(not found|does not exist|not exist)|no such model|模型不存在/.test(lower)) {
    return `找不到所选模型，请到${settings}检查模型名称`;
  }
  const agentTimeout = /agent 超时（(\d+) 分钟）/.exec(message);
  if (agentTimeout) return `AI 超过 ${agentTimeout[1]} 分钟还没完成，可以到「设置 → AI 助手」调长每次最长等待`;
  if (/timed? ?out|timeout|超时/.test(lower)) return `${service}响应超时，请稍后再试`;
  if (/error sending request|connect|dns|network|网络|unreachable|connection/.test(lower)) {
    return `连不上${service}，请检查网络后再试`;
  }
  if (HAS_CJK.test(message)) return chineseHead(message);
  return `${service}出错了，请稍后再试（${truncate(message, 80)}）`;
};

/**
 * 把后端 / Tauri 的错误信息转成给用户看的一句话（唯一入口：`TauriApiClient.invoke` 失败时调用）。
 * - 去掉“验证错误:”等类别前缀；校验、未找到这类本身就是写给用户的信息原样保留
 * - 数据库 / 内部错误只给可操作的说法，原始信息留在日志与 DevTools
 * - AI / 语音服务的常见失败（密钥、额度、超时、网络、模型名）给出处理办法
 * 规范：ui-interaction-patterns.md §6
 */
export function toUserMessage(message: string, code?: AppErrorCode): string {
  const text = message.replace(CATEGORY_PREFIX, '').trim();
  if (text.startsWith('已取消')) return '已取消';

  switch (code) {
    case 'EXTERNAL_SERVICE_ERROR':
      return describeExternal(text);
    case 'DATABASE_ERROR': {
      const lower = text.toLowerCase();
      if (lower.includes('database is locked') || lower.includes('busy')) return '数据正忙，请稍后再试';
      if (lower.includes('unique constraint')) return '已经有相同的记录了';
      if (lower.includes('foreign key')) return '相关的数据已不存在，请刷新后再试';
      return HAS_CJK.test(text) && !/[a-z]{4,}/i.test(text) ? text : '读写数据时出错了，请再试一次';
    }
    case 'INTERNAL_ERROR':
      return HAS_CJK.test(text) ? chineseHead(text) : '应用内部出错了，请再试一次';
    case 'VALIDATION_ERROR':
    case 'NOT_FOUND':
    case 'UNAUTHORIZED':
      return HAS_CJK.test(text) ? chineseHead(text) : '操作没有完成，请刷新后再试';
    default:
      // Tauri 自身的错误（命令不存在、参数不对）是程序问题，不是用户能处理的
      if (/command .* not found|invalid args|missing required key|invalid type/i.test(text)) {
        return '应用内部出错了，请重启应用后再试';
      }
      return text || '出了点问题，请再试一次';
  }
}
