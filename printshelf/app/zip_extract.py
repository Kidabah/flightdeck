"""Rescue a printable from a ZIP into PrintShelf Extracted (NAS), then index it."""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any

from .config import data_dir, load_config
from .db import db_session, init_db
from .parsers import detect_kind, parse_asset
from .parsers.ziparchive import PRINTABLE_SUFFIXES
from .paths import to_windows_path
from .preview import get_asset_row, path_is_allowed, read_zip_entry_bytes, safe_zip_entry
from .scanner import file_hash, upsert_asset

log = logging.getLogger("printshelf.extract")

_DEFAULT_EXTRACT_NAME = "PrintShelf Extracted"
_SAFE_NAME = re.compile(r"[^\w.\- ()\[\]]+", re.UNICODE)


def _is_printable_entry(name: str) -> bool:
    lower = (name or "").lower().replace("\\", "/")
    base = Path(lower).name
    if not base or base.startswith(".") or "/__macosx/" in f"/{lower}":
        return False
    return any(lower.endswith(suf) for suf in PRINTABLE_SUFFIXES)


def _safe_basename(name: str) -> str:
    base = Path(name or "model").name.strip() or "model"
    base = base.replace("\x00", "").replace("/", "_").replace("\\", "_")
    cleaned = _SAFE_NAME.sub("_", base).strip(" ._") or "model"
    return cleaned[:180]


def resolve_extract_dir(cfg: dict[str, Any] | None = None) -> tuple[Path, dict[str, Any]]:
    """
    Return (extract_dir, watched_folder_dict used for upsert).
    Prefers config extract_dir; else <koko-kidabah>/PrintShelf Extracted;
    else first NAS watched root.
    """
    cfg = cfg or load_config()
    folders = list(cfg.get("watched_folders") or [])
    explicit = str(cfg.get("extract_dir") or "").strip()
    if explicit:
        dest = Path(explicit)
        host = _folder_containing(dest, folders)
        if not host:
            raise ValueError(
                f"extract_dir {dest} is not under a watched folder — "
                "set extract_dir inside koko-kidabah (or another watched root)."
            )
        return dest, host

    koko = next((f for f in folders if str(f.get("id") or "") == "koko-kidabah"), None)
    nas = next((f for f in folders if str(f.get("source_kind") or "") == "nas"), None)
    host = koko or nas
    if not host:
        raise ValueError(
            "No NAS watched folder for extracts. Add koko-kidabah, or set extract_dir in config."
        )
    root = Path(str(host.get("path") or ""))
    if not root.is_dir():
        raise ValueError(f"NAS root missing on Pi: {root}")
    return root / _DEFAULT_EXTRACT_NAME, host


def _folder_containing(path: Path, folders: list[dict[str, Any]]) -> dict[str, Any] | None:
    try:
        target = path.resolve()
    except Exception:
        target = path
    best: dict[str, Any] | None = None
    best_len = -1
    for folder in folders:
        raw = str(folder.get("path") or "").strip()
        if not raw:
            continue
        try:
            root = Path(raw).resolve()
        except Exception:
            root = Path(raw)
        try:
            target.relative_to(root)
        except Exception:
            continue
        if len(str(root)) > best_len:
            best = folder
            best_len = len(str(root))
    return best


def _bytes_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _unique_dest(dest_dir: Path, filename: str, data: bytes) -> tuple[Path, bool]:
    """
    Pick a path under dest_dir. Returns (path, reused_existing).
    Same-name + same content → reuse. Same-name different content → name (2).ext …
    """
    safe = _safe_basename(filename)
    stem = Path(safe).stem or "model"
    # Preserve .gcode.3mf
    lower = safe.lower()
    if lower.endswith(".gcode.3mf"):
        suffix = ".gcode.3mf"
        stem = safe[: -len(".gcode.3mf")] or "model"
    else:
        suffix = Path(safe).suffix or ""

    digest = _bytes_digest(data)
    candidate = dest_dir / f"{stem}{suffix}"
    n = 2
    while candidate.exists():
        try:
            existing = candidate.read_bytes()
            if _bytes_digest(existing) == digest:
                return candidate, True
        except Exception:
            pass
        candidate = dest_dir / f"{stem} ({n}){suffix}"
        n += 1
        if n > 500:
            raise RuntimeError("Too many name collisions in PrintShelf Extracted")
    return candidate, False


def extract_zip_printable(asset_id: int, entry: str) -> dict[str, Any]:
    cfg = load_config()
    asset = get_asset_row(asset_id)
    if not asset:
        raise ValueError("Asset not found")
    if (asset.get("kind") or "") != "zip":
        raise ValueError("Only ZIP assets can be extracted")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise PermissionError("File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise FileNotFoundError("Zip missing on disk")

    entry = safe_zip_entry(entry)
    # For nested Outer.zip/inner.stl, validate the leaf name.
    leaf = entry.split("/")[-1] if "/" in entry else entry
    from .parsers.ziparchive import split_nested_entry

    nested, inner = split_nested_entry(entry)
    check_name = inner if nested else entry
    if not _is_printable_entry(check_name):
        raise ValueError("Entry is not a printable (stl/obj/3mf/gcode)")

    raw, file_name = read_zip_entry_bytes(src, entry)
    if not raw:
        raise ValueError("Zip entry is empty")

    dest_dir, folder = resolve_extract_dir(cfg)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out_path, reused = _unique_dest(dest_dir, file_name or leaf, raw)
    if not reused:
        out_path.write_bytes(raw)
        log.info("Extracted %s → %s (%d bytes)", entry, out_path, len(raw))
    else:
        log.info("Reused existing extract %s", out_path)

    kind = detect_kind(out_path)
    if not kind or kind == "zip":
        raise ValueError(f"Extracted file is not a printable kind: {out_path.name}")

    parsed = parse_asset(out_path, kind=kind)
    content_hash = file_hash(out_path)
    thumbs = data_dir(cfg) / "thumbs"
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)

    with db_session(db_file) as conn:
        asset_id_out, design_id = upsert_asset(conn, folder, out_path, parsed, content_hash, thumbs)

    folders = list(cfg.get("watched_folders") or [])
    win = to_windows_path(str(out_path), folders)

    return {
        "ok": True,
        "reused": reused,
        "asset_id": asset_id_out,
        "design_id": design_id,
        "file_name": out_path.name,
        "abs_path": str(out_path),
        "kind": kind,
        "extract_dir": str(dest_dir),
        "windows_path": win,
        "source_zip_id": int(asset_id),
        "source_entry": entry,
    }
