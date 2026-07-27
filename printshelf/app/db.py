from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  root_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  abs_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mtime REAL NOT NULL DEFAULT 0,
  content_hash TEXT,
  triangle_count INTEGER,
  bbox_json TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  thumb_path TEXT,
  has_textures INTEGER NOT NULL DEFAULT 0,
  is_sliced INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sidecars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  abs_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  UNIQUE(asset_id, abs_path)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_assets_design ON assets(design_id);
CREATE INDEX IF NOT EXISTS idx_assets_hidden ON assets(hidden);
CREATE INDEX IF NOT EXISTS idx_designs_hash ON designs(content_hash);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(db_file: Path) -> sqlite3.Connection:
    db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_file), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(assets)").fetchall()}
    if "hidden" not in cols:
        conn.execute("ALTER TABLE assets ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_hidden ON assets(hidden)")


def init_db(db_file: Path) -> None:
    with connect(db_file) as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()


@contextmanager
def db_session(db_file: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(db_file)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def parse_json_field(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default
