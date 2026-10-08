#!/usr/bin/env node
// 一键构建安装包（跨平台，零依赖，只用 Node 内置模块）。
// 应用不签名发布，用户在自己的机器上构建：检查环境 → 安装依赖 → 编译 agent sidecar → 准备 ffmpeg → tauri build → 收集产物到 release/。
// 开发者本地打包工具，用法见 CONTRIBUTING.md「本地打包」，或 node scripts/package.mjs --help
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, platform } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = platform === 'win32';
const MIN_NODE_MAJOR = 20;

const HELP = `一键构建安装包（不签名，供在本机构建后使用）

用法:
  npm run package [-- 选项]
  node scripts/package.mjs [选项]
  ./build.sh [选项]          (macOS / Linux)
  build.cmd [选项]           (Windows)

选项:
  --target <目标>     构建目标，默认本机。可选:
                        mac-arm / mac-intel / mac-universal
                        win / win-arm
                        linux / linux-arm
                      也可直接写 Rust target triple（如 aarch64-apple-darwin）
  --bundles <列表>    安装包格式，逗号分隔。默认:
                        macOS  app,dmg
                        Windows nsis（可加 msi）
                        Linux  deb,appimage（Fedora 等为 rpm,appimage）
  --no-bundle         只编译可执行文件，不生成安装包
  --check             只检查构建环境，不构建
  --skip-install      跳过 npm 依赖安装
  --clean             构建前清理 dist 与 Rust 编译缓存（很慢，仅在构建出错时使用）
  --debug             构建调试版（编译快，体积大，带开发者工具）
  -h, --help          显示本帮助
`;

/** 友好的目标别名 → Rust target triple */
const TARGET_ALIASES = {
  'mac-arm': 'aarch64-apple-darwin',
  'mac-intel': 'x86_64-apple-darwin',
  'mac-universal': 'universal-apple-darwin',
  win: 'x86_64-pc-windows-msvc',
  'win-arm': 'aarch64-pc-windows-msvc',
  linux: 'x86_64-unknown-linux-gnu',
  'linux-arm': 'aarch64-unknown-linux-gnu',
};
const SUPPORTED_TRIPLES = new Set(Object.values(TARGET_ALIASES));

// ───────────────────────── 输出 ─────────────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');
const dim = paint('2');

let stepNo = 0;
const TOTAL_STEPS = 5;
function step(title) {
  stepNo += 1;
  console.log(`\n${bold(`[${stepNo}/${TOTAL_STEPS}] ${title}`)}`);
}
function fail(message, hint) {
  console.error(`\n${red('✗ ' + message)}`);
  if (hint) console.error(hint.replace(/^/gm, '  '));
  process.exit(1);
}

// ───────────────────────── 参数 ─────────────────────────
function parseArgs(argv) {
  const opts = { target: null, bundles: null, noBundle: false, check: false, skipInstall: false, clean: false, debug: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) fail(`${a} 需要一个值`, HELP);
      i += 1;
      return v;
    };
    switch (a) {
      case '--target': opts.target = value(); break;
      case '--bundles': opts.bundles = value(); break;
      case '--no-bundle': opts.noBundle = true; break;
      case '--check': opts.check = true; break;
      case '--skip-install': opts.skipInstall = true; break;
      case '--clean': opts.clean = true; break;
      case '--debug': opts.debug = true; break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default: fail(`未知选项 ${a}`, HELP);
    }
  }
  return opts;
}

// ───────────────────────── 命令执行 ─────────────────────────
/** 运行命令并继承输出；失败直接退出 */
function run(cmd, args, { cwd = ROOT, env, shell = false, failMessage, hint } = {}) {
  console.log(dim(`$ ${[cmd, ...args].join(' ')}`));
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell });
  if (r.error || r.status !== 0) fail(failMessage ?? `命令失败：${cmd} ${args.join(' ')}`, hint);
}

