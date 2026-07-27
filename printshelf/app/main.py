from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .config import data_dir, load_config, save_config
from .db import db_session, init_db, parse_json_field, row_to_dict
from .paths import to_windows_folder, to_windows_path
from .preview import (
    MAX_PREVIEW_TRIS,
    MAX_PREVIEW_TRIS_HIGH,
    build_preview_stl,
    get_asset_row,
    path_is_allowed,
    path_under_watched,
)
from .scanner import (
    get_scan_state,
    get_thumb_rebuild_state,
    start_scan_background,
    start_thumb_rebuild_background,
)

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
    init_db(data_dir(cfg) / "printshelf.sqlite3")


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
    """Rebuild stale STL/OBJ thumbs without re-walking the whole NAS."""
    return start_thumb_rebuild_background(kinds=("stl", "obj"))


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


@app.get("/api/assets")
def list_assets(
    q: str | None = None,
    kind: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    missing: bool = False,
    hidden: bool | None = False,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    clauses = ["a.missing = ?" ]
    params: list[Any] = [1 if missing else 0]
    if hidden is None:
        pass  # both visible and hidden
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
    if q:
        clauses.append("(a.file_name LIKE ? OR a.rel_path LIKE ? OR d.name LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
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
    items = []
    for r in rows:
        item = row_to_dict(r)
        assert item
        item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
        item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
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
    item["can_orbit"] = item.get("kind") in ("stl", "obj")
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


@app.post("/api/assets/{asset_id}/delete")
def delete_asset(
    asset_id: int,
    delete_sidecars: bool = Query(True),
) -> dict[str, Any]:
    """Permanently delete the file on disk (and indexed sidecars), then drop the DB row."""
    return _delete_asset_disk(asset_id, delete_sidecars=delete_sidecars)


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


@app.get("/api/assets/{asset_id}/model")
def get_asset_model(
    asset_id: int,
    max_tris: int = Query(MAX_PREVIEW_TRIS, ge=20_000, le=MAX_PREVIEW_TRIS_HIGH),
    detail: str = Query("standard", pattern="^(standard|high)$"),
):
    """STL/OBJ mesh for the orbit viewer (may be decimated for huge files)."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    kind = asset.get("kind")
    if kind not in ("stl", "obj"):
        raise HTTPException(400, "Orbit preview is only available for STL and OBJ")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    if detail == "high":
        max_tris = max(max_tris, MAX_PREVIEW_TRIS_HIGH)
    try:
        path, simplified = build_preview_stl(asset, max_tris=max_tris)
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
    return FileResponse(
        path,
        media_type="model/stl",
        filename=f"{Path(asset.get('file_name') or 'model').stem}_preview.stl",
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
