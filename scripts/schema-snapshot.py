#!/usr/bin/env python3
"""按序执行全部迁移，输出终态 schema。

用法:
  python3 scripts/schema-snapshot.py                 # 所有表及列
  python3 scripts/schema-snapshot.py --table words   # 单表列与索引
  python3 scripts/schema-snapshot.py --sql           # 完整 CREATE 语句
  python3 scripts/schema-snapshot.py --out x.db      # 保留生成的数据库文件
"""
import argparse
import sys

from _schema import build_schema_db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--table')
    ap.add_argument('--sql', action='store_true')
    ap.add_argument('--out')
    a = ap.parse_args()
    try:
        conn, files = build_schema_db(a.out)
    except RuntimeError as e:
        print(f'✗ {e}', file=sys.stderr)
        return 1
    print(f'# 已应用 {len(files)} 个迁移，最后一个：{files[-1]}')
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    if a.table:
        if a.table not in tables:
            print(f'✗ 表 {a.table} 不存在', file=sys.stderr)
            return 1
        tables = [a.table]
    for t in tables:
        if a.sql:
            print(conn.execute("SELECT sql FROM sqlite_master WHERE name=?", (t,)).fetchone()[0] + ';\n')
            continue
        cols = conn.execute(f'PRAGMA table_info({t})').fetchall()
        print(f'{t}:')
        for _, name, typ, notnull, default, pk in cols:
            flags = ' '.join(x for x in ['PK' if pk else '', 'NOT NULL' if notnull else '',
                                         f'DEFAULT {default}' if default is not None else ''] if x)
            print(f'  {name} {typ} {flags}'.rstrip())
        if a.table:
            for idx in conn.execute(f'PRAGMA index_list({t})').fetchall():
                cols = [c[2] for c in conn.execute(f'PRAGMA index_info({idx[1]})')]
                print(f'  index {idx[1]} ({", ".join(cols)}){" UNIQUE" if idx[2] else ""}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