/** 静默运行，返回 stdout（失败返回 null） */
function capture(cmd, args, { shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? '').trim();
}

/** 用当前 npm 运行（通过 npm run 启动时直接复用 npm-cli.js，避免 Windows 上 npm.cmd 需要 shell） */
function npm(args, cwd = ROOT) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.(c?js)$/.test(npmCli)) {
    run(process.execPath, [npmCli, ...args], { cwd });
  } else {
    run('npm', args, { cwd, shell: IS_WIN });
  }
}

// ───────────────────────── 目标 ─────────────────────────
function hostTriple() {
  const out = capture('rustc', ['-vV']);
  const line = out?.split('\n').find((l) => l.startsWith('host: '));
  return line ? line.slice('host: '.length).trim() : null;
}

function osOf(triple) {
  if (triple.includes('apple-darwin')) return 'darwin';
  if (triple.includes('windows')) return 'win32';
  if (triple.includes('linux')) return 'linux';
  return 'unknown';
}

function resolveTarget(requested, host) {
  const triple = requested ? (TARGET_ALIASES[requested] ?? requested) : host;
  if (!SUPPORTED_TRIPLES.has(triple)) {
    fail(`不支持的构建目标：${requested}`, `可选：${Object.keys(TARGET_ALIASES).join(' / ')}`);
  }
  if (osOf(triple) !== platform) {
    fail(
      `不能在当前系统上构建 ${triple}`,
      '安装包只能在对应的系统上构建：macOS 包在 Mac 上构建，Windows 包在 Windows 上构建，Linux 包在 Linux 上构建。',
    );
  }
  if (platform === 'linux' && host && triple !== host) {
    fail(`Linux 不支持跨架构构建（本机 ${host}，目标 ${triple}）`, '请在目标架构的 Linux 机器上构建。');
  }
  return triple;
}

/** universal 由两个架构合成 */
function rustTargetsFor(triple) {
  return triple === 'universal-apple-darwin' ? ['aarch64-apple-darwin', 'x86_64-apple-darwin'] : [triple];
}

function linuxDistro() {
  try {
    const text = readFileSync('/etc/os-release', 'utf8');
    const get = (k) => text.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm'))?.[1] ?? '';
    return `${get('ID')} ${get('ID_LIKE')}`.toLowerCase();
  } catch {
    return '';
  }
}

function defaultBundles() {
  if (platform === 'darwin') return 'app,dmg';
  if (platform === 'win32') return 'nsis';
  const distro = linuxDistro();
  if (/fedora|rhel|centos|suse|opensuse/.test(distro)) return 'rpm,appimage';
  if (/debian|ubuntu/.test(distro)) return 'deb,appimage';
  return 'appimage';
}

// ───────────────────────── 环境检查 ─────────────────────────
const RUST_HINT = `安装 Rust：
  macOS / Linux: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  Windows:       https://rustup.rs 下载 rustup-init.exe
装好后重新打开终端再运行。`;

function linuxDepsHint() {
  const distro = linuxDistro();
  if (/debian|ubuntu/.test(distro)) {
    return 'sudo apt update && sudo apt install -y build-essential curl wget file pkg-config libssl-dev libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev';
  }
  if (/fedora|rhel|centos/.test(distro)) {
    return 'sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file libxdo-devel librsvg2-devel pkgconf-pkg-config && sudo dnf group install -y "c-development"';
  }
  if (/arch|manjaro/.test(distro)) {
    return 'sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl xdotool librsvg pkgconf';
  }
  if (/suse/.test(distro)) {
    return 'sudo zypper in webkit2gtk3-devel libopenssl-devel curl wget file librsvg-devel pkg-config && sudo zypper in -t pattern devel_basis';
  }
  return '参考 https://v2.tauri.app/start/prerequisites/#linux 安装 WebKitGTK 4.1、OpenSSL、librsvg 开发包';
}

