#!/usr/bin/env python3
"""IPC contract 静态对账：前端 invoke ↔ lib.rs 注册 ↔ #[tauri::command] 签名。

检查（失败 = 退出码 1）：
  E1 前端调用的命令未在 lib.rs generate_handler! 注册
  E2 lib.rs 注册的命令找不到 #[tauri::command] 定义
  E3 前端传入的参数键无法映射到 Rust 参数（camelCase → snake_case）
  E4 Rust 必填参数（非 Option<>）前端未传
  E5 lib.rs 中同一命令重复注册
提示（不影响退出码）：
  W1 已注册但前端从未调用的命令
  W2 前端 args 为变量或含展开（...x），无法静态检查键
用法: python3 scripts/check-ipc-contract.py [--warnings]
"""
import glob
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RS = os.path.join(ROOT, 'src-tauri', 'src')
TS = os.path.join(ROOT, 'src')
INJECTED = re.compile(r'\b(AppHandle|State\s*<|Window\b|WebviewWindow|tauri::)')


def strip_rs_comments(t):
    t = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), t, flags=re.S)
    return re.sub(r'//[^\n]*', lambda m: ' ' * len(m.group(0)), t)


def split_top(s, sep=','):
    parts, depth, cur = [], 0, ''
    for ch in s:
        if ch in '<([{':
            depth += 1
        elif ch in '>)]}':
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def balanced(text, start, open_ch, close_ch):
    """text[start] == open_ch；返回匹配闭合位置的内容。"""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == open_ch:
            depth += 1
        elif text[i] == close_ch:
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return None


def snake_to_camel(s):
    head, *rest = s.split('_')
    return head + ''.join(w[:1].upper() + w[1:] for w in rest)


def rust_commands():
    cmds = {}
    for path in glob.glob(os.path.join(RS, '**', '*.rs'), recursive=True):
        text = strip_rs_comments(open(path, encoding='utf-8').read())
        for m in re.finditer(r'#\[tauri::command(\([^)]*\))?\]', text):
            rename_snake = bool(m.group(1) and 'snake_case' in m.group(1))
            fm = re.compile(r'\s*(?:#\[[^\]]*\]\s*)*pub\s+(?:async\s+)?fn\s+([a-z_0-9]+)\s*(?:<[^>]*>)?\s*\(').match(text, m.end())
            if not fm:
                continue
            name = fm.group(1)
            params_src = balanced(text, fm.end() - 1, '(', ')') or ''
            params = []
            for p in split_top(params_src):
                if ':' not in p:
                    continue
                pname, ptype = p.split(':', 1)
                pname = pname.strip().lstrip('_') if pname.strip().startswith('_') and False else pname.strip()
                ptype = ptype.strip()
                if INJECTED.search(ptype) or pname in ('app', '_app', 'window'):
                    continue
                params.append((pname.lstrip('_'), ptype, ptype.startswith('Option<')))
            rel = os.path.relpath(path, ROOT)
            line = text.count('\n', 0, fm.start()) + 1
            cmds.setdefault(name, []).append({'file': rel, 'line': line, 'params': params,
                                              'snake': rename_snake,
                                              'module': os.path.splitext(os.path.basename(path))[0]})
    return cmds


def registered():
    text = strip_rs_comments(open(os.path.join(RS, 'lib.rs'), encoding='utf-8').read())
    m = re.search(r'generate_handler!\s*\[', text)
    body = balanced(text, m.end() - 1, '[', ']')
    out = []
    for item in split_top(body):
        # 条件注册（如 #[cfg(debug_assertions)] 的开发排查命令）：去掉属性只留命令名
        item = re.sub(r'#\[[^\]]*\]', '', item).strip()
        if item:
            out.append(item)
    return out


def ts_invokes():
    calls = []
    files = [p for p in glob.glob(os.path.join(TS, '**', '*.ts*'), recursive=True) if not p.endswith('.d.ts')]
    for path in files:
        text = open(path, encoding='utf-8').read()
        for m in re.finditer(r'\binvoke\s*(?:<.*?>)?\s*\(\s*[\'"]([a-z_0-9]+)[\'"]\s*(,|\))', text, re.S):
            name = m.group(1)
            line = text.count('\n', 0, m.start()) + 1
            keys, opaque = set(), False
            if m.group(2) == ',':
                rest = text[m.end():].lstrip()
                if rest.startswith('{'):
                    body = balanced(rest, 0, '{', '}') or ''
                    for part in split_top(body):
                        if part.startswith('...'):
                            opaque = True
                            continue
                        km = re.match(r'["\']?([A-Za-z_$][\w$]*)["\']?\s*(:|$)', part)
                        if km:
                            keys.add(km.group(1))
                else:
                    opaque = True
            calls.append({'name': name, 'file': os.path.relpath(path, ROOT), 'line': line,
                          'keys': keys, 'opaque': opaque, 'has_args': m.group(2) == ','})
    return calls


def main():
    show_w = '--warnings' in sys.argv
    cmds = rust_commands()
    reg = registered()
    reg_names = {r.split('::')[-1] for r in reg}
    errors, warns = [], []

    seen = set()
    for r in reg:
        if r in seen:
            errors.append(f'E5 lib.rs 重复注册 {r}')
        seen.add(r)
    for r in reg:
        name = r.split('::')[-1]
        mod = r.split('::')[0] if '::' in r else None
        defs = cmds.get(name, [])
        if mod:
            defs = [d for d in defs if d['module'] == mod]
        if not defs:
            errors.append(f'E2 lib.rs 注册了 {r}，但找不到对应的 #[tauri::command] 定义')

    calls = ts_invokes()
    invoked = set()
    for c in calls:
        invoked.add(c['name'])
        loc = f"{c['file']}:{c['line']}"
        if c['name'] not in reg_names:
            errors.append(f"E1 {loc} 调用 '{c['name']}'，但 lib.rs 未注册")
            continue
        d = cmds.get(c['name'], [None])[0]
        if not d:
            continue
        if c['opaque']:
            warns.append(f"W2 {loc} '{c['name']}' 参数为变量或含展开，未检查键")
            continue
        expected = {(p if d['snake'] else snake_to_camel(p)): (p, opt) for p, _, opt in d['params']}
        for k in sorted(c['keys']):
            if k not in expected:
                hint = f"（Rust 参数：{', '.join(expected) or '无'}）"
                errors.append(f"E3 {loc} '{c['name']}' 传入未知参数 '{k}' {hint}")
        for k, (p, opt) in expected.items():
            if not opt and k not in c['keys']:
                errors.append(f"E4 {loc} '{c['name']}' 缺少必填参数 '{k}'（Rust: {p}，定义于 {d['file']}:{d['line']}）")

    for name in sorted(reg_names - invoked):
        warns.append(f'W1 已注册但前端未调用：{name}')

    print(f'check-ipc-contract: registered={len(reg)}, rust_commands={len(cmds)}, '
          f'ts_invokes={len(calls)}, errors={len(errors)}, warnings={len(warns)}')
    for e in errors:
        print('  ✗ ' + e)
    if show_w:
        for w in warns:
            print('  · ' + w)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
