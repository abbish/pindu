"""共享：按序执行 src-tauri/migrations/*.sql 构建终态 schema 的 SQLite 数据库。"""
import glob
import os
import tempfile

try:
    # 自带新版 SQLite 的独立包：CI（Ubuntu 22.04）系统里的 SQLite 是 3.37，比应用自带的旧
    import pysqlite3.dbapi2 as sqlite3
except ImportError:
    import sqlite3

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MIGRATIONS = os.path.join(ROOT, 'src-tauri', 'migrations')

# 应用自带的 SQLite（sqlx 默认 bundled，src-tauri/Cargo.lock 里 libsqlite3-sys 0.30.1 → SQLite 3.46）。
# 迁移可以用它支持的语法（如聚合函数里的 ORDER BY，3.44 起），校验用的 SQLite 不能比它旧，否则会误报语法错误。
APP_SQLITE = (3, 46, 0)


def require_sqlite():
    """校验用的 SQLite 比应用自带的旧时直接说明原因并退出。"""
    if sqlite3.sqlite_version_info < APP_SQLITE:
        raise SystemExit(
            f'这里的 SQLite 是 {sqlite3.sqlite_version}，比应用自带的 {".".join(map(str, APP_SQLITE))} 旧，'
            '校验结果不可信。请先安装带新版 SQLite 的 Python 包：python3 -m pip install pysqlite3-binary'
        )


def build_schema_db(path=None):
    """返回 (connection, applied_files)。path 为空时使用临时文件。迁移失败抛出 RuntimeError。"""
    require_sqlite()
    if path is None:
        fd, path = tempfile.mkstemp(prefix='redlark-schema-', suffix='.db')
        os.close(fd)
    if os.path.exists(path):
        os.remove(path)
    conn = sqlite3.connect(path)
    files = sorted(glob.glob(os.path.join(MIGRATIONS, '*.sql')))
    for f in files:
        try:
            with open(f, encoding='utf-8') as fh:
                conn.executescript(fh.read())
        except sqlite3.Error as e:
            raise RuntimeError(f'迁移失败 {os.path.basename(f)}: {e}') from e
    # sqlx 自己的迁移记录表（真实库里由 sqlx 创建；startup.rs 会读它）
    conn.execute('''CREATE TABLE IF NOT EXISTS _sqlx_migrations (
        version BIGINT PRIMARY KEY, description TEXT NOT NULL,
        installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL,
        checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)''')
    conn.commit()
    return conn, [os.path.basename(f) for f in files]