/** 返回 { problems: [{ title, hint }], warnings: [...] } */
function checkEnvironment(triple, rustTargets, bundles) {
  const problems = [];
  const warnings = [];
  const ok = (s) => console.log(`  ${green('✓')} ${s}`);
  const bad = (title, hint) => { console.log(`  ${red('✗')} ${title}`); problems.push({ title, hint }); };
  const warn = (title, hint) => { console.log(`  ${yellow('!')} ${title}`); warnings.push({ title, hint }); };

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= MIN_NODE_MAJOR) ok(`Node.js ${process.versions.node}`);
  else bad(`Node.js 版本过低（${process.versions.node}），需要 ${MIN_NODE_MAJOR} 或更高`, '从 https://nodejs.org 安装 LTS 版本');

  const rustc = capture('rustc', ['-V']);
  const cargo = capture('cargo', ['-V']);
  if (rustc && cargo) ok(rustc);
  else bad('没有找到 Rust（rustc / cargo）', RUST_HINT);

  if (rustc) {
    const installed = capture('rustup', ['target', 'list', '--installed']);
    if (installed === null) {
      // 不是 rustup 安装的 Rust（如发行版自带），只能构建本机目标
      if (triple !== hostTriple()) bad(`没有 rustup，无法添加构建目标 ${triple}`, RUST_HINT);
    } else {
      const have = new Set(installed.split('\n').map((s) => s.trim()));
      const missing = rustTargets.filter((t) => !have.has(t));
      if (missing.length) {
        console.log(`  ${dim('…')} 添加 Rust 构建目标 ${missing.join(', ')}`);
        const r = spawnSync('rustup', ['target', 'add', ...missing], { stdio: 'inherit' });
        if (r.status === 0) ok(`Rust 构建目标 ${rustTargets.join(', ')}`);
        else bad(`无法添加 Rust 构建目标 ${missing.join(', ')}`, `手动运行：rustup target add ${missing.join(' ')}`);
      } else {
        ok(`Rust 构建目标 ${rustTargets.join(', ')}`);
      }
    }
  }

  if (platform === 'darwin') {
    if (capture('xcode-select', ['-p'])) ok('Xcode 命令行工具');
    else bad('没有安装 Xcode 命令行工具', '运行：xcode-select --install');
  }

  if (platform === 'linux') {
    const modules = ['webkit2gtk-4.1', 'javascriptcoregtk-4.1', 'libsoup-3.0', 'librsvg-2.0', 'openssl'];
    if (capture('pkg-config', ['--version']) === null) {
      bad('没有找到 pkg-config 与系统开发库', linuxDepsHint());
    } else {
      const missing = modules.filter((m) => capture('pkg-config', ['--exists', m]) === null);
      if (missing.length) bad(`缺少系统开发库：${missing.join(', ')}`, linuxDepsHint());
      else ok('WebKitGTK 4.1 / OpenSSL / librsvg 开发库');
    }
    if (bundles?.includes('appimage') && capture('file', ['--version']) === null) {
      bad('缺少 file 命令（打 AppImage 需要）', linuxDepsHint());
    }
  }

  if (platform === 'win32') {
    const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    const component = triple.startsWith('aarch64')
      ? 'Microsoft.VisualStudio.Component.VC.Tools.ARM64'
      : 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64';
    const vsPath = existsSync(vswhere)
      ? capture(vswhere, ['-latest', '-products', '*', '-requires', component, '-property', 'installationPath'])
      : null;
    if (vsPath) ok('Visual Studio C++ 生成工具');
    else bad(
      '没有找到 Visual Studio C++ 生成工具（MSVC）',
      '从 https://visualstudio.microsoft.com/visual-cpp-build-tools/ 安装 “Build Tools for Visual Studio”，\n勾选「使用 C++ 的桌面开发」（含 MSVC 与 Windows SDK）。',
    );
    const webview = ['HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}']
      .some((key) => capture('reg', ['query', key, '/v', 'pv']) !== null);
    if (webview) ok('WebView2 运行时');
    else warn('没有检测到 WebView2 运行时（Windows 10/11 通常自带；安装包会在需要时自动下载）');
  }

  checkFfmpeg(triple, rustTargets, ok, bad, warn);

  return { problems, warnings };
}

