#!/usr/bin/env python3
"""发行不变量：保证用户覆盖安装新版本后，数据还在、能顺利升级。

1. 应用标识（tauri.conf.json identifier）不变 —— 数据目录按它定位，改了就会在新位置建空库；
2. 数据库文件名（app_paths.rs DB_FILE）不变；
3. 迁移文件命名规范、编号从 001 连续；
4. 已发布的迁移内容不变：src-tauri/migrations.lock 记录每个迁移的 sha256，只允许追加新迁移。
   用户的库里记着每个已执行迁移的校验和，改动已发布的迁移会让升级被拒绝（见 startup.rs）。

用法：
  python3 scripts/check-release-invariants.py           # 检查
  python3 scripts/check-release-invariants.py --update  # 把新增的迁移追加进锁文件（不会改已有条目）
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IDENTIFIER = "com.redlark.pindu-app"
DB_FILE = "vocabulary.db"
MIGRATIONS = ROOT / "src-tauri" / "migrations"
LOCK = ROOT / "src-tauri" / "migrations.lock"
NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    update = "--update" in sys.argv[1:]
    errors: list[str] = []

    conf = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    if conf.get("identifier") != IDENTIFIER:
        errors.append(f"tauri.conf.json identifier 必须是 {IDENTIFIER}（现在是 {conf.get('identifier')}）：改了用户会找不到原来的数据")

    paths_rs = (ROOT / "src-tauri" / "src" / "app_paths.rs").read_text(encoding="utf-8")
    if f'pub const DB_FILE: &str = "{DB_FILE}";' not in paths_rs:
        errors.append(f"app_paths.rs 的 DB_FILE 必须是 {DB_FILE}：改了用户会找不到原来的数据")

    files = sorted(p for p in MIGRATIONS.iterdir() if p.suffix == ".sql")
    for i, path in enumerate(files, start=1):
        m = NAME.match(path.name)
        if not m:
            errors.append(f"迁移文件名不规范：{path.name}（应为 NNN_小写下划线描述.sql）")
        elif int(m.group(1)) != i:
            errors.append(f"迁移编号不连续：第 {i} 个文件是 {path.name}")

    locked: dict[str, str] = {}
    if LOCK.exists():
        for line in LOCK.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                digest, name = line.split(maxsplit=1)
                locked[name] = digest
    present = {p.name: p for p in files}
    for name, digest in locked.items():
        if name not in present:
            errors.append(f"已发布的迁移被删除或改名：{name}")
        elif sha256(present[name]) != digest:
            errors.append(f"已发布的迁移被修改：{name}（只能新增迁移，不能改已有的）")
    new = [p for p in files if p.name not in locked]

    if new and update and not errors:
        header = "" if LOCK.exists() else (
            "# 已发布迁移的 sha256（scripts/check-release-invariants.py 守护）：只能追加，不能修改或删除。\n"
            "# 新增迁移后运行 python3 scripts/check-release-invariants.py --update\n"
        )
        with LOCK.open("a", encoding="utf-8") as f:
            f.write(header + "".join(f"{sha256(p)}  {p.name}\n" for p in new))
        print(f"已把 {len(new)} 个新迁移追加进 {LOCK.relative_to(ROOT)}")
        new = []
    for p in new:
        errors.append(f"新迁移还没登记：{p.name}（运行 python3 scripts/check-release-invariants.py --update）")

    if errors:
        print("发行不变量检查失败：")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"发行不变量 OK：identifier={IDENTIFIER}，数据库 {DB_FILE}，{len(files)} 个迁移均已登记且未改动")
    return 0


if __name__ == "__main__":
    sys.exit(main())
