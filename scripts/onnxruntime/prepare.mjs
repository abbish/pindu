// 准备随应用分发的 ONNX Runtime（发音评估、语音输入；程序运行时加载，见 src-tauri/src/onnx_runtime.rs）：
// 按 sources.json 下载微软官方预编译包（校验 sha256）→ 取出库文件放到 src-tauri/resources/onnxruntime/（不入库）。
// 打包时 macOS 放进 Contents/Frameworks（tauri.macos.conf.json），Windows 放进资源目录（tauri.windows.conf.json）。
// 已有、且本目录的配置没变就跳过。
// 用法：node scripts/onnxruntime/prepare.mjs [target-triple]   （默认：rustc 的 host triple；Mac 的三种 triple 都出同一个通用库）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT_DIR = join(ROOT, 'src-tauri', 'resources', 'onnxruntime');
const WORK = join(ROOT, 'src-tauri', 'target', 'onnxruntime');
const SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));
const RECIPE = createHash('sha256')
  .update(readFileSync(join(HERE, 'prepare.mjs')))
  .update(readFileSync(join(HERE, 'sources.json')))
  .digest('hex');

function hostTriple() {
  const out = execFileSync('rustc', ['-vV']).toString();
  return out.split('\n').find((l) => l.startsWith('host: ')).slice('host: '.length).trim();
}

/** triple → 要用的包与输出文件名（Mac 不管哪个 triple 都出同一个通用库：两个架构合在一起） */
function planFor(triple) {
  if (triple.endsWith('apple-darwin')) return { keys: ['macos-arm64', 'macos-x86_64'], output: 'libonnxruntime.dylib' };
  if (triple === 'x86_64-pc-windows-msvc') return { keys: ['windows-x86_64'], output: 'onnxruntime.dll' };
  if (triple === 'aarch64-pc-windows-msvc') return { keys: ['windows-aarch64'], output: 'onnxruntime.dll' };
  return null;
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** 下载（校验 sha256）并解压一个官方包，返回其中库文件的路径 */
async function fetchLib(key) {
  const pkg = SOURCES.packages[key];
  mkdirSync(WORK, { recursive: true });
  const archive = join(WORK, pkg.url.split('/').pop());
  if (!existsSync(archive) || sha256(archive) !== pkg.sha256) {
    console.log(`  下载 ONNX Runtime ${pkg.version}（${key}）`);
    const res = await fetch(pkg.url);
    if (!res.ok) throw new Error(`下载 ${pkg.url} 失败：HTTP ${res.status}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  }
  const actual = sha256(archive);
  if (actual !== pkg.sha256) throw new Error(`ONNX Runtime（${key}）校验失败：期望 ${pkg.sha256}，实际 ${actual}`);
  const extracted = join(WORK, `extract-${key}`);
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  // tar 能解 .tgz，也能解 .zip（macOS 的 bsdtar、Windows 10 起自带的 tar.exe）
  execFileSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'inherit' });
  const lib = join(extracted, pkg.lib);
  if (!existsSync(lib)) throw new Error(`官方包里没有找到 ${pkg.lib}`);
  if (!pkg.arch) return lib;
  // 只要其中一个架构
  const thin = join(extracted, `thin-${pkg.arch}`);
  execFileSync('lipo', [lib, '-thin', pkg.arch, '-output', thin], { stdio: 'inherit' });
  return thin;
}

async function prepare(triple) {
  const plan = planFor(triple);
  if (!plan) {
    console.log(`ONNX Runtime：${triple} 不分发（只支持 macOS 与 Windows），跳过`);
    return;
  }
  const output = join(OUT_DIR, plan.output);
  const stamp = join(OUT_DIR, '.recipe');
  const recipe = `${RECIPE}:${plan.keys.join(',')}`;
  if (existsSync(output) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === recipe) return;

  const libs = [];
  for (const key of plan.keys) libs.push(await fetchLib(key));
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (libs.length > 1) {
    execFileSync('lipo', ['-create', '-output', output, ...libs], { stdio: 'inherit' });
    // 合并后重新做临时签名（Apple 芯片不加载没有有效签名的库；打包时会再按应用的签名重签）
    execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' });
  } else copyFileSync(libs[0], output);
  writeFileSync(stamp, recipe);
  console.log(`ONNX Runtime → ${output}`);
}

try {
  const [triple] = process.argv.slice(2);
  await prepare(triple ?? hostTriple());
} catch (e) {
  console.error(`ONNX Runtime 准备失败：${e.message}`);
  process.exit(1);
}
