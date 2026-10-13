// 准备随应用分发的 whisper-cli（tauri externalBin）：src-tauri/binaries/whisper-cli-<target-triple>[.exe]
// 已有、且编译配置（本文件 + sources.json）没变就跳过；否则按 sources.json 下载源码（校验 sha256）→ cmake 编译。
// macOS 开 Metal（着色器嵌进程序），其余平台只用 CPU；静态链接，只依赖系统库。识别模型不在这里，第一次识别时下载。
// 用法：node scripts/whisper/prepare.mjs [target-triple ...]   （默认：rustc 的 host triple；universal-apple-darwin 编两个架构后 lipo 合并）
// 需要：cmake、C/C++ 编译器（macOS Xcode 命令行工具，Windows Visual Studio 生成工具，Linux build-essential）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries');
const WORK = join(ROOT, 'src-tauri', 'target', 'whisper');
const SOURCE = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'))['whisper.cpp'];
const MIN_SIZE = 512 * 1024;
const RECIPE = createHash('sha256')
  .update(readFileSync(join(HERE, 'prepare.mjs')))
  .update(readFileSync(join(HERE, 'sources.json')))
  .digest('hex');

/**
 * 支持的 triple → cmake 额外参数。
 * - GGML_NATIVE=OFF：不按编译机的 CPU 优化（否则在新芯片上编出的程序到旧机器上会因非法指令崩溃）；
 * - Windows / Linux 关 OpenMP：否则要用户机器装有 VC++ 运行库（vcomp140.dll）/ libgomp，ggml 自带线程池够用。
 */
const TARGETS = {
  'aarch64-apple-darwin': ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON', '-DCMAKE_OSX_DEPLOYMENT_TARGET=10.15', '-DGGML_NATIVE=OFF'],
  'x86_64-apple-darwin': ['-DCMAKE_OSX_ARCHITECTURES=x86_64', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON', '-DCMAKE_OSX_DEPLOYMENT_TARGET=10.15', '-DGGML_NATIVE=OFF'],
  'x86_64-unknown-linux-gnu': ['-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF'],
  'aarch64-unknown-linux-gnu': ['-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF'],
  'x86_64-pc-windows-msvc': ['-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF', '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'],
  'aarch64-pc-windows-msvc': ['-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF', '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded', '-A', 'ARM64'],
};

const ext = (triple) => (triple.includes('windows') ? '.exe' : '');
const binPath = (triple) => join(BIN_DIR, `whisper-cli-${triple}${ext(triple)}`);
const stampPath = (triple) => join(BIN_DIR, `.whisper-${triple}.recipe`);
const current = (triple) =>
  existsSync(binPath(triple)) && statSync(binPath(triple)).size > MIN_SIZE && existsSync(stampPath(triple)) && readFileSync(stampPath(triple), 'utf8').trim() === RECIPE;

function hostTriple() {
  const out = execFileSync('rustc', ['-vV']).toString();
  return out.split('\n').find((l) => l.startsWith('host: ')).slice('host: '.length).trim();
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** 下载并解压源码，返回源码目录 */
async function fetchSource() {
  const dir = join(WORK, `whisper.cpp-${SOURCE.version}`);
  if (existsSync(join(dir, '.ok'))) return dir;
  mkdirSync(WORK, { recursive: true });
  const archive = join(WORK, `whisper.cpp-${SOURCE.version}.tar.gz`);
  if (!existsSync(archive) || sha256(archive) !== SOURCE.sha256) {
    console.log(`  下载 whisper.cpp ${SOURCE.version}`);
    const res = await fetch(SOURCE.url);
    if (!res.ok) throw new Error(`下载 ${SOURCE.url} 失败：HTTP ${res.status}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  }
  const actual = sha256(archive);
  if (actual !== SOURCE.sha256) throw new Error(`whisper.cpp 源码校验失败：期望 ${SOURCE.sha256}，实际 ${actual}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', dir, '--strip-components=1'], { stdio: 'inherit' });
  writeFileSync(join(dir, '.ok'), '');
  return dir;
}

async function build(triple) {
  const flags = TARGETS[triple];
  if (!flags) throw new Error(`随应用分发的 whisper-cli 暂不支持 ${triple}（可选：${Object.keys(TARGETS).join(', ')}）`);
  const src = await fetchSource();
  const out = join(WORK, `build-${triple}`);
  rmSync(out, { recursive: true, force: true });
  console.log(`  编译 whisper-cli（${triple}，约 1–3 分钟）`);
  execFileSync(
    'cmake',
    ['-S', src, '-B', out, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_SDL2=OFF', '-DWHISPER_CURL=OFF', ...flags],
    { stdio: 'inherit' }
  );
  execFileSync('cmake', ['--build', out, '--config', 'Release', '-j', '--target', 'whisper-cli'], { stdio: 'inherit' });
  const built = [join(out, 'bin', `whisper-cli${ext(triple)}`), join(out, 'bin', 'Release', `whisper-cli${ext(triple)}`)].find(existsSync);
  if (!built) throw new Error('没有找到编好的 whisper-cli');
  mkdirSync(BIN_DIR, { recursive: true });
  copyFileSync(built, binPath(triple));
  if (!triple.includes('windows')) execFileSync('strip', [binPath(triple)], { stdio: 'ignore' });
  writeFileSync(stampPath(triple), RECIPE);
  console.log(`whisper-cli → ${binPath(triple)}`);
}

async function prepare(triple) {
  if (current(triple)) return;
  if (triple === 'universal-apple-darwin') {
    const parts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
    for (const t of parts) await prepare(t);
    execFileSync('lipo', ['-create', '-output', binPath(triple), ...parts.map(binPath)], { stdio: 'inherit' });
    writeFileSync(stampPath(triple), RECIPE);
    console.log(`whisper-cli → ${binPath(triple)}`);
    return;
  }
  await build(triple);
}

try {
  const args = process.argv.slice(2);
  for (const triple of args.length ? args : [hostTriple()]) await prepare(triple);
} catch (e) {
  console.error(`whisper-cli 准备失败：${e.message}`);
  process.exit(1);
}
