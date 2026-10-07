#!/usr/bin/env python3
"""CSS 自定义属性对账：src/ 中 var(--x) 引用的变量必须在某处被定义。

未定义且无 fallback 的 var() 会让整条声明失效（颜色/间距静默消失，例如逾期色块不可见）。
定义来源：任意 .css 中的 `--x:` 声明，以及 .tsx/.ts 内联 style 里的 `'--x':` 键；
Tailwind v4 内置的主题变量（--spacing、--tw-*）由 Tailwind 生成、--radix-* 由 Radix 运行时写入，视为已定义。
用法: python3 scripts/check-css-vars.py    退出码: 存在未定义引用时为 1
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')


def main() -> int:
    files = [p for ext in ('css', 'ts', 'tsx') for p in glob.glob(f'{SRC}/**/*.{ext}', recursive=True)]
    defined: set[str] = set()
    uses: list[tuple[str, int, str]] = []
    for path in files:
        text = open(path, encoding='utf-8').read()
        defined.update(re.findall(r"""['"]?(--[\w-]+)['"]?\s*:""", text))
        for lineno, line in enumerate(text.split('\n'), 1):
            for name, rest in re.findall(r'var\(\s*(--[\w-]+)\s*([,)])', line):
                if rest == ')':  # 带 fallback 的引用不报
                    uses.append((os.path.relpath(path, ROOT), lineno, name))
    tailwind_builtin = lambda n: n == '--spacing' or n.startswith(('--tw-', '--radix-'))
    missing = [u for u in uses if u[2] not in defined and not tailwind_builtin(u[2])]
    for f, n, name in missing:
        print(f'E {f}:{n} 未定义的 CSS 变量 {name}')
    print(f'check-css-vars: 引用 {len(uses)} 处, 未定义 {len(missing)} 处')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
