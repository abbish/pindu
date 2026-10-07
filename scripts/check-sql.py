#!/usr/bin/env python3
"""静态 SQL 校验：提取 src-tauri/src 中的 SQL 字符串字面量，在迁移终态 schema 上执行 EXPLAIN。

能发现：引用不存在的表/列、语法错误、占位符数量与语句不符。
不能发现：bind 的类型/顺序错误、运行时拼接的 SQL（含 {} 的 format! 模板被跳过并计数）。
用法: python3 scripts/check-sql.py [--verbose]
退出码: 0 全部通过；1 有失败。
"""
import glob
import os
import re
import sqlite3
import sys

from _schema import ROOT, build_schema_db

SRC = os.path.join(ROOT, 'src-tauri', 'src')
SQL_START = re.compile(r'^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b', re.I)
SKIP_START = re.compile(r'^\s*(CREATE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|VACUUM)\b', re.I)
# 原始字符串 r#"..."# / r"..."，普通字符串 "..."
# 词边界：避免把 `day_number"` 结尾的 `r"` 误认作原始字符串开头
RAW = re.compile(r'(?<![A-Za-z0-9_])r(#*)"(.*?)"\1', re.S)
NORMAL = re.compile(r'"((?:[^"\\]|\\.)*)"', re.S)


def unescape(s):
    s = re.sub(r'\\\n\s*', '', s)  # 行尾续行
    return s.replace('\\"', '"').replace('\\n', '\n').replace('\\t', '\t').replace('\\\\', '\\')


def literals(text):
    """按位置返回 (offset, content)；先取原始字符串并遮盖，再取普通字符串。"""
    out = []
    masked = list(text)
    for m in RAW.finditer(text):
        out.append((m.start(), m.group(2)))
        for i in range(m.start(), m.end()):
            masked[i] = ' '
    masked = ''.join(masked)
    # 去掉注释与字符字面量的干扰
    masked = re.sub(r'//[^\n]*', lambda m: ' ' * len(m.group(0)), masked)
    for m in NORMAL.finditer(masked):
        out.append((m.start(), unescape(m.group(1))))
    return out


def explain(conn, sql):
    # sqlx::raw_sql 可一次执行多条语句：按分号拆开逐条检查（SQL 字面量里不含分号字符串）
    statements = [part.strip() for part in sql.split(';') if part.strip()]
    if len(statements) > 1:
        for statement in statements:
            err = explain_one(conn, statement)
            if err:
                return err
        return None
    return explain_one(conn, sql)


def explain_one(conn, sql):
    n = 0
    for _ in range(3):
        try:
            conn.execute('EXPLAIN ' + sql, [None] * n)
            return None
        except sqlite3.ProgrammingError as e:
            m = re.search(r'uses (\d+)', str(e))
            if not m:
                return str(e)
            n = int(m.group(1))
        except sqlite3.Error as e:
            return str(e)
    return 'placeholder count unresolved'


def main():
    verbose = '--verbose' in sys.argv
    conn, files = build_schema_db()
    checked = skipped_dynamic = 0
    failures = []
    for path in sorted(glob.glob(os.path.join(SRC, '**', '*.rs'), recursive=True)):
        rel = os.path.relpath(path, ROOT)
        text = open(path, encoding='utf-8').read()
        for off, s in literals(text):
            if not SQL_START.match(s) or SKIP_START.match(s):
                continue
            if not re.search(r'\b(FROM|INTO|SET|VALUES)\b', s, re.I):
                continue
            line = text.count('\n', 0, off) + 1
            # QueryBuilder::new("UPDATE t SET ") 之类的拼接片段不是完整语句
            if re.search(r'\{[a-z_0-9]*\}', s) or re.search(r'QueryBuilder::new\(\s*$', text[max(0, off - 60):off]):
                skipped_dynamic += 1
                if verbose:
                    print(f'  skip(dynamic) {rel}:{line}')
                continue
            checked += 1
            err = explain(conn, s)
            if err:
                first = ' '.join(s.split())[:110]
                failures.append(f'{rel}:{line}: {err}\n      {first}')
    print(f'check-sql: schema={len(files)} migrations, checked={checked}, '
          f'skipped_dynamic={skipped_dynamic}, failed={len(failures)}')
    for f in failures:
        print('  ✗ ' + f)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
