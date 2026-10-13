// 发版后（或磁盘紧张时）清理本机：默认只列出可以清的东西和大小，加 --apply 才删除。
//   node scripts/release-cleanup.mjs              列出
//   node scripts/release-cleanup.mjs --apply      删除：打包产物、正式包编译缓存、散落的编译目录、回归测试留下的测试包与运行数据、git 临时包
//   node scripts/release-cleanup.mjs --apply --debug   另外删除开发编译缓存 target/debug（开发窗口都关掉之后；下次启动重编约 5–10 分钟）
// 不碰：源码、应用数据目录（~/Library/Application Support/com.redlark.pindu-app*）、第三方组件缓存（ffmpeg / whisper / onnxruntime / wordnet，
// 清了下次要重下重编）、回归测试的报告与证据文字（.claude/work 里只删 .app、runtime*、ci-* 这几类大目录）。
// macOS 上删 .app 之前先从启动服务里注销：它们与正式版同一个 identifier，不注销的话启动台可能打开旧包。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const TARGET = join(ROOT, 'src-tauri', 'target');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DEBUG = args.has('--debug');

/** target 下要保留的：开发缓存（--debug 才清）与第三方组件缓存 */
const KEEP_IN_TARGET = new Set(['debug', 'ffmpeg', 'ffmpeg-docker', 'whisper', 'onnxruntime', 'wordnet']);
/** target 下的正式包编译缓存：发版后可清，下次打包重编 */
const RELEASE_BUILDS = /^(release|Frameworks|universal-apple-darwin|aarch64-apple-darwin|x86_64-apple-darwin|x86_64-pc-windows-msvc|aarch64-pc-windows-msvc)$/;

const sizeOf = (path) => {
  try {
    return Number(execFileSync('du', ['-sk', path]).toString().split(/\s+/)[0]) * 1024;
  } catch {
    return 0;
  }
};
const human = (bytes) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)}G` : `${Math.round(bytes / (1 << 20))}M`);
const list = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

/** 拼读与它的组件进程打开着的文件（开发窗口、测试实例的程序与数据目录）：用相对路径启动的也认得出 */
const openFiles = (() => {
  let out = '';
  try {
    out = execFileSync('lsof', ['-Fn', '-c', 'pindu-app', '-c', 'redlark-agent', '-c', 'whisper-cli', '-c', 'ffmpeg'], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch (e) {
    // 有的名字没有对应进程时 lsof 退出码是 1，但其余的照样输出了
    out = e.stdout ? e.stdout.toString() : '';
  }
  return out.split('\n').filter((l) => l.startsWith('n/')).map((l) => l.slice(1));
})();

/** 有进程在用这个目录（里面的程序在跑，或数据目录开着）时不删 */
function inUse(path) {
  if (openFiles.some((f) => f === path || f.startsWith(`${path}/`))) return true;
  try {
    return execFileSync('pgrep', ['-fl', path]).toString().trim().length > 0;
  } catch {
    return false;
  }
}

/** .claude/work 里回归测试留下的大目录：测试包（.app）、运行数据（runtime*）、CI 下载（ci-*） */
function workLeftovers() {
  const found = [];
  const walk = (dir, depth) => {
    for (const name of list(dir)) {
      const p = join(dir, name);
      if (!isDir(p)) continue;
      if (name.endsWith('.app') || /^runtime/.test(name) || /-runtime(-|$)/.test(name) || /^ci-/.test(name)) found.push(p);
      else if (depth < 2) walk(p, depth + 1);
    }
  };
  walk(join(ROOT, '.claude', 'work'), 0);
  return found;
}

const groups = [
  { title: '打包产物（release/、bundle/）', paths: [join(ROOT, 'release'), ...list(TARGET).map((d) => join(TARGET, d, 'release', 'bundle')), join(TARGET, 'release', 'bundle')] },
  { title: '正式包编译缓存（下次打包重编约 10–15 分钟）', paths: list(TARGET).filter((d) => RELEASE_BUILDS.test(d)).map((d) => join(TARGET, d)) },
  {
    title: '散落的编译目录（临时指定的 CARGO_TARGET_DIR 等）',
    paths: [...list(TARGET).filter((d) => !KEEP_IN_TARGET.has(d) && !RELEASE_BUILDS.test(d) && isDir(join(TARGET, d))).map((d) => join(TARGET, d)), join(ROOT, 'src-tauri', 'src-tauri')],
  },
  { title: '回归测试留下的测试包与运行数据（.claude/work，报告保留）', paths: workLeftovers() },
  ...(DEBUG ? [{ title: '开发编译缓存 target/debug（下次启动重编约 5–10 分钟）', paths: [join(TARGET, 'debug')] }] : []),
];

let total = 0;
const doomed = [];
for (const g of groups) {
  const items = [...new Set(g.paths)].filter((p) => existsSync(p)).map((p) => ({ p, size: sizeOf(p) })).filter((i) => i.size > 0);
  if (items.length === 0) continue;
  console.log(`\n${g.title}`);
  for (const { p, size } of items) {
    const busy = inUse(p);
    console.log(`  ${human(size).padStart(7)}  ${relative(ROOT, p)}${busy ? '  （有程序在用，跳过）' : ''}`);
    if (!busy) {
      total += size;
      doomed.push(p);
    }
  }
}
if (!DEBUG && isDir(join(TARGET, 'debug'))) console.log(`\n（开发编译缓存 target/debug ${human(sizeOf(join(TARGET, 'debug')))} 没算在内：开发窗口都关掉后加 --debug 清）`);
console.log(`\n合计可清 ${human(total)}`);

if (!APPLY) {
  console.log('只是列出；确认后加 --apply 删除。');
  process.exit(0);
}

const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
for (const p of doomed) {
  if (process.platform === 'darwin' && existsSync(lsregister)) {
    // 先注销里面的 .app（与正式版同一个 identifier）
    try {
      const apps = execFileSync('find', [p, '-maxdepth', '4', '-name', '*.app', '-type', 'd']).toString().split('\n').filter(Boolean);
      for (const app of apps) execFileSync(lsregister, ['-u', app], { stdio: 'ignore' });
    } catch {
      // 注销失败不影响删除
    }
  }
  rmSync(p, { recursive: true, force: true });
}
// git 中断操作留下的临时包（有别的 git 操作在进行时 git 自己会跳过）
try {
  execFileSync('git', ['gc', '--prune=now', '--quiet'], { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.log('git gc 没有完成（可能有别的 git 操作在进行），下次再清');
}
console.log(`已清理 ${human(total)}`);
