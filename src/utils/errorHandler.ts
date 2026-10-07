/**
 * 从任意错误值中取出给用户看的消息：Error → message；字符串原样；带非空字符串 message 的对象 → message；否则 undefined。
 * 服务层失败的 `result.error` 已由 `api/errors.ts::toUserMessage` 转成用户能看懂的说法，这里不再改写。
 */
export function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === 'string') return error || undefined;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return undefined;
}
