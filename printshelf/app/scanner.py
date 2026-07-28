from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import os
import re
import threading
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from .config import DEFAULT_IGNORE_GLOBS, data_dir, load_config
from .db import db_session, init_db, utcnow
from .mesh_junk import is_fake_mesh_file
from .parsers import detect_kind, parse_asset
from .thumbs import make_placeholder_thumb, save_thumb_bytes

log = logging.getLogger("printshelf.scan")

# Always prune these directory names (case-insensitive), even if config omits them.
HARD_SKIP_DIR_NAMES = frozenset({
    "node_modules",
    ".git",
    "__pycache__",
    "__macosx",
    ".trash",
    "$recycle.bin",
    "system volume information",
    ".svn",
    ".hg",
})

SCAN_LOCK = threading.Lock()
SCAN_STATE: dict[str, Any] = {
    "running": False,
    "status": "idle",
    "files_seen": 0,
    "files_upserted": 0,
    "files_skipped": 0,
    "files_failed": 0,
    "current_path": "",
    "error": None,
    "started_at": None,
    "finished_at": None,
}

THUMB_LOCK = threading.Lock()
THUMB_STATE: dict[str, Any] = {
    "running": False,
    "status": "idle",
    "checked": 0,
    "updated": 0,
    "error": None,
    "started_at": None,
    "finished_at": None,
}


def get_scan_state() -> dict[str, Any]:
    return dict(SCAN_STATE)


def get_thumb_rebuild_state() -> dict[str, Any]:
    return dict(THUMB_STATE)


def _dir_hard_skipped(name: str) -> bool:
    n = (name or "").strip().lower()
    return bool(n) and (n in HARD_SKIP_DIR_NAMES or n.startswith("._"))


def _ignored(rel: str, patterns: list[str]) -> bool:
    """Match ignore globs. Supports **/seg/** style (plain fnmatch does not)."""
    rel_posix = rel.replace("\\", "/").strip("/")
    name = PurePosixPath(rel_posix).name if rel_posix else ""
    parts = [p for p in rel_posix.split("/") if p]
    for raw in patterns:
        pat = (raw or "").replace("\\", "/").strip()
        if not pat:
            continue
        if fnmatch.fnmatch(rel_posix, pat) or (name and fnmatch.fnmatch(name, pat)):
            return True
        try:
            if rel_posix and PurePosixPath(rel_posix).match(pat):
                return True
            stripped = pat.rstrip("/")
            if stripped and rel_posix and PurePosixPath(rel_posix).match(stripped):
                return True
        except Exception:
            pass
        m = re.fullmatch(r"\*\*/([^/]+)/\*\*", pat) or re.fullmatch(r"\*\*/([^/]+)/?", pat)
        if m:
            seg_pat = m.group(1)
            if any(fnmatch.fnmatch(p, seg_pat) for p in parts):
                return True
            continue
        if pat.startswith("**/") and "/" not in pat[3:].rstrip("/"):
            leaf = pat[3:].rstrip("/")
            if leaf and name and fnmatch.fnmatch(name, leaf):
                return True
    return False


def effective_ignore_globs(cfg: dict[str, Any] | None = None) -> list[str]:
    """Config ignore list, or built-in defaults when unset/empty."""
    cfg = cfg or load_config()
    custom = [str(p).replace("\\", "/").strip() for p in (cfg.get("ignore_globs") or []) if str(p).strip()]
    return custom or list(DEFAULT_IGNORE_GLOBS)


def file_hash(path: Path, max_bytes: int = 262_144, st: os.stat_result | None = None) -> str:
    """Inventory fingerprint: size + mtime + a small head read (NAS-friendly)."""
    st = st or path.stat()
    h = hashlib.sha256()
    h.update(str(st.st_size).encode("utf-8"))
    h.update(b"|")
    h.update(f"{st.st_mtime:.6f}".encode("utf-8"))
    h.update(b"|")
    h.update(path.name.encode("utf-8", "surrogateescape"))
    with path.open("rb") as f:
        remaining = max_bytes
        while remaining > 0:
            chunk = f.read(min(64 * 1024, remaining))
            if not chunk:
                break
            h.update(chunk)
            remaining -= len(chunk)
    return h.hexdigest()


