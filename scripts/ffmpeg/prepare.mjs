// 准备随应用分发的 ffmpeg / ffprobe（tauri externalBin）：src-tauri/binaries/{ffmpeg,ffprobe}-<target-triple>[.exe]
// 已有就跳过；否则：
//   - 设了 FFMPEG_PREBUILT_DIR（CI 里由 ffmpeg 任务编好的产物，目录里是 ffmpeg / ffprobe）→ 直接复制；
//   - 否则按 sources.json 下载源码（校验 sha256）→ build.sh 编译（macOS / Linux；Windows 版在 Linux 上交叉编译）。
// 用法：node scripts/ffmpeg/prepare.mjs [target-triple ...]   （默认：rustc 的 host triple；universal-apple-darwin 编两个架构后 lipo 合并）
//      --out <目录>  只编译到 <目录>/<build.sh 目标>/（CI 的 ffmpeg 任务用），不放进 binaries/；FFMPEG_PREBUILT_DIR 用同样的布局
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries');
const WORK = join(ROOT, 'src-tauri', 'target', 'ffmpeg');
const SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));
/** 小于这个大小的视为不完整（占位或下载中断） */
const MIN_SIZE = 1024 * 1024;

/** Rust target triple → build.sh 目标 */
const TARGETS = {
  'aarch64-apple-darwin': 'macos-arm64',
  'x86_64-apple-darwin': 'macos-x86_64',
  'x86_64-unknown-linux-gnu': 'linux-x86_64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
  'x86_64-pc-windows-msvc': 'windows-x86_64',
};

const ext = (triple) => (triple.includes('windows') ? '.exe' : '');
const binPath = (name, triple) => join(BIN_DIR, `${name}-${triple}${ext(triple)}`);
const ready = (p) => existsSync(p) && statSync(p).size > MIN_SIZE;

function hostTriple() {
  const out = execFileSync('rustc', ['-vV']).toString();
  return out.split('\n').find((l) => l.startsWith('host: ')).slice('host: '.length).trim();
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 下载并解压源码到 WORK/src，返回源码根目录（build.sh 的第一个参数） */
async function fetchSources(target) {
  const srcRoot = join(WORK, 'src');
  mkdirSync(srcRoot, { recursive: true });
  for (const [name, s] of Object.entries(SOURCES)) {
    if (name.startsWith('_')) continue;
    if (s.only && !target.startsWith(s.only)) continue;
    const dir = join(srcRoot, `${name}-${s.version}`);
    if (existsSync(join(dir, '.ok'))) continue;
    const archive = join(srcRoot, s.url.split('/').pop().replace(/^v(?=\d)/, `${name}-`));
    if (!existsSync(archive) || sha256(archive) !== s.sha256) {
      console.log(`  下载 ${name} ${s.version}`);
      const res = await fetch(s.url);
      if (!res.ok) throw new Error(`下载 ${s.url} 失败：HTTP ${res.status}`);
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    }
    const actual = sha256(archive);
    if (actual !== s.sha256) throw new Error(`${name} 源码校验失败：期望 ${s.sha256}，实际 ${actual}`);
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xf', archive, '-C', dir, '--strip-components=1'], { stdio: 'inherit' });
    writeFileSync(join(dir, '.ok'), '');
  }
  return srcRoot;
}

/** 编译一个目标，返回放 ffmpeg / ffprobe 的目录 */
async function build(target, outDir) {
  if (process.platform === 'win32') {
    throw new Error('Windows 上不能编译 ffmpeg：请在 Linux（含 WSL）上用 windows-x86_64 目标交叉编译，再设 FFMPEG_PREBUILT_DIR 指向产物目录');
  }
  const srcRoot = await fetchSources(target);
  console.log(`  编译 ffmpeg（${target}，约 1–5 分钟）`);
  execFileSync('bash', [join(HERE, 'build.sh'), srcRoot, outDir, target], { stdio: 'inherit' });
  return outDir;
}

function install(fromDir, triple) {
  mkdirSync(BIN_DIR, { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe']) {
    const from = join(fromDir, `${name}${ext(triple)}`);
    if (!ready(from)) throw new Error(`没有找到编好的 ${from}`);
    copyFileSync(from, binPath(name, triple));
  }
  console.log(`ffmpeg → ${binPath('ffmpeg', triple)}`);
}

async function prepare(triple, outOverride) {
  if (triple === 'universal-apple-darwin') {
    const parts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
    for (const t of parts) await prepare(t);
    for (const name of ['ffmpeg', 'ffprobe']) {
      execFileSync('lipo', ['-create', '-output', binPath(name, triple), ...parts.map((t) => binPath(name, t))], { stdio: 'inherit' });
    }
    console.log(`ffmpeg → ${binPath('ffmpeg', triple)}`);
    return;
  }
  const target = TARGETS[triple];
  if (!target) throw new Error(`随应用分发的 ffmpeg 暂不支持 ${triple}（可选：${Object.keys(TARGETS).join(', ')}）`);
  if (outOverride) {
    await build(target, join(outOverride, target));
    return;
  }
  if (ready(binPath('ffmpeg', triple)) && ready(binPath('ffprobe', triple))) return;
  const prebuilt = process.env.FFMPEG_PREBUILT_DIR;
  install(prebuilt ? join(prebuilt, target) : await build(target, join(WORK, target)), triple);
}

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
try {
  for (const triple of args.length ? args : [hostTriple()]) await prepare(triple, out);
} catch (e) {
  console.error(`ffmpeg 准备失败：${e.message}`);
  process.exit(1);
}
