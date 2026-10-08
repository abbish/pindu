const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** 文件名 → 默认标题：去掉清晰度、片源、编码等发布标记，点和下划线换成空格（Article.15.2019.1080p.WEBRip… → Article 15 2019） */
export function titleFromFileName(path: string): string {
  const words = baseName(path).replace(/\.[^.]+$/, '').split(/[._\s]+/).filter(Boolean);
  const tag = /^(\d{3,4}p|web-?(rip|dl)|blu-?ray|brrip|hdrip|dvdrip|hdtv|x26[45]|h\.?26[45]|hevc|aac.*|dts.*|ac3|\[.*|yts.*|rarbg)$/i;
  const end = words.findIndex((w) => tag.test(w));
  return (end > 0 ? words.slice(0, end) : words).join(' ');
}
