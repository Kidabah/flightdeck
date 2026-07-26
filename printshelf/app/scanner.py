from __future__ import annotations

import fnmatch
import hashlib
import json
import threading
from pathlib import Path
from typing import Any, Callable

from .config import data_dir, load_config
from .db import db_session, init_db, utcnow
from .parsers import detect_kind, parse_asset
from .thumbs import make_placeholder_thumb, save_thumb_bytes

SCAN_LOCK = threading.Lock()
SCAN_STATE: dict[str, Any] = {
    "running": False,
    "status": "idle",
    "files_seen": 0,
    "files_upserted": 0,
    "error": None,
    "started_at": None,
    "finished_at": None,
}


def get_scan_state() -> dict[str, Any]:
    return dict(SCAN_STATE)


def _ignored(rel: str, patterns: list[str]) -> bool:
    rel_posix = rel.replace("\\", "/")
    for pat in patterns:
        if fnmatch.fnmatch(rel_posix, pat) or fnmatch.fnmatch(Path(rel_posix).name, pat):
            return True
    return False


def file_hash(path: Path, max_bytes: int = 8_000_000) -> str:
    h = hashlib.sha256()
    size = path.stat().st_size
    h.update(str(size).encode("utf-8"))
    with path.open("rb") as f:
        remaining = max_bytes
        while remaining > 0:
            chunk = f.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            h.update(chunk)
            remaining -= len(chunk)
    return h.hexdigest()


def _design_name_for(path: Path, root: Path) -> str:
    # Prefer parent folder name when file is in a model folder; else stem.
    try:
        rel = path.relative_to(root)
        if len(rel.parts) >= 2:
            return rel.parts[-2]
    except Exception:
        pass
    name = path.name
    for suf in (".gcode.3mf", ".3mf", ".stl", ".obj"):
        if name.lower().endswith(suf):
            return name[: -len(suf)]
    return path.stem