/** 随应用分发的 ffmpeg（scripts/ffmpeg/）：已编好或有 CI 产物时不需要编译工具 */
function checkFfmpeg(triple, rustTargets, ok, bad, warn) {
  const ext = triple.includes('windows') ? '.exe' : '';
  const built = [triple, ...rustTargets].every((t) =>
    ['ffmpeg', 'ffprobe'].every((n) => {
      const p = join(ROOT, 'src-tauri', 'binaries', `${n}-${t}${ext}`);
      return existsSync(p) && statSync(p).size > 1024 * 1024;
    }));
  if (built) return ok('视频组件 ffmpeg（已编译）');
  if (process.env.FFMPEG_PREBUILT_DIR) return ok(`视频组件 ffmpeg（使用 ${process.env.FFMPEG_PREBUILT_DIR}）`);
  if (platform === 'win32') {
    return bad('缺少视频组件 ffmpeg', 'Windows 上不能编译 ffmpeg：在 Linux / WSL 上运行\n  node scripts/ffmpeg/prepare.mjs --out <目录> x86_64-pc-windows-msvc\n再设置环境变量 FFMPEG_PREBUILT_DIR=<目录> 后重新构建。');
  }
  const hint = platform === 'darwin'
    ? 'brew install meson ninja pkgconf nasm'
    : /debian|ubuntu/.test(linuxDistro()) ? 'sudo apt install -y meson ninja-build nasm pkg-config zlib1g-dev' : '安装 meson、ninja、nasm、pkg-config 与 zlib 开发包';
  const missing = ['make', 'meson', 'ninja', 'pkg-config'].filter((c) => capture(c, ['--version']) === null);
  if (missing.length) return bad(`编译视频组件 ffmpeg 需要：${missing.join('、')}`, hint);
  ok('视频组件 ffmpeg 编译工具（首次构建时编译，约 2–5 分钟）');
  if (rustTargets.some((t) => t.startsWith('x86_64')) && capture('nasm', ['-v']) === null) {
    warn('没有 nasm：x86_64 的 ffmpeg 不带汇编优化，转码会慢很多', hint);
  }
}

// ───────────────────────── 构建步骤 ─────────────────────────
/** lockfile 比 node_modules 新或依赖目录不存在时安装 */
function needsInstall(dir) {
  const modules = join(dir, 'node_modules');
  const lock = join(dir, 'package-lock.json');
  const marker = join(modules, '.package-lock.json');
  if (!existsSync(modules) || !existsSync(marker)) return true;
  return existsSync(lock) && statSync(lock).mtimeMs > statSync(marker).mtimeMs;
}

function installDeps(dir, label) {
  if (!needsInstall(dir)) {
    console.log(`  ${green('✓')} ${label}依赖已是最新`);
    return;
  }
  console.log(`  安装${label}依赖…`);
  npm([existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], dir);
}

