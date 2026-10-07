// 编译 RedLark agent sidecar 为单文件可执行（bun --compile），输出为 Tauri externalBin 约定的文件名：
//   src-tauri/binaries/redlark-agent-<target-triple>[.exe]
// 用法：node scripts/build.mjs [target-triple ...]   （默认：rustc 的 host triple）
//      node scripts/build.mjs universal-apple-darwin   （分别编译 arm64 / x64 后 lipo 合并）
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(AGENT_DIR, '..', 'src-tauri', 'binaries');
const BUN = join(AGENT_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
const ENTRY = join(AGENT_DIR, 'src', 'host.ts');

/** Rust target triple → bun 编译目标 */
const BUN_TARGETS = {
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
  'aarch64-pc-windows-msvc': 'bun-windows-arm64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
};

function hostTriple() {
  const out = execFileSync('rustc', ['-vV']).toString();
  const line = out.split('\n').find(l => l.startsWith('host: '));
  if (!line) throw new Error('无法从 rustc -vV 读取 host triple');
  return line.slice('host: '.length).trim();
}

function outputPath(triple) {
  return join(OUT_DIR, `redlark-agent-${triple}${triple.includes('windows') ? '.exe' : ''}`);
}

function compile(triple) {
  const target = BUN_TARGETS[triple];
  if (!target) throw new Error(`不支持的 target：${triple}（可选：${Object.keys(BUN_TARGETS).join(', ')}, universal-apple-darwin）`);
  const outfile = outputPath(triple);
  execFileSync(BUN, ['build', '--compile', `--target=${target}`, ENTRY, '--outfile', outfile], { stdio: 'inherit', cwd: AGENT_DIR });
  return outfile;
}

mkdirSync(OUT_DIR, { recursive: true });
const triples = process.argv.slice(2);
for (const triple of triples.length ? triples : [hostTriple()]) {
  if (triple === 'universal-apple-darwin') {
    const parts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map(compile);
    execFileSync('lipo', ['-create', '-output', outputPath(triple), ...parts], { stdio: 'inherit' });
    for (const p of parts) rmSync(p);
  } else {
    compile(triple);
  }
  console.log(`redlark-agent → ${outputPath(triple)}`);
}