def _name_may_be_printable(name: str) -> bool:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return True
    return lower.endswith((".stl", ".obj", ".3mf", ".gcode", ".gco", ".zip"))


def mark_orphaned_scans(db_file: Path | None = None) -> int:
    """Mark scan_runs left as 'running' after a process restart."""
    cfg = load_config()
    db_file = db_file or (data_dir(cfg) / "printshelf.sqlite3")
    init_db(db_file)
    with db_session(db_file) as conn:
        cur = conn.execute(
            """UPDATE scan_runs
               SET finished_at = ?, status = 'interrupted',
                   error = COALESCE(NULLIF(error, ''), 'Process restarted before scan finished')
               WHERE status = 'running'""",
            (utcnow(),),
        )
        return int(cur.rowcount or 0)


def _flush_scan_progress(conn, run_id: int | None) -> None:
    if run_id is None:
        return
    conn.execute(
        "UPDATE scan_runs SET files_seen=?, files_upserted=? WHERE id=?",
        (SCAN_STATE["files_seen"], SCAN_STATE["files_upserted"], run_id),
    )
    conn.commit()


def _design_name_for(path: Path, root: Path) -> str:
    # Prefer parent folder name when file is in a model folder; else stem.
    try:
        rel = path.relative_to(root)
        if len(rel.parts) >= 2:
            return rel.parts[-2]
    except Exception:
        pass
    name = path.name
    for suf in (".gcode.3mf", ".3mf", ".stl", ".obj", ".gcode", ".gco", ".zip"):
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


