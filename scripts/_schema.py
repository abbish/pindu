"""共享：按序执行 src-tauri/migrations/*.sql 构建终态 schema 的 SQLite 数据库。"""
import glob
import os
import sqlite3
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MIGRATIONS = os.path.join(ROOT, 'src-tauri', 'migrations')


def build_schema_db(path=None):
    """返回 (connection, applied_files)。path 为空时使用临时文件。迁移失败抛出 RuntimeError。"""
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
