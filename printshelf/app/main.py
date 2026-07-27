from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .config import data_dir, load_config, save_config
from .db import db_session, init_db, parse_json_field, row_to_dict
from .paths import to_windows_folder, to_windows_path
from .parsers.ziparchive import list_nested_zip, split_nested_entry
from .preview import (
    MAX_PREVIEW_TRIS,
    MAX_PREVIEW_TRIS_HIGH,
    build_preview_stl,
    build_zip_entry_preview,
    entry_kind,
    get_asset_row,
    path_is_allowed,
    path_under_watched,
    read_zip_entry_bytes,
    safe_zip_entry,
)
from .scanner import (
    get_scan_state,
    get_thumb_rebuild_state,
    mark_orphaned_scans,
    start_scan_background,
    start_thumb_rebuild_background,
)
from .thumbs import ensure_shared_zip_thumb, resolve_thumb_name

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"

app = FastAPI(title="PrintShelf", version=__version__)


class FolderIn(BaseModel):
    id: str
    label: str = ""
    path: str
    source_kind: str = "local"
    windows_path: str = ""


class ConfigIn(BaseModel):
    watched_folders: list[FolderIn] = Field(default_factory=list)
    ignore_globs: list[str] | None = None


class BulkIdsIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=2000)


@app.on_event("startup")
def _startup() -> None:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)
    mark_orphaned_scans(db_file)
    ensure_shared_zip_thumb(data_dir(cfg) / "thumbs")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "name": "PrintShelf", "version": __version__}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    cfg = load_config()
    return {
        "watched_folders": cfg.get("watched_folders") or [],
        "ignore_globs": cfg.get("ignore_globs") or [],
        "port": cfg.get("port") or 8100,
    }


@app.put("/api/config")
def put_config(body: ConfigIn) -> dict[str, Any]:
    cfg = load_config()
    cfg["watched_folders"] = [f.model_dump() for f in body.watched_folders]
    if body.ignore_globs is not None:
        cfg["ignore_globs"] = body.ignore_globs
    save_config(cfg)
    return get_config()


@app.post("/api/scan")
def trigger_scan() -> dict[str, Any]:
    return start_scan_background()


@app.get("/api/scan")
def scan_status() -> dict[str, Any]:
    return get_scan_state()


@app.post("/api/thumbs/rebuild")
def trigger_thumb_rebuild() -> dict[str, Any]:
    """Rebuild stale STL/OBJ/3MF/ZIP thumbs without re-walking the whole NAS."""
    return start_thumb_rebuild_background(kinds=("stl", "obj", "3mf", "gcode.3mf", "zip"))


@app.get("/api/thumbs/rebuild")
def thumb_rebuild_status() -> dict[str, Any]:
    return get_thumb_rebuild_state()


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        designs = conn.execute("SELECT COUNT(*) AS c FROM designs").fetchone()["c"]
        assets = conn.execute(
            "SELECT COUNT(*) AS c FROM assets WHERE missing = 0 AND COALESCE(hidden, 0) = 0"
        ).fetchone()["c"]
        hidden = conn.execute(
            "SELECT COUNT(*) AS c FROM assets WHERE missing = 0 AND COALESCE(hidden, 0) = 1"
        ).fetchone()["c"]
        by_kind = {
            r["kind"]: r["c"]
            for r in conn.execute(
                "SELECT kind, COUNT(*) AS c FROM assets "
                "WHERE missing = 0 AND COALESCE(hidden, 0) = 0 GROUP BY kind"
            ).fetchall()
        }
    return {
        "designs": designs,
        "assets": assets,
        "hidden": hidden,
        "by_kind": by_kind,
        "scan": get_scan_state(),
        "thumbs": get_thumb_rebuild_state(),
    }