def run_scan(
    progress: Callable[[dict[str, Any]], None] | None = None,
    *,
    root_ids: list[str] | None = None,
) -> dict[str, Any]:
    if not SCAN_LOCK.acquire(blocking=False):
        return get_scan_state()

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)
    mark_orphaned_scans(db_file)
    thumbs = data_dir(cfg) / "thumbs"
    ignore = effective_ignore_globs(cfg)
    folders = list(cfg.get("watched_folders") or [])
    if root_ids:
        want = {str(r).strip() for r in root_ids if str(r).strip()}
        folders = [f for f in folders if str(f.get("id") or "") in want]
        if not folders:
            SCAN_STATE.update({
                "running": False,
                "status": "error",
                "error": f"No watched folders match: {', '.join(sorted(want))}",
                "finished_at": utcnow(),
            })
            SCAN_LOCK.release()
            return get_scan_state()
    else:
        # Local / PC mounts first — huge NAS walks used to starve Kidabah PC.
        folders = sorted(
            folders,
            key=lambda f: (
                0 if str(f.get("source_kind") or "") == "local" else 1,
                str(f.get("id") or ""),
            ),
        )

    SCAN_STATE.update({
        "running": True,
        "status": "scanning",
        "files_seen": 0,
        "files_upserted": 0,
        "files_skipped": 0,
        "files_failed": 0,
        "current_path": "",
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
            purge_junk_assets(conn)

            seen_paths: set[str] = set()
            for folder in folders:
                root = Path(folder.get("path") or "")
                if not root.exists() or not root.is_dir():
                    log.warning("Watched folder missing or not a directory: %s", root)
                    continue
                try:
                    root_resolved = root.resolve()
                except Exception:
                    root_resolved = root
                root_s = str(root_resolved)

                for dirpath, dirnames, filenames in os.walk(root_s, followlinks=False):
                    # Prune ignored directories early (NAS walks are huge).
                    kept = []
                    for d in dirnames:
                        if _dir_hard_skipped(d):
                            continue
                        rel_dir = str((Path(dirpath) / d).relative_to(root_resolved)).replace("\\", "/")
                        if _ignored(rel_dir, ignore) or _ignored(f"{rel_dir}/", ignore):
                            continue
                        kept.append(d)
                    dirnames[:] = kept

                    rel_cwd = str(Path(dirpath).relative_to(root_resolved)).replace("\\", "/") if dirpath != root_s else ""
                    SCAN_STATE["current_path"] = rel_cwd or "."

                    for name in filenames:
                        if not _name_may_be_printable(name):
                            continue
                        path = Path(dirpath) / name
                        if _is_junk_printable(path):
                            try:
                                abs_junk = str(path.resolve())
                                conn.execute(
                                    "UPDATE assets SET missing = 1 WHERE abs_path = ? AND missing = 0",
                                    (abs_junk,),
                                )
                            except Exception:
                                pass
                            continue
                        kind = detect_kind(path)
                        if not kind:
                            continue
                        try:
                            rel = str(path.relative_to(root_resolved)).replace("\\", "/")
                        except Exception:
                            rel = name
                        if _ignored(rel, ignore):
                            continue

                        SCAN_STATE["files_seen"] += 1
                        try:
                            st = path.stat()
                            abs_path = str(path.resolve())
                            existing = conn.execute(
                                "SELECT id, size_bytes, mtime FROM assets WHERE abs_path = ?",
                                (abs_path,),
                            ).fetchone()
                            if (
                                existing
                                and int(existing["size_bytes"] or 0) == int(st.st_size)
                                and abs(float(existing["mtime"] or 0) - float(st.st_mtime)) < 0.001
                            ):
                                conn.execute(
                                    "UPDATE assets SET last_seen = ?, missing = 0 WHERE id = ?",
                                    (utcnow(), existing["id"]),
                                )
                                SCAN_STATE["files_skipped"] += 1
                                seen_paths.add(abs_path)
                                conn.commit()
                            else:
                                digest = file_hash(path, st=st)
                                parsed = parse_asset(path, kind)
                                upsert_asset(conn, folder, path, parsed, digest, thumbs)
                                SCAN_STATE["files_upserted"] += 1
                                seen_paths.add(abs_path)
                                conn.commit()
                        except Exception as exc:
                            SCAN_STATE["files_failed"] += 1
                            SCAN_STATE["error"] = f"{name}: {exc}"
                            log.warning("Scan skip %s: %s", path, exc)
                            continue

                        if SCAN_STATE["files_seen"] % 25 == 0:
                            _flush_scan_progress(conn, run_id)
                            if progress:
                                progress(get_scan_state())

            # mark missing assets under scanned roots only (targeted scans must not
            # mark other watched roots missing).
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

        SCAN_STATE.update({
            "running": False,
            "status": "ok",
            "finished_at": utcnow(),
            "current_path": "",
            "error": None if not SCAN_STATE.get("files_failed") else SCAN_STATE.get("error"),
        })
    except Exception as exc:
        SCAN_STATE.update({
            "running": False,
            "status": "error",
            "error": str(exc),
            "finished_at": utcnow(),
            "current_path": "",
        })
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


def start_scan_background(root_ids: list[str] | None = None) -> dict[str, Any]:
    if SCAN_STATE.get("running"):
        return get_scan_state()

    def _run():
        run_scan(root_ids=root_ids)

    t = threading.Thread(target=_run, name="printshelf-scan", daemon=True)
    t.start()
    # Tiny yield so callers see running=true more often.
    return {"ok": True, **get_scan_state(), "root_ids": list(root_ids or [])}


def _thumb_is_current(kind: str, thumb_path: str) -> bool:
    if kind == "stl":
        return thumb_path.endswith("_stl6.png")
    if kind == "obj":
        return thumb_path.endswith("_obj5.png")
    if kind in ("3mf", "gcode.3mf"):
        return thumb_path.endswith("_3mf3.png")
    if kind == "zip":
        return thumb_path == "_shared_zip2.png" or thumb_path.endswith("_zip2.png")
    return bool(thumb_path)


def _is_junk_printable(path: Path) -> bool:
    return is_fake_mesh_file(path)


def purge_junk_assets(conn) -> int:
    """Hide AppleDouble / temp / Thingiverse image-as-STL noise already indexed."""
    cur = conn.execute(
        """UPDATE assets SET missing = 1
           WHERE missing = 0 AND (
             file_name LIKE '._%'
             OR lower(file_name) LIKE '%\\_temp.obj' ESCAPE '\\'
             OR lower(file_name) = 'temp.obj'
             OR lower(file_name) LIKE 'card_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'tiny_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'tinycard_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'large_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'large_display\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'small_display\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'small_thumb\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'tiny_thumb\\_%' ESCAPE '\\'
           )"""
    )
    return cur.rowcount or 0


def rebuild_stale_thumbs(kinds: tuple[str, ...] = ("stl", "obj", "3mf", "gcode.3mf", "zip")) -> dict[str, Any]:
    """Re-render thumbs for assets still on old/missing previews (no full NAS walk)."""
    if not THUMB_LOCK.acquire(blocking=False):
        return get_thumb_rebuild_state()

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    thumbs = data_dir(cfg) / "thumbs"
    THUMB_STATE.update({
        "running": True,
        "status": "rebuilding",
        "checked": 0,
        "updated": 0,
        "error": None,
        "started_at": utcnow(),
        "finished_at": None,
    })
    try:
        placeholders = ",".join("?" for _ in kinds)
        with db_session(db_file) as conn:
            purged = purge_junk_assets(conn)
            conn.commit()
            if purged:
                THUMB_STATE["status"] = f"rebuilding (purged {purged} junk)"
            rows = conn.execute(
                f"""SELECT id, abs_path, kind, content_hash, thumb_path
                    FROM assets
                    WHERE missing = 0 AND COALESCE(hidden, 0) = 0 AND kind IN ({placeholders})
                    ORDER BY id""",
                kinds,
            ).fetchall()

            for row in rows:
                THUMB_STATE["checked"] += 1
                thumb_path = row["thumb_path"] or ""
                kind = row["kind"]
                thumb_file = thumbs / thumb_path if thumb_path else None
                min_size = 800 if kind == "zip" else 2500
                needs = (
                    not thumb_path
                    or not _thumb_is_current(kind, thumb_path)
                    or thumb_file is None
                    or not thumb_file.exists()
                    or thumb_file.stat().st_size < min_size
                )
                if not needs:
                    continue
                path = Path(row["abs_path"])
                if kind != "zip" and (_is_junk_printable(path) or not path.is_file()):
                    continue
                try:
                    content_hash = row["content_hash"] or (file_hash(path) if path.is_file() else "x")
                    thumb_name = None
                    triangle_count = None
                    if kind == "zip":
                        thumb_name = make_placeholder_thumb(thumbs, content_hash, kind, kind)
                    else:
                        if not path.is_file():
                            continue
                        parsed = parse_asset(path, kind)
                        triangle_count = parsed.get("triangle_count")
                        if parsed.get("thumb_bytes"):
                            thumb_name = save_thumb_bytes(thumbs, content_hash, kind, parsed["thumb_bytes"])
                        if not thumb_name:
                            thumb_name = make_placeholder_thumb(thumbs, content_hash, kind, kind)
                    if thumb_name and thumb_name != thumb_path:
                        conn.execute(
                            "UPDATE assets SET thumb_path = ?, triangle_count = COALESCE(?, triangle_count) WHERE id = ?",
                            (thumb_name, triangle_count, row["id"]),
                        )
                        THUMB_STATE["updated"] += 1
                        conn.commit()
                except Exception:
                    continue

        THUMB_STATE.update({"running": False, "status": "ok", "finished_at": utcnow()})
    except Exception as exc:
        THUMB_STATE.update({
            "running": False,
            "status": "error",
            "error": str(exc),
            "finished_at": utcnow(),
        })
    finally:
        THUMB_LOCK.release()
    return get_thumb_rebuild_state()


def start_thumb_rebuild_background(kinds: tuple[str, ...] = ("stl", "obj", "3mf", "gcode.3mf", "zip")) -> dict[str, Any]:
    if THUMB_STATE.get("running"):
        return get_thumb_rebuild_state()

    def _run():
        rebuild_stale_thumbs(kinds=kinds)

    t = threading.Thread(target=_run, name="printshelf-thumbs", daemon=True)
    t.start()
    return get_thumb_rebuild_state()
