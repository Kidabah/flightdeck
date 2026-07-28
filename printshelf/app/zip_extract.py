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


def _write_and_index(
    *,
    cfg: dict[str, Any],
    folder: dict[str, Any],
    dest_dir: Path,
    raw: bytes,
    file_name: str,
    source_zip_id: int,
    source_entry: str,
) -> dict[str, Any]:
    out_path, reused = _unique_dest(dest_dir, file_name, raw)
    if not reused:
        out_path.write_bytes(raw)
        log.info("Extracted %s → %s (%d bytes)", source_entry, out_path, len(raw))
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
        "source_zip_id": int(source_zip_id),
        "source_entry": source_entry,
    }


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
    return _write_and_index(
        cfg=cfg,
        folder=folder,
        dest_dir=dest_dir,
        raw=raw,
        file_name=file_name or leaf,
        source_zip_id=int(asset_id),
        source_entry=entry,
    )


_MAX_EXTRACT_ALL = 80
_ARCHIVE_SUFFIXES = (".rar", ".7z", ".zip")


def _index_existing_file(
    *,
    cfg: dict[str, Any],
    folder: dict[str, Any],
    path: Path,
    source_zip_id: int,
    source_entry: str,
) -> dict[str, Any]:
    kind = detect_kind(path)
    if not kind or kind == "zip":
        raise ValueError(f"Not a printable kind: {path.name}")
    parsed = parse_asset(path, kind=kind)
    content_hash = file_hash(path)
    thumbs = data_dir(cfg) / "thumbs"
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)
    with db_session(db_file) as conn:
        asset_id_out, design_id = upsert_asset(conn, folder, path, parsed, content_hash, thumbs)
    folders = list(cfg.get("watched_folders") or [])
    win = to_windows_path(str(path), folders)
    return {
        "ok": True,
        "reused": False,
        "asset_id": asset_id_out,
        "design_id": design_id,
        "file_name": path.name,
        "abs_path": str(path),
        "kind": kind,
        "windows_path": win,
        "source_zip_id": int(source_zip_id),
        "source_entry": source_entry,
    }


def _stream_zip_member(src: Path, entry: str, dest: Path) -> str:
    """Write a zip member to dest without loading the whole blob into RAM. Returns basename."""
    import zipfile

    entry = safe_zip_entry(entry)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src, "r") as zf:
        names = {n.replace("\\", "/"): n for n in zf.namelist()}
        real = names.get(entry)
        if real is None:
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(entry.lower())
        if real is None:
            raise FileNotFoundError(f"Entry not found in zip: {entry}")
        with zf.open(real) as zin, dest.open("wb") as zout:
            while True:
                chunk = zin.read(1024 * 1024)
                if not chunk:
                    break
                zout.write(chunk)
    return Path(real).name


