/**
 * 解析 words.phonics_segments：历史数据（001 种子）是 JSON 数组字符串 `["El", "e", "phant"]`，
 * 其它来源可能是逗号分隔 `El,e,phant`。空值或解析不出片段时返回 undefined。
 */
export function parsePhonicsSegments(raw?: string | null): string[] | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const segments = parsed.map(s => String(s).trim()).filter(Boolean);
        return segments.length > 0 ? segments : undefined;
      }
    } catch {
      // 不是合法 JSON：按逗号分隔处理
    }
  }

  const segments = text.split(',').map(s => s.trim()).filter(Boolean);
  return segments.length > 0 ? segments : undefined;
}
