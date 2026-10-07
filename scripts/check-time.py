#!/usr/bin/env python3
"""时间与时区约定检查（后端 + 迁移），棘轮模式：各规则计数只减不增。

规范：.claude/skills/deliver-contract-and-data/references/time-and-timezone.md
- 时刻一律 UTC 规范格式，只经 src-tauri/src/time.rs 产生（now_utc / SQL_NOW_UTC）
- “今天”只经 time::local_today()；日历日期 YYYY-MM-DD 不做时区换算
前端由 ESLint（eslint.config.js 的 no-restricted-syntax）守护，不在此检查。

用法:
  python3 scripts/check-time.py            # 计数增加则失败（退出码 1）
  python3 scripts/check-time.py --list     # 列出全部命中位置
  python3 scripts/check-time.py --update   # 收紧基线（清理后执行）
基线：.time-baseline.json
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, '.time-baseline.json')
RUST = os.path.join(ROOT, 'src-tauri', 'src')
MIGRATIONS = os.path.join(ROOT, 'src-tauri', 'migrations')

# 允许出现这些写法的唯一位置
TIME_MODULE = os.path.join('src-tauri', 'src', 'time.rs')
LOGGER = os.path.join('src-tauri', 'src', 'logger.rs')  # 日志是给人看的诊断输出，保留本地时间 + 偏移

RULES = {
    'sql-now-legacy': (
        re.compile(r"datetime\(\s*'now'|CURRENT_TIMESTAMP", re.I),
        "SQL 里写当前时刻会得到无时区标记的旧格式：绑定 time::now_utc() 或使用 time::SQL_NOW_UTC",
    ),
    'sql-today': (
        re.compile(r"date\(\s*'now'", re.I),
        "SQL 里取“今天”：改为绑定 time::local_today()（一次请求只取一次）",
    ),
    'rfc3339-variable': (
        re.compile(r"\.to_rfc3339\(\)"),
        "to_rfc3339() 是变长纳秒 + '+00:00'：用 time::now_utc()（定长毫秒 + 'Z'）",
    ),
    'local-now': (
        re.compile(r"\bLocal::now\(\)"),
        "直接取本地时间：“今天”用 time::local_today()，时刻用 time::now_utc()",
    ),
    'utc-now': (
        re.compile(r"\bUtc::now\(\)"),
        "直接取 UTC 时间：用 time::now_utc()",
    ),
}
# 新迁移（序号 >= 047）不得新增依赖 SQLite 默认格式的 DEFAULT
MIGRATION_RULE = (
    'migration-default-legacy',
    re.compile(r"DEFAULT\s*\(?\s*(CURRENT_TIMESTAMP|datetime\(\s*'now')", re.I),
    "新迁移的时刻列 DEFAULT 用 (strftime('%Y-%m-%dT%H:%M:%fZ','now'))，且写入方仍应显式绑定",
)
MIGRATION_FROM = 47


def scan() -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {k: [] for k in [*RULES, MIGRATION_RULE[0]]}
    for path in sorted(glob.glob(f'{RUST}/**/*.rs', recursive=True)):
        rel = os.path.relpath(path, ROOT)
        if rel in (TIME_MODULE, LOGGER):
            continue
        for n, line in enumerate(open(path, encoding='utf-8'), 1):
            if line.lstrip().startswith('//'):
                continue
            for key, (pattern, _) in RULES.items():
                if pattern.search(line):
                    hits[key].append(f'{rel}:{n}: {line.strip()[:120]}')
    key, pattern, _ = MIGRATION_RULE
    for path in sorted(glob.glob(f'{MIGRATIONS}/*.sql')):
        m = re.match(r'(\d+)_', os.path.basename(path))
        if not m or int(m.group(1)) < MIGRATION_FROM:
            continue
        for n, line in enumerate(open(path, encoding='utf-8'), 1):
            if pattern.search(line):
                hits[key].append(f'{os.path.relpath(path, ROOT)}:{n}: {line.strip()[:120]}')
    return hits


def main() -> int:
    hits = scan()
    counts = {k: len(v) for k, v in hits.items()}
    messages = {**{k: msg for k, (_, msg) in RULES.items()}, MIGRATION_RULE[0]: MIGRATION_RULE[2]}

    if '--list' in sys.argv:
        for key, lines in hits.items():
            if lines:
                print(f'== {key}（{len(lines)}）：{messages[key]}')
                for line in lines:
                    print(f'  {line}')

    if '--update' in sys.argv:
        with open(BASELINE, 'w', encoding='utf-8') as f:
            json.dump(counts, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write('\n')
        print(f'check-time: 基线已更新 {counts}')
        return 0

    baseline = json.load(open(BASELINE, encoding='utf-8')) if os.path.exists(BASELINE) else {}
    failed = False
    for key, count in counts.items():
        allowed = baseline.get(key, 0)
        if count > allowed:
            failed = True
            print(f'E {key}: {count} > 基线 {allowed} —— {messages[key]}')
            for line in hits[key][-(count - allowed):]:
                print(f'  可能的新增：{line}')
        elif count < allowed:
            print(f'I {key}: {count} < 基线 {allowed}，可执行 --update 收紧基线')
    print(f'check-time: {sum(counts.values())} 处存量（{", ".join(f"{k}={v}" for k, v in counts.items() if v)}）'
          + ('，有新增' if failed else '，未增加'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