def _find_7z() -> str | None:
    import shutil

    for name in ("7z", "7za"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _list_rar_entries(src: Path, meta: dict[str, Any] | None = None) -> list[str]:
    import zipfile

    found: list[str] = []
    meta = meta or {}
    for e in meta.get("entries") or []:
        name = str(e.get("name") or "").replace("\\", "/")
        if name.lower().endswith(".rar") and name not in found:
            found.append(name)
    if found:
        return found
    try:
        with zipfile.ZipFile(src, "r") as zf:
            for info in zf.infolist():
                name = info.filename.replace("\\", "/")
                if name.lower().endswith(".rar") and name not in found:
                    found.append(name)
    except Exception as exc:
        log.warning("Could not list rar members: %s", exc)
    return found


def _unpack_archive_with_7z(archive: Path, out_dir: Path) -> None:
    import subprocess

    exe = _find_7z()
    if not exe:
        raise RuntimeError("7z is not installed on the Pi — cannot unpack .rar")
    out_dir.mkdir(parents=True, exist_ok=True)
    # x keeps folder structure for multi-part kits.
    cmd = [exe, "x", "-y", f"-o{out_dir}", str(archive)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 45)
    # 0 = ok, 1 = warnings (non-fatal). 2+ = fatal — but some RARs still drop usable files.
    if proc.returncode in (0, 1):
        return
    err = (proc.stderr or proc.stdout or "").strip()[:500]
    if _iter_printables_under(out_dir):
        log.warning(
            "7z returned %s but printables were extracted (%s): %s",
            proc.returncode,
            out_dir,
            err or "unknown",
        )
        return
    raise RuntimeError(f"7z unpack failed ({proc.returncode}): {err or 'unknown error'}")


def _iter_printables_under(root: Path) -> list[Path]:
    out: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if _is_printable_entry(path.name):
            out.append(path)
        if len(out) >= _MAX_EXTRACT_ALL:
            break
    return out


def _collect_extract_entries(src: Path, meta: dict[str, Any] | None = None) -> tuple[list[str], list[str]]:
    """
    Flat printables + one level of nested .zip printables.
    Returns (printable_entry_paths, rar_entry_paths).
    """
    import zipfile

    from .parsers.ziparchive import list_nested_zip

    entries: list[str] = []
    rars: list[str] = []
    meta = meta or {}

    for p in meta.get("printables") or []:
        name = str(p.get("name") or "").replace("\\", "/")
        if name and _is_printable_entry(name) and name not in entries:
            entries.append(name)

    nested = list(meta.get("nested_zips") or [])
    raw_entries = list(meta.get("entries") or [])
    for e in raw_entries:
        name = str(e.get("name") or "").replace("\\", "/")
        lower = name.lower()
        if lower.endswith(".rar") and name not in rars:
            rars.append(name)
        if lower.endswith(".zip") and name not in [n.get("name") for n in nested if isinstance(n, dict)]:
            nested.append({"name": name})

    if not entries and not nested and not rars:
        try:
            with zipfile.ZipFile(src, "r") as zf:
                for info in zf.infolist():
                    name = info.filename.replace("\\", "/")
                    if not name or name.endswith("/"):
                        continue
                    lower = name.lower()
                    if "/__macosx/" in f"/{lower}" or lower.startswith("__macosx/"):
                        continue
                    if lower.endswith(".rar"):
                        if name not in rars:
                            rars.append(name)
                        continue
                    if lower.endswith(".zip"):
                        nested.append({"name": name})
                        continue
                    if _is_printable_entry(name) and name not in entries:
                        entries.append(name)
        except Exception as exc:
            log.warning("Could not scan zip for extract-all: %s", exc)

    for nz in nested:
        nname = str(nz.get("name") or "").replace("\\", "/")
        if not nname.lower().endswith(".zip"):
            continue
        try:
            peeked = list_nested_zip(src, nname)
            for p in peeked.get("printables") or []:
                name = str(p.get("name") or "").replace("\\", "/")
                if name and name not in entries:
                    entries.append(name)
        except Exception as exc:
            log.info("Skip nested zip %s: %s", nname, exc)

    if not rars:
        rars = _list_rar_entries(src, meta)

    return entries[:_MAX_EXTRACT_ALL], rars


def _extract_from_nested_rars(
    *,
    cfg: dict[str, Any],
    folder: dict[str, Any],
    src: Path,
    rar_entries: list[str],
    dest_dir: Path,
    source_zip_id: int,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Stream each .rar out of the zip, 7z-unpack, index printables."""
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    staging_root = dest_dir / "_rar_staging"
    staging_root.mkdir(parents=True, exist_ok=True)

    for rar_entry in rar_entries[:3]:  # safety: don't unpack endless nested rars
        if len(results) >= _MAX_EXTRACT_ALL:
            break
        stem = _safe_basename(Path(rar_entry).stem) or "archive"
        pack_dir = dest_dir / stem
        rar_path = staging_root / f"{stem}.rar"
        try:
            log.info("Streaming rar member %s → %s", rar_entry, rar_path)
            _stream_zip_member(src, rar_entry, rar_path)
            if pack_dir.exists() and any(pack_dir.rglob("*")):
                # Already unpacked once — just re-index printables present.
                log.info("Reuse unpacked folder %s", pack_dir)
            else:
                pack_dir.mkdir(parents=True, exist_ok=True)
                _unpack_archive_with_7z(rar_path, pack_dir)
            for mesh in _iter_printables_under(pack_dir):
                if len(results) >= _MAX_EXTRACT_ALL:
                    break
                try:
                    # Keep files in the kit folder so siblings stay together on disk.
                    row = _index_existing_file(
                        cfg=cfg,
                        folder=folder,
                        path=mesh,
                        source_zip_id=source_zip_id,
                        source_entry=f"{rar_entry}::{mesh.relative_to(pack_dir).as_posix()}",
                    )
                    row["extract_dir"] = str(pack_dir)
                    row["from_rar"] = True
                    results.append(row)
                except Exception as exc:
                    errors.append({"entry": str(mesh), "error": str(exc)})
        except Exception as exc:
            log.warning("RAR extract failed for %s: %s", rar_entry, exc)
            errors.append({"entry": rar_entry, "error": str(exc)})
        finally:
            try:
                if rar_path.exists():
                    rar_path.unlink()
            except Exception:
                pass

    # Clean empty staging
    try:
        if staging_root.exists() and not any(staging_root.iterdir()):
            staging_root.rmdir()
    except Exception:
        pass

    return results, errors


def extract_all_zip_printables(asset_id: int) -> dict[str, Any]:
    """
    Rescue printables from a ZIP into PrintShelf Extracted.
    If the zip only wraps .rar member(s), stream + 7z-unpack them and index the meshes.
    """
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

    import json as _json

    meta: dict[str, Any] = {}
    try:
        meta = _json.loads(asset.get("meta_json") or "{}")
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    if not meta and isinstance(asset.get("meta"), dict):
        meta = asset["meta"]

    entry_list, rar_list = _collect_extract_entries(src, meta)
    dest_dir, folder = resolve_extract_dir(cfg)
    dest_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    created = 0
    reused = 0
    from_rar = False

    for entry in entry_list:
        try:
            raw, file_name = read_zip_entry_bytes(src, safe_zip_entry(entry))
            if not raw:
                errors.append({"entry": entry, "error": "empty"})
                continue
            row = _write_and_index(
                cfg=cfg,
                folder=folder,
                dest_dir=dest_dir,
                raw=raw,
                file_name=file_name or Path(entry).name,
                source_zip_id=int(asset_id),
                source_entry=entry,
            )
            results.append(row)
            if row.get("reused"):
                reused += 1
            else:
                created += 1
        except Exception as exc:
            log.warning("extract-all failed for %s: %s", entry, exc)
            errors.append({"entry": entry, "error": str(exc)})

    if not results and rar_list:
        from_rar = True
        rar_results, rar_errors = _extract_from_nested_rars(
            cfg=cfg,
            folder=folder,
            src=src,
            rar_entries=rar_list,
            dest_dir=dest_dir,
            source_zip_id=int(asset_id),
        )
        results.extend(rar_results)
        errors.extend(rar_errors)
        created += len([r for r in rar_results if not r.get("reused")])
        reused += len([r for r in rar_results if r.get("reused")])

    if not results:
        hint = (
            "This ZIP only wraps a .rar and unpack failed or found no meshes. "
            "Try Open zip on PC with 7-Zip."
            if rar_list
            else "No STL/OBJ/3MF printables found inside this ZIP."
        )
        if errors:
            hint += " · " + "; ".join(e.get("error", "") for e in errors[:2])
        raise ValueError(hint)

    return {
        "ok": True,
        "source_zip_id": int(asset_id),
        "extract_dir": str(dest_dir),
        "requested": len(entry_list) or len(rar_list),
        "extracted": len(results),
        "created": created,
        "reused": reused,
        "rar_unpacked": from_rar,
        "rar_members": len(rar_list),
        "capped": len(results) >= _MAX_EXTRACT_ALL,
        "items": results,
        "errors": errors,
        "design_ids": [int(r["design_id"]) for r in results if r.get("design_id")],
    }