function tauriBuild(triple, opts, bundles) {
  const tauriCli = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!existsSync(tauriCli)) fail('没有找到 Tauri CLI', '去掉 --skip-install 重新运行，让脚本安装依赖。');
  const args = [tauriCli, 'build', '--target', triple];
  if (opts.debug) args.push('--debug');
  if (opts.noBundle) args.push('--no-bundle');
  else args.push('--bundles', bundles);
  const config = {};
  // 没有开发者证书：macOS 用 ad-hoc 签名，保证 Apple 芯片上能运行、拷到别的 Mac 时签名完整
  if (platform === 'darwin' && !process.env.APPLE_SIGNING_IDENTITY) {
    config.bundle = { macOS: { signingIdentity: '-' } };
  }
  // 发布构建（CI 带更新签名私钥）：额外生成带签名的更新包（.app.tar.gz / setup.exe / AppImage + .sig）；
  // 自己构建时没有私钥，不生成，应用照样能安装官方发布的更新
  if (process.env.TAURI_SIGNING_PRIVATE_KEY && !opts.noBundle) {
    config.bundle = { ...config.bundle, createUpdaterArtifacts: true };
    console.log('  检测到更新签名私钥：同时生成签名的更新包');
  }
  if (Object.keys(config).length) args.push('--config', JSON.stringify(config));
  run(process.execPath, args, {
    failMessage: 'Tauri 构建失败',
    hint: [
      '向上翻看第一条 error 信息。常见原因：',
      '- 下载依赖超时：网络问题，可配置镜像后重试（见 CONTRIBUTING.md「打包出问题」）',
      platform === 'darwin' ? '- 生成 dmg 失败：改用 --bundles app 只生成 .app' : '',
      platform === 'linux' ? '- 生成 AppImage 失败（需从 GitHub 下载工具）：改用 --bundles deb 或 rpm' : '',
      platform === 'win32' ? '- 生成 msi 失败：只用 --bundles nsis' : '',
      '- 编译缓存损坏：加 --clean 重试',
    ].filter(Boolean).join('\n'),
  });
}

function bundleDir(triple, debug) {
  return join(ROOT, 'src-tauri', 'target', triple, debug ? 'debug' : 'release');
}

