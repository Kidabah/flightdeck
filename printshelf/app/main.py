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
        assets = conn.execute("SELECT COUNT(*) AS c FROM assets WHERE missing = 0").fetchone()["c"]
        by_kind = {
            r["kind"]: r["c"]
            for r in conn.execute(
                "SELECT kind, COUNT(*) AS c FROM assets WHERE missing = 0 GROUP BY kind"
            ).fetchall()
        }
    return {
        "designs": designs,
        "assets": assets,
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
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    clauses = ["a.missing = ?" ]
    params: list[Any] = [1 if missing else 0]
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
    return item


@app.get("/api/thumbs/{name}")
def get_thumb(name: str):
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "Invalid thumb name")
    path = data_dir() / "thumbs" / name
    if not path.exists():
        raise HTTPException(404, "Thumb not found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
