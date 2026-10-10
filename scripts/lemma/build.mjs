// 生成词形库数据 shared/lemma/wordnet.json（入库；只在升级 WordNet 版本时重新运行）：
//   下载普林斯顿官方 WordNet 3.0（校验 sha256）→ 取四个词性的基本词表（index.*）与不规则变形表（*.exc）。
// 只保留单个词（小写字母、撇号、连字符）；WordNet 里的多词条目（give_up 等）不收，词组的位置由 AI 标注（D47）。
// 用法：node scripts/lemma/build.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const WORK = join(ROOT, 'src-tauri', 'target', 'wordnet');
const OUT_DIR = join(ROOT, 'shared', 'lemma');
const SOURCE = {
  url: 'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz',
  sha256: '640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52',
};
const POS = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
const WORD = /^[a-z][a-z'-]*$/;

mkdirSync(WORK, { recursive: true });
const archive = join(WORK, 'WordNet-3.0.tar.gz');
if (!existsSync(archive)) {
  console.log(`下载 ${SOURCE.url}`);
  execFileSync('curl', ['-sSL', '--fail', '-o', archive, SOURCE.url], { stdio: 'inherit' });
}
const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (sha !== SOURCE.sha256) throw new Error(`WordNet 压缩包校验失败：${sha}`);
execFileSync('tar', ['xzf', archive, '-C', WORK]);
const dict = join(WORK, 'WordNet-3.0', 'dict');

const index = {};
const exceptions = {};
for (const [p, name] of Object.entries(POS)) {
  const words = readFileSync(join(dict, `index.${name}`), 'latin1')
    .split('\n')
    .filter((l) => l && !l.startsWith(' '))
    .map((l) => l.split(' ', 1)[0])
    .filter((w) => WORD.test(w));
  index[p] = [...new Set(words)].sort().join(' ');
  exceptions[p] = readFileSync(join(dict, `${name}.exc`), 'latin1')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts.every((w) => WORD.test(w)))
    .map((parts) => parts.join(' '))
    .sort()
    .join('\n');
}

writeFileSync(join(OUT_DIR, 'wordnet.json'), JSON.stringify({ source: 'WordNet 3.0 (Princeton University)', index, exceptions }) + '\n');
// 许可证随数据与安装包分发（原文件是只读的，读出再写，重跑不会失败）
const license = readFileSync(join(WORK, 'WordNet-3.0', 'LICENSE'));
writeFileSync(join(OUT_DIR, 'WordNet-LICENSE.txt'), license);
writeFileSync(join(ROOT, 'src-tauri', 'licenses', 'WordNet-3.0-LICENSE.txt'), license);
console.log('已生成 shared/lemma/wordnet.json');