/** 把安装包 / 可执行文件复制到 release/<版本>-<目标>/ */
function collectArtifacts(triple, opts, version) {
  const outDir = join(ROOT, 'release', `${version}-${triple}${opts.debug ? '-debug' : ''}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const base = bundleDir(triple, opts.debug);
  const collected = [];

  if (opts.noBundle) {
    const exe = join(base, IS_WIN ? 'pindu-app.exe' : 'pindu-app');
    const sidecars = ['redlark-agent', 'ffmpeg', 'ffprobe'].map((n) => join(base, `${n}${IS_WIN ? '.exe' : ''}`));
    for (const f of [exe, ...sidecars]) {
      if (existsSync(f)) {
        const dest = join(outDir, relative(base, f));
        copyFileSync(f, dest);
        collected.push(dest);
      }
    }
    return { outDir, collected };
  }

  const bundleRoot = join(base, 'bundle');
  if (!existsSync(bundleRoot)) return { outDir, collected };
  for (const kind of readdirSync(bundleRoot)) {
    const dir = join(bundleRoot, kind);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      const src = join(dir, name);
      const isApp = name.endsWith('.app');
      // 安装包，以及发布构建的更新包与签名（.app.tar.gz / .sig）
      const isPackage = /\.(dmg|exe|msi|deb|rpm|AppImage|tar\.gz|sig)$/.test(name);
      if (!isApp && !isPackage) continue;
      const dest = join(outDir, name);
      if (isApp) cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
      else copyFileSync(src, dest);
      collected.push(dest);
    }
  }
  return { outDir, collected };
}

function sizeOf(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, n) => sum + sizeOf(join(path, n)), 0);
}
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function printNextSteps(collected) {
  console.log(`\n${bold('如何安装')}`);
  if (platform === 'darwin') {
    console.log(`  打开 .dmg，把「拼读」拖进「应用程序」。本机构建的应用可以直接打开。
  拷到别的 Mac 上时，系统会提示“无法验证开发者”，在那台 Mac 上执行一次：
    xattr -dr com.apple.quarantine "/Applications/拼读.app"
  或在「系统设置 → 隐私与安全性」底部点「仍要打开」。`);
  } else if (platform === 'win32') {
    console.log(`  双击 *-setup.exe 安装。拷到别的电脑时如果出现 SmartScreen 提示，
  点「更多信息 → 仍要运行」。`);
  } else {
    const hasDeb = collected.some((p) => p.endsWith('.deb'));
    const hasRpm = collected.some((p) => p.endsWith('.rpm'));
    if (hasDeb) console.log('  sudo apt install ./<文件名>.deb');
    if (hasRpm) console.log('  sudo dnf install ./<文件名>.rpm');
    if (collected.some((p) => p.endsWith('.AppImage'))) console.log('  或：chmod +x <文件名>.AppImage 后直接运行');
  }
}

// ───────────────────────── 主流程 ─────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  console.log(bold(`拼读 ${version} · 一键构建`) + dim(`  (${platform}-${arch}, Node ${process.versions.node})`));

  step('检查构建环境');
  const host = hostTriple();
  // Rust 缺失时先用 Node 推断出的目标完成其余检查，最后统一报错
  const fallbackHost = { darwin: arch === 'arm64' ? 'mac-arm' : 'mac-intel', win32: arch === 'arm64' ? 'win-arm' : 'win', linux: arch === 'arm64' ? 'linux-arm' : 'linux' }[platform];
  if (!fallbackHost) fail(`不支持的系统：${platform}`);
  const triple = resolveTarget(opts.target, host ?? TARGET_ALIASES[fallbackHost]);
  const bundles = opts.noBundle ? null : (opts.bundles ?? defaultBundles());
  console.log(`  目标 ${bold(triple)}${bundles ? `，安装包 ${bold(bundles)}` : '，只编译可执行文件'}${opts.debug ? '（调试版）' : ''}`);
  const { problems } = checkEnvironment(triple, rustTargetsFor(triple), bundles);
  if (problems.length) {
    console.error(`\n${red(`构建环境还差 ${problems.length} 项，按下面的提示安装后重新运行：`)}`);
    for (const p of problems) {
      console.error(`\n${bold('• ' + p.title)}`);
      if (p.hint) console.error(p.hint.replace(/^/gm, '    '));
    }
    process.exit(1);
  }
  if (opts.check) {
    console.log(`\n${green('✓ 构建环境就绪')}，运行 npm run package 开始构建。`);
    return;
  }

  step('安装依赖');
  if (opts.skipInstall) console.log(dim('  已跳过（--skip-install）'));
  else {
    installDeps(ROOT, '应用');
    installDeps(join(ROOT, 'agent'), 'AI 助手');
  }

  if (opts.clean) {
    console.log('  清理 dist 与 Rust 编译缓存…');
    rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
    rmSync(join(ROOT, 'src-tauri', 'target'), { recursive: true, force: true });
  }

  step('编译 AI 助手（agent sidecar）');
  run(process.execPath, [join(ROOT, 'agent', 'scripts', 'build.mjs'), triple], { failMessage: 'AI 助手编译失败' });

  step('准备视频组件（ffmpeg）');
  run(process.execPath, [join(ROOT, 'scripts', 'ffmpeg', 'prepare.mjs'), triple], { failMessage: '视频组件 ffmpeg 准备失败' });

  step('构建应用（首次会编译全部 Rust 依赖，约 5–15 分钟）');
  // 清掉上次的安装包，避免把改名前的旧产物一起收集
  rmSync(join(bundleDir(triple, opts.debug), 'bundle'), { recursive: true, force: true });
  const started = Date.now();
  tauriBuild(triple, opts, bundles);
  console.log(dim(`  用时 ${Math.round((Date.now() - started) / 1000)} 秒`));

  step('收集产物');
  const { outDir, collected } = collectArtifacts(triple, opts, version);
  if (!collected.length) fail('构建完成，但没有找到产物', `请查看 ${relative(ROOT, bundleDir(triple, opts.debug))}`);
  for (const p of collected) console.log(`  ${green('✓')} ${relative(ROOT, p)}  ${dim(mb(sizeOf(p)))}`);
  console.log(`\n${green('✓ 构建完成')}：${relative(ROOT, outDir)}`);
  if (!opts.noBundle) printNextSteps(collected);
}

main();