def upsert_asset(conn, folder: dict[str, Any], path: Path, parsed: dict[str, Any], content_hash: str, thumbs: Path) -> None:
    kind = parsed.get("kind") or detect_kind(path) or "unknown"
    st = path.stat()
    root_path = str(Path(folder["path"]).resolve())
    abs_path = str(path.resolve())
    try:
        rel_path = str(path.resolve().relative_to(Path(root_path)))
    except Exception:
        rel_path = path.name

    thumb_name = None
    if parsed.get("thumb_bytes"):
        thumb_name = save_thumb_bytes(thumbs, content_hash, kind, parsed["thumb_bytes"])
    if not thumb_name:
        thumb_name = make_placeholder_thumb(thumbs, content_hash, kind, kind)

    # Find or create design by content hash (dedup) or by folder+name
    design_id = None
    row = conn.execute(
        "SELECT id FROM designs WHERE content_hash = ? LIMIT 1",
        (content_hash,),
    ).fetchone()
    now = utcnow()
    if row:
        design_id = row["id"]
        conn.execute(
            "UPDATE designs SET updated_at = ? WHERE id = ?",
            (now, design_id),
        )
    else:
        name = _design_name_for(path, Path(root_path))
        cur = conn.execute(
            "INSERT INTO designs(name, notes, tags_json, content_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (name, "", "[]", content_hash, now, now),
        )
        design_id = cur.lastrowid

    meta_json = json.dumps(parsed.get("meta") or {}, ensure_ascii=False)
    bbox_json = json.dumps(parsed.get("bbox"), ensure_ascii=False) if parsed.get("bbox") else None
    existing = conn.execute("SELECT id FROM assets WHERE abs_path = ?", (abs_path,)).fetchone()
    common = (
        design_id,
        kind,
        folder.get("source_kind") or "local",
        folder.get("id") or "folder",
        root_path,
        rel_path,
        path.name,
        int(st.st_size),
        float(st.st_mtime),
        content_hash,
        parsed.get("triangle_count"),
        bbox_json,
        meta_json,
        thumb_name,
        1 if parsed.get("has_textures") else 0,
        1 if parsed.get("is_sliced") else 0,
        now,
        0,
    )
    if existing:
        asset_id = existing["id"]
        conn.execute(
            """UPDATE assets SET
              design_id=?, kind=?, source_kind=?, root_id=?, root_path=?, rel_path=?,
              file_name=?, size_bytes=?, mtime=?, content_hash=?, triangle_count=?,
              bbox_json=?, meta_json=?, thumb_path=?, has_textures=?, is_sliced=?,
              last_seen=?, missing=?
            WHERE id=?""",
            common + (asset_id,),
        )
        conn.execute("DELETE FROM sidecars WHERE asset_id = ?", (asset_id,))
    else:
        cur = conn.execute(
            """INSERT INTO assets(
              design_id, kind, source_kind, root_id, root_path, rel_path, abs_path,
              file_name, size_bytes, mtime, content_hash, triangle_count, bbox_json,
              meta_json, thumb_path, has_textures, is_sliced, last_seen, missing
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                design_id,
                kind,
                folder.get("source_kind") or "local",
                folder.get("id") or "folder",
                root_path,
                rel_path,
                abs_path,
                path.name,
                int(st.st_size),
                float(st.st_mtime),
                content_hash,
                parsed.get("triangle_count"),
                bbox_json,
                meta_json,
                thumb_name,
                1 if parsed.get("has_textures") else 0,
                1 if parsed.get("is_sliced") else 0,
                now,
                0,
            ),
        )
        asset_id = cur.lastrowid

    for sc in parsed.get("sidecars") or []:
        conn.execute(
            "INSERT OR IGNORE INTO sidecars(asset_id, role, abs_path, file_name, size_bytes) VALUES (?,?,?,?,?)",
            (asset_id, sc.get("role") or "sidecar", sc["abs_path"], sc["file_name"], int(sc.get("size_bytes") or 0)),
        )


def run_scan(progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    if not SCAN_LOCK.acquire(blocking=False):
        return get_scan_state()

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)
    thumbs = data_dir(cfg) / "thumbs"
    ignore = list(cfg.get("ignore_globs") or [])
    folders = list(cfg.get("watched_folders") or [])

    SCAN_STATE.update({
        "running": True,
        "status": "scanning",
        "files_seen": 0,
        "files_upserted": 0,
        "error": None,
        "started_at": utcnow(),
        "finished_at": None,
    })
    if progress:
        progress(get_scan_state())

    run_id = None
    try:
        with db_session(db_file) as conn:
            cur = conn.execute(
                "INSERT INTO scan_runs(started_at, status) VALUES (?,?)",
                (SCAN_STATE["started_at"], "running"),
            )
            run_id = cur.lastrowid

            seen_paths: set[str] = set()
            for folder in folders:
                root = Path(folder.get("path") or "")
                if not root.exists() or not root.is_dir():
                    continue
                for path in root.rglob("*"):
                    if not path.is_file():
                        continue
                    kind = detect_kind(path)
                    if not kind:
                        continue
                    try:
                        rel = str(path.resolve().relative_to(root.resolve()))
                    except Exception:
                        rel = path.name
                    if _ignored(rel, ignore):
                        continue
                    SCAN_STATE["files_seen"] += 1
                    try:
                        digest = file_hash(path)
                        parsed = parse_asset(path, kind)
                        upsert_asset(conn, folder, path, parsed, digest, thumbs)
                        SCAN_STATE["files_upserted"] += 1
                        seen_paths.add(str(path.resolve()))
                        # Commit each file so the UI fills during long NAS walks.
                        conn.commit()
                    except Exception:
                        continue
                    if progress and SCAN_STATE["files_seen"] % 25 == 0:
                        progress(get_scan_state())

            # mark missing assets under watched roots
            roots = [str(Path(f["path"]).resolve()) for f in folders if f.get("path")]
            if roots:
                rows = conn.execute("SELECT id, abs_path, root_path FROM assets").fetchall()
                for row in rows:
                    if row["root_path"] not in roots:
                        continue
                    missing = 0 if row["abs_path"] in seen_paths else (0 if Path(row["abs_path"]).exists() else 1)
                    conn.execute(
                        "UPDATE assets SET missing = ?, last_seen = CASE WHEN ? = 0 THEN ? ELSE last_seen END WHERE id = ?",
                        (missing, missing, utcnow(), row["id"]),
                    )

            conn.execute(
                "UPDATE scan_runs SET finished_at=?, status=?, files_seen=?, files_upserted=? WHERE id=?",
                (utcnow(), "ok", SCAN_STATE["files_seen"], SCAN_STATE["files_upserted"], run_id),
            )

        SCAN_STATE.update({"running": False, "status": "ok", "finished_at": utcnow()})
    except Exception as exc:
        SCAN_STATE.update({"running": False, "status": "error", "error": str(exc), "finished_at": utcnow()})
        if run_id is not None:
            try:
                with db_session(db_file) as conn:
                    conn.execute(
                        "UPDATE scan_runs SET finished_at=?, status=?, error=?, files_seen=?, files_upserted=? WHERE id=?",
                        (utcnow(), "error", str(exc), SCAN_STATE["files_seen"], SCAN_STATE["files_upserted"], run_id),
                    )
            except Exception:
                pass
    finally:
        SCAN_LOCK.release()
        if progress:
            progress(get_scan_state())
    return get_scan_state()


def start_scan_background() -> dict[str, Any]:
    if SCAN_STATE.get("running"):
        return get_scan_state()

    def _run():
        run_scan()

    t = threading.Thread(target=_run, name="printshelf-scan", daemon=True)
    t.start()
    return get_scan_state()
