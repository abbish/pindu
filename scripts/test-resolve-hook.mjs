// node --test 的模块解析钩子：让测试可以导入项目中不带扩展名的相对路径（./foo → ./foo.ts / ./foo.tsx / ./foo/index.ts）。
// 仅用于测试运行，不影响 Vite 构建。由 package.json 的 test 脚本通过 --import 注册。
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  return next(specifier, context);
}

if (!process.env.__REDLARK_HOOK_REGISTERED) {
  process.env.__REDLARK_HOOK_REGISTERED = '1';
  register(import.meta.url);
}
