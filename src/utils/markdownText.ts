/**
 * 去掉模型回复里落单的加粗标记：一行里 `**` 是奇数个时，最后一个没有配对，Markdown 会把它原样显示出来。
 * 只处理 `**`（模型最常漏的）；代码块里的内容不动。
 */
export function dropUnpairedBold(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const count = line.split('**').length - 1;
      if (count % 2 === 0) return line;
      const at = line.lastIndexOf('**');
      return line.slice(0, at) + line.slice(at + 2);
    })
    .join('\n');
}
