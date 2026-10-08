// 汇总三个系统的构建产物，整理成 GitHub Release 的附件，并生成应用内更新用的 latest.json。
//
// 用法：node scripts/release-assets.mjs <产物目录> <输出目录> [--notes-file <更新说明.md>]
//   产物目录：各系统 `npm run package` 生成的 release/<版本>-<平台>/（CI 下载后放在一起，可多层嵌套）
//   输出目录：改成英文文件名的安装包 + latest.json（附件名带中文时下载链接不稳定，统一用 Pindu_<版本>_…）
//
// latest.json 的格式见 Tauri updater 文档：每个平台 { url, signature }，signature 是 .sig 文件的内容。
// 应用读取 https://github.com/abbish/pindu/releases/latest/download/latest.json（只有正式发布、非草稿的 Release 才算 latest）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'abbish/pindu';

const [inputDir, outputDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const notesIndex = process.argv.indexOf('--notes-file');
if (!inputDir || !outputDir) {
  console.error('用法：node scripts/release-assets.mjs <产物目录> <输出目录> [--notes-file <更新说明.md>]');
  process.exit(2);
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const download = (name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;

/** 递归列出文件 */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) return [path];
    return name.endsWith('.app') ? [] : walk(path); // .app 目录本身不上传（mac 用 dmg 和 .app.tar.gz）
  });
}
const files = walk(inputDir);
const find = (re) => files.filter((f) => re.test(basename(f)));
const one = (re, what) => {
  const hits = find(re);
  if (hits.length !== 1) throw new Error(`应恰好有 1 个${what}，实际 ${hits.length} 个：${hits.map((f) => basename(f)).join(', ') || '无'}`);
  return hits[0];
};

mkdirSync(outputDir, { recursive: true });
const assets = [];
function publish(src, name) {
  copyFileSync(src, join(outputDir, name));
  assets.push(name);
  return name;
}
/** 更新包：复制安装包并读取签名 */
function updaterAsset(src, name) {
  const sig = `${src}.sig`;
  if (!existsSync(sig)) throw new Error(`缺少更新签名：${basename(sig)}（发布构建需要设置 TAURI_SIGNING_PRIVATE_KEY）`);
  publish(src, name);
  publish(sig, `${name}.sig`);
  return { url: download(name), signature: readFileSync(sig, 'utf8').trim() };
}

const platforms = {};

// macOS：universal 包同时服务 Apple 芯片与 Intel
const macUpdate = updaterAsset(one(/\.app\.tar\.gz$/, ' macOS 更新包（.app.tar.gz）'), `Pindu_${version}_universal.app.tar.gz`);
platforms['darwin-aarch64'] = macUpdate;
platforms['darwin-x86_64'] = macUpdate;
for (const dmg of find(/\.dmg$/)) publish(dmg, `Pindu_${version}_universal.dmg`);

// Windows：NSIS 安装器即更新包
platforms['windows-x86_64'] = updaterAsset(one(/-setup\.exe$/, ' Windows 安装器（*-setup.exe）'), `Pindu_${version}_x64-setup.exe`);
for (const msi of find(/\.msi$/)) publish(msi, `Pindu_${version}_x64.msi`);

// Linux：只有 AppImage 支持应用内更新；deb / rpm 供手动安装
platforms['linux-x86_64'] = updaterAsset(one(/\.AppImage$/, ' Linux AppImage'), `Pindu_${version}_amd64.AppImage`);
for (const deb of find(/\.deb$/)) publish(deb, `Pindu_${version}_amd64.deb`);
for (const rpm of find(/\.rpm$/)) publish(rpm, `Pindu_${version}_x86_64.rpm`);

const notes =
  notesIndex > 0 && process.argv[notesIndex + 1]
    ? readFileSync(process.argv[notesIndex + 1], 'utf8').trim()
    : `拼读 ${version}，更新内容见 https://github.com/${REPO}/releases/tag/${tag}`;
const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(join(outputDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
assets.push('latest.json');

console.log(`拼读 ${tag}：${assets.length} 个附件 → ${outputDir}`);
for (const a of assets) console.log(`  ${a}`);