def _asset_visibility_clauses(
    *,
    missing: bool = False,
    hidden: bool | None = False,
    kind: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    q: str | None = None,
    root_id: str | None = None,
) -> tuple[list[str], list[Any]]:
    clauses = ["a.missing = ?"]
    params: list[Any] = [1 if missing else 0]
    if hidden is None:
        pass
    elif hidden:
        clauses.append("COALESCE(a.hidden, 0) = 1")
    else:
        clauses.append("COALESCE(a.hidden, 0) = 0")
    if kind:
        clauses.append("a.kind = ?")
        params.append(kind)
    if source_kind:
        clauses.append("a.source_kind = ?")
        params.append(source_kind)
    if has_textures is not None:
        clauses.append("a.has_textures = ?")
        params.append(1 if has_textures else 0)
    if is_sliced is not None:
        clauses.append("a.is_sliced = ?")
        params.append(1 if is_sliced else 0)
    if root_id:
        clauses.append("a.root_id = ?")
        params.append(root_id)
    if q:
        clauses.append("(a.file_name LIKE ? OR a.rel_path LIKE ? OR d.name LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    return clauses, params


def _normalize_folder(folder: str | None) -> str:
    raw = (folder or "").replace("\\", "/").strip("/")
    if ".." in raw.split("/"):
        raise HTTPException(400, "Invalid folder path")
    return raw


@app.get("/api/browse")
def browse_library(
    root_id: str | None = None,
    folder: str = "",
    q: str | None = None,
    kind: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    hidden: bool | None = False,
    limit: int = Query(500, ge=1, le=1000),
) -> dict[str, Any]:
    """Folder browser: watched roots → relative folders → files in the current folder."""
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    folder = _normalize_folder(folder)
    watched = {f.get("id"): f for f in (cfg.get("watched_folders") or []) if f.get("id")}

    clauses, params = _asset_visibility_clauses(
        hidden=hidden,
        kind=kind,
        source_kind=source_kind,
        has_textures=has_textures,
        is_sliced=is_sliced,
        q=q,
        root_id=root_id,
    )
    where = " AND ".join(clauses)

    # Top level: list watched roots with counts
    if not root_id:
        with db_session(db_file) as conn:
            rows = conn.execute(
                f"""SELECT a.root_id, a.source_kind, COUNT(*) AS c
                    FROM assets a
                    JOIN designs d ON d.id = a.design_id
                    WHERE {where}
                    GROUP BY a.root_id, a.source_kind
                    ORDER BY a.root_id""",
                params,
            ).fetchall()
        roots = []
        for r in rows:
            rid = r["root_id"]
            wf = watched.get(rid) or {}
            roots.append({
                "id": rid,
                "label": wf.get("label") or rid,
                "path": wf.get("path") or "",
                "source_kind": r["source_kind"] or wf.get("source_kind") or "local",
                "asset_count": int(r["c"] or 0),
            })
        return {
            "mode": "roots",
            "root_id": None,
            "folder": "",
            "crumbs": [{"label": "Library", "root_id": None, "folder": ""}],
            "roots": roots,
            "folders": [],
            "items": [],
            "total_files": sum(x["asset_count"] for x in roots),
        }

    if root_id not in watched and root_id not in {r.get("id") for r in (cfg.get("watched_folders") or [])}:
        # Still allow browse if assets reference a root_id even if config drifted
        pass

    with db_session(db_file) as conn:
        rows = conn.execute(
            f"""SELECT a.rel_path, a.id, a.file_name, a.kind, a.source_kind, a.root_id,
                       a.root_path, a.abs_path, a.size_bytes, a.content_hash, a.thumb_path,
                       a.triangle_count, a.has_textures, a.is_sliced, a.hidden, a.meta_json,
                       a.bbox_json, a.last_seen, d.name AS design_name
                FROM assets a
                JOIN designs d ON d.id = a.design_id
                WHERE {where}
                ORDER BY a.file_name ASC""",
            params,
        ).fetchall()

    prefix = f"{folder}/" if folder else ""
    subfolders: dict[str, int] = {}
    file_rows = []
    for r in rows:
        rel = (r["rel_path"] or "").replace("\\", "/").lstrip("/")
        if folder:
            if rel == folder:
                # odd: asset path equals folder name (file without parent) — treat as file
                file_rows.append(r)
                continue
            if not rel.startswith(prefix):
                continue
            rest = rel[len(prefix):]
        else:
            rest = rel
        if not rest:
            continue
        if "/" in rest:
            child = rest.split("/", 1)[0]
            if child:
                subfolders[child] = subfolders.get(child, 0) + 1
        else:
            file_rows.append(r)

    folder_list = [
        {
            "name": name,
            "folder": f"{folder}/{name}".strip("/") if folder else name,
            "asset_count": count,
        }
        for name, count in sorted(subfolders.items(), key=lambda x: x[0].lower())
    ]

    thumbs = data_dir(cfg) / "thumbs"
    items = []
    for r in file_rows[:limit]:
        item = row_to_dict(r)
        assert item
        item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
        item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
        item["thumb_path"] = resolve_thumb_name(
            thumbs,
            thumb_path=item.get("thumb_path"),
            content_hash=item.get("content_hash"),
            kind=item.get("kind"),
        )
        items.append(item)

    wf = watched.get(root_id) or {}
    crumbs = [{"label": "Library", "root_id": None, "folder": ""}]
    crumbs.append({
        "label": wf.get("label") or root_id,
        "root_id": root_id,
        "folder": "",
    })
    if folder:
        parts = folder.split("/")
        acc = []
        for part in parts:
            acc.append(part)
            crumbs.append({
                "label": part,
                "root_id": root_id,
                "folder": "/".join(acc),
            })

    return {
        "mode": "folder",
        "root_id": root_id,
        "folder": folder,
        "crumbs": crumbs,
        "roots": [],
        "folders": folder_list,
        "items": items,
        "total_files": len(file_rows),
        "truncated": len(file_rows) > limit,
    }


@app.get("/api/assets")
def list_assets(
    q: str | None = None,
    kind: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    missing: bool = False,
    hidden: bool | None = False,
    root_id: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    clauses, params = _asset_visibility_clauses(
        missing=missing,
        hidden=hidden,
        kind=kind,
        source_kind=source_kind,
        has_textures=has_textures,
        is_sliced=is_sliced,
        q=q,
        root_id=root_id,
    )
    where = " AND ".join(clauses)
    sql = f"""
      SELECT a.*, d.name AS design_name
      FROM assets a
      JOIN designs d ON d.id = a.design_id
      WHERE {where}
      ORDER BY a.last_seen DESC, a.file_name ASC
      LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])
    with db_session(db_file) as conn:
        rows = conn.execute(sql, params).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM assets a JOIN designs d ON d.id = a.design_id WHERE {where}",
            params[:-2],
        ).fetchone()["c"]
    thumbs = data_dir(cfg) / "thumbs"
    items = []
    for r in rows:
        item = row_to_dict(r)
        assert item
        item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
        item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
        resolved = resolve_thumb_name(
            thumbs,
            thumb_path=item.get("thumb_path"),
            content_hash=item.get("content_hash"),
            kind=item.get("kind"),
        )
        item["thumb_path"] = resolved
        items.append(item)
    return {"total": total, "items": items}


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute(
            """SELECT a.*, d.name AS design_name, d.notes AS design_notes, d.tags_json
               FROM assets a JOIN designs d ON d.id = a.design_id
               WHERE a.id = ?""",
            (asset_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Asset not found")
        sidecars = [
            row_to_dict(s)
            for s in conn.execute(
                "SELECT * FROM sidecars WHERE asset_id = ? ORDER BY role, file_name",
                (asset_id,),
            ).fetchall()
        ]
    item = row_to_dict(row)
    assert item
    item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
    item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
    item["tags"] = parse_json_field(item.pop("tags_json", "[]"), [])
    item["sidecars"] = sidecars
    folders = list(cfg.get("watched_folders") or [])
    abs_path = str(item.get("abs_path") or "")
    item["windows_path"] = to_windows_path(abs_path, folders)
    item["windows_folder"] = to_windows_folder(abs_path, folders)
    kind = item.get("kind")
    meta = item.get("meta") or {}
    nested = list(meta.get("nested_zips") or [])
    if not nested and kind == "zip":
        # Pre-rescan indexes only have entries — derive nested zip names live.
        nested = [
            e for e in (meta.get("entries") or [])
            if str((e or {}).get("name") or "").lower().endswith(".zip")
        ]
        if nested:
            meta = {**meta, "nested_zips": nested, "nested_zip_count": len(nested)}
            item["meta"] = meta
    nested_n = int(meta.get("nested_zip_count") or len(nested))
    item["can_orbit"] = kind in ("stl", "obj", "3mf", "gcode.3mf") or (
        kind == "zip" and (int(meta.get("printable_count") or 0) > 0 or nested_n > 0)
    )
    item["has_nested_zips"] = nested_n > 0
    item["thumb_path"] = resolve_thumb_name(
        data_dir(cfg) / "thumbs",
        thumb_path=item.get("thumb_path"),
        content_hash=item.get("content_hash"),
        kind=kind,
    )
    item["hidden"] = bool(item.get("hidden"))
    return item


def _load_asset_or_404(asset_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    item = row_to_dict(row)
    if not item:
        raise HTTPException(404, "Asset not found")
    return item


def _delete_asset_disk(asset_id: int, delete_sidecars: bool = True) -> dict[str, Any]:
    """Delete one asset from disk + DB. Raises HTTPException on hard failures."""
    asset = _load_asset_or_404(asset_id)
    abs_path = str(asset.get("abs_path") or "")
    if not path_under_watched(abs_path):
        raise HTTPException(403, "File is outside watched folders")

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    deleted_files: list[str] = []
    errors: list[str] = []

    with db_session(db_file) as conn:
        sidecars = [
            row_to_dict(s)
            for s in conn.execute(
                "SELECT * FROM sidecars WHERE asset_id = ?",
                (asset_id,),
            ).fetchall()
        ]

    paths_to_delete = [abs_path]
    if delete_sidecars:
        for sc in sidecars:
            p = str((sc or {}).get("abs_path") or "")
            if p:
                paths_to_delete.append(p)

    for p in paths_to_delete:
        path = Path(p)
        if not path.exists():
            continue
        if not path_under_watched(str(path)):
            if p != abs_path:
                errors.append(f"skipped (outside watched folders): {p}")
                continue
            raise HTTPException(403, "File is outside watched folders")
        try:
            path.unlink()
            deleted_files.append(p)
        except Exception as exc:
            errors.append(f"{p}: {exc}")

    thumb = asset.get("thumb_path")
    if thumb:
        try:
            (data_dir(cfg) / "thumbs" / str(thumb)).unlink(missing_ok=True)
        except Exception:
            pass
    content_hash = str(asset.get("content_hash") or "")[:20]
    if content_hash:
        prev_dir = data_dir(cfg) / "previews"
        if prev_dir.exists():
            for f in prev_dir.glob(f"{content_hash}_*.stl"):
                try:
                    f.unlink(missing_ok=True)
                except Exception:
                    pass

    if Path(abs_path).exists():
        raise HTTPException(
            500,
            f"Could not delete file on disk: {'; '.join(errors) or abs_path}",
        )

    with db_session(db_file) as conn:
        conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))

    return {
        "ok": True,
        "id": asset_id,
        "deleted_files": deleted_files,
        "errors": errors,
        "file_name": asset.get("file_name"),
    }


# Bulk routes must be registered before /api/assets/{asset_id}/... or "bulk" is parsed as an id.
@app.post("/api/assets/bulk/hide")
def bulk_hide(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    if not ids:
        return {"ok": True, "updated": 0, "ids": []}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    placeholders = ",".join("?" for _ in ids)
    with db_session(db_file) as conn:
        cur = conn.execute(
            f"UPDATE assets SET hidden = 1 WHERE id IN ({placeholders})",
            ids,
        )
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "ids": ids}


@app.post("/api/assets/bulk/unhide")
def bulk_unhide(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    if not ids:
        return {"ok": True, "updated": 0, "ids": []}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    placeholders = ",".join("?" for _ in ids)
    with db_session(db_file) as conn:
        cur = conn.execute(
            f"UPDATE assets SET hidden = 0 WHERE id IN ({placeholders})",
            ids,
        )
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "ids": ids}


@app.post("/api/assets/bulk/delete")
def bulk_delete(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    deleted: list[int] = []
    failed: list[dict[str, Any]] = []
    for asset_id in ids:
        try:
            _delete_asset_disk(asset_id, delete_sidecars=True)
            deleted.append(asset_id)
        except HTTPException as exc:
            failed.append({"id": asset_id, "error": str(exc.detail)})
        except Exception as exc:
            failed.append({"id": asset_id, "error": str(exc)})
    return {
        "ok": not failed,
        "deleted": deleted,
        "deleted_count": len(deleted),
        "failed": failed,
    }


@app.post("/api/assets/{asset_id}/hide")
def hide_asset(asset_id: int) -> dict[str, Any]:
    """Hide from library; file stays on disk. Survives rescan."""
    asset = _load_asset_or_404(asset_id)
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        conn.execute("UPDATE assets SET hidden = 1 WHERE id = ?", (asset_id,))
    return {"ok": True, "id": asset_id, "hidden": True, "file_name": asset.get("file_name")}


@app.post("/api/assets/{asset_id}/unhide")
def unhide_asset(asset_id: int) -> dict[str, Any]:
    asset = _load_asset_or_404(asset_id)
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        conn.execute("UPDATE assets SET hidden = 0 WHERE id = ?", (asset_id,))
    return {"ok": True, "id": asset_id, "hidden": False, "file_name": asset.get("file_name")}


@app.post("/api/assets/{asset_id}/delete")
def delete_asset(
    asset_id: int,
    delete_sidecars: bool = Query(True),
) -> dict[str, Any]:
    """Permanently delete the file on disk (and indexed sidecars), then drop the DB row."""
    return _delete_asset_disk(asset_id, delete_sidecars=delete_sidecars)


def _media_type_for_name(name: str) -> str:
    lower = (name or "").lower()
    if lower.endswith(".stl"):
        return "model/stl"
    if lower.endswith(".obj"):
        return "text/plain"
    if lower.endswith(".gcode.3mf") or lower.endswith(".3mf"):
        return "model/3mf"
    if lower.endswith(".zip"):
        return "application/zip"
    guessed, _ = mimetypes.guess_type(name)
    return guessed or "application/octet-stream"


def _content_disposition(filename: str) -> str:
    # ASCII fallback + RFC 5987 filename* for Unicode names.
    safe = "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "_" for ch in filename) or "download"
    return f"attachment; filename=\"{safe}\"; filename*=UTF-8''{quote(filename)}"


def _serve_asset_file(asset_id: int, entry: str | None = None):
    """Stream the original file (or one printable inside a ZIP / nested ZIP) for slicer download/open."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise HTTPException(404, "File missing on disk")

    kind = asset.get("kind") or ""
    if entry:
        if kind != "zip":
            raise HTTPException(400, "entry= is only valid for ZIP assets")
        try:
            entry_name = safe_zip_entry(entry)
            nested, inner = split_nested_entry(entry_name)
            mesh_name = inner if nested else entry_name
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if not entry_kind(mesh_name):
            raise HTTPException(400, "Zip entry is not a printable mesh (stl/obj/3mf)")
        try:
            raw, filename = read_zip_entry_bytes(src, entry_name)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        media = _media_type_for_name(filename)

        def _iter_bytes() -> Iterator[bytes]:
            # Already in memory (nested) or small enough; chunk for StreamingResponse.
            view = memoryview(raw)
            step = 1024 * 1024
            for i in range(0, len(view), step):
                yield bytes(view[i : i + step])

        return StreamingResponse(
            _iter_bytes(),
            media_type=media,
            headers={
                "Content-Disposition": _content_disposition(filename).replace("attachment;", "inline;", 1),
                "Cache-Control": "private, max-age=60",
                "X-PrintShelf-Zip-Entry": entry_name,
            },
        )

    filename = asset.get("file_name") or src.name
    return FileResponse(
        src,
        media_type=_media_type_for_name(filename),
        filename=filename,
        content_disposition_type="inline",
        headers={
            "Cache-Control": "private, max-age=60",
            "X-PrintShelf-Kind": kind,
        },
    )


@app.get("/api/assets/{asset_id}/nested")
def peek_nested_zip(
    asset_id: int,
    entry: str = Query(..., description="Nested .zip member path inside the outer archive"),
) -> dict[str, Any]:
    """List printables one level inside a nested ZIP (no extract to NAS)."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    if (asset.get("kind") or "") != "zip":
        raise HTTPException(400, "Only ZIP assets support nested peek")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise HTTPException(404, "File missing on disk")
    try:
        return {"ok": True, **list_nested_zip(src, entry)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Nested peek failed: {exc}") from exc


@app.get("/api/assets/{asset_id}/file")
def get_asset_file(
    asset_id: int,
    entry: str | None = Query(None, description="Path inside a ZIP for a printable member"),
):
    return _serve_asset_file(asset_id, entry=entry)


@app.get("/api/assets/{asset_id}/file/{filename}")
def get_asset_file_named(
    asset_id: int,
    filename: str,
    entry: str | None = Query(None, description="Path inside a ZIP for a printable member"),
):
    """Same as /file, but path ends with a real name.ext so Bambu/Orca accept the download URL."""
    _ = filename  # cosmetic for slicer URL handlers
    return _serve_asset_file(asset_id, entry=entry)


@app.get("/api/assets/{asset_id}/model")
def get_asset_model(
    asset_id: int,
    max_tris: int = Query(MAX_PREVIEW_TRIS, ge=20_000, le=MAX_PREVIEW_TRIS_HIGH),
    detail: str = Query("standard", pattern="^(standard|high)$"),
    entry: str | None = Query(None, description="Path inside a ZIP for printable orbit"),
):
    """Mesh for the orbit viewer (may be decimated for huge files)."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    kind = asset.get("kind")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    if detail == "high":
        max_tris = max(max_tris, MAX_PREVIEW_TRIS_HIGH)
    try:
        if kind == "zip":
            if not entry:
                raise HTTPException(400, "Pick a printable inside the ZIP (entry=…)")
            path, simplified = build_zip_entry_preview(asset, entry, max_tris=max_tris)
        elif kind in ("stl", "obj", "3mf", "gcode.3mf"):
            path, simplified = build_preview_stl(asset, max_tris=max_tris)
        else:
            raise HTTPException(400, "Orbit preview is only available for STL, OBJ, 3MF, and ZIP printables")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Preview failed: {exc}") from exc
    if not path.exists():
        raise HTTPException(404, "Preview file missing")
    headers = {
        "Cache-Control": "private, max-age=3600",
        "X-PrintShelf-Simplified": "1" if simplified else "0",
        "X-PrintShelf-Kind": kind or "",
        "X-PrintShelf-Detail": detail,
        "X-PrintShelf-MaxTris": str(max_tris),
    }
    if entry:
        headers["X-PrintShelf-Zip-Entry"] = entry
    stem = Path(entry or asset.get("file_name") or "model").stem
    return FileResponse(
        path,
        media_type="model/stl",
        filename=f"{stem}_preview.stl",
        headers=headers,
    )


@app.get("/api/thumbs/{name}")
def get_thumb(name: str):
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "Invalid thumb name")
    path = data_dir() / "thumbs" / name
    if not path.exists():
        raise HTTPException(404, "Thumb not found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
