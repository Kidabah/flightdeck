"""MakerDeck design library — vault files + reloadable param sidecars."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)

IMPORTS_FILENAME = "makerdeck_designs.json"
IMPORT_SUBDIR = "MakerDeck"
SIDECAR_SUFFIX = ".makerdeck.json"
_MAX_DESIGNS = 100


class MakerDeckLibraryError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def imports_path(data_dir: Path) -> Path:
    return data_dir / IMPORTS_FILENAME


def load_designs(data_dir: Path) -> list[dict[str, Any]]:
    path = imports_path(data_dir)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        log.warning("makerdeck: could not read designs manifest at %s", path)
        return []
    rows = payload.get("designs") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("id")]


def save_designs(data_dir: Path, rows: list[dict[str, Any]]) -> None:
    path = imports_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    trimmed = rows[:_MAX_DESIGNS]
    path.write_text(json.dumps({"designs": trimmed}, indent=2), encoding="utf-8")


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_meta(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MakerDeckLibraryError("Invalid meta JSON.") from exc
    if not isinstance(payload, dict):
        raise MakerDeckLibraryError("meta must be a JSON object.")
    return payload


def _vault_folder(
    library_root: Path,
    safe_join_under: Callable[..., Path],
) -> Path:
    folder = safe_join_under(library_root.resolve(), IMPORT_SUBDIR, missing_ok=True)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def save_export(
    *,
    library_root: Path,
    data_dir: Path,
    filename: str,
    file_bytes: bytes,
    meta_json: str,
    safe_join_under: Callable[..., Path],
    safe_basename: Callable[[str | None, str], str],
) -> dict[str, Any]:
    if not file_bytes:
        raise MakerDeckLibraryError("Empty export file.")

    meta = _parse_meta(meta_json)
    safe_name = safe_basename(filename, "makerdeck-export")
    folder = _vault_folder(library_root, safe_join_under)
    dest = safe_join_under(folder, safe_name, missing_ok=True)
    if dest.exists():
        stem = dest.stem
        suffix = "".join(dest.suffixes) or dest.suffix
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        dest = safe_join_under(folder, f"{stem}_{stamp}{suffix}", missing_ok=True)

    dest.write_bytes(file_bytes)
    vault_rel = dest.relative_to(library_root.resolve()).as_posix()

    design_id = str(meta.get("id") or uuid.uuid4().hex[:12])
    exported_at = str(meta.get("exported_at") or _utc_now())
    name = str(meta.get("name") or dest.stem)
    fmt = str(meta.get("format") or dest.suffix.lstrip(".") or "bin")
    part = str(meta.get("part") or "body")
    thumbnail = str(meta.get("thumbnail") or "")
    state = meta.get("state") if isinstance(meta.get("state"), dict) else {}
    trace_image = meta.get("traceImage") if isinstance(meta.get("traceImage"), str) else ""

    sidecar_name = f"{dest.stem}{SIDECAR_SUFFIX}"
    sidecar = safe_join_under(folder, sidecar_name, missing_ok=True)
    sidecar_payload = {
        "id": design_id,
        "name": name,
        "format": fmt,
        "part": part,
        "exported_at": exported_at,
        "watermark_serial": meta.get("watermark_serial"),
        "vault_path": vault_rel,
        "state": state,
        "traceImage": trace_image,
    }
    sidecar.write_text(json.dumps(sidecar_payload, indent=2), encoding="utf-8")
    sidecar_rel = sidecar.relative_to(library_root.resolve()).as_posix()

    record = {
        "id": design_id,
        "name": name,
        "format": fmt,
        "part": part,
        "exported_at": exported_at,
        "watermark_serial": meta.get("watermark_serial"),
        "vault_path": vault_rel,
        "sidecar_path": sidecar_rel,
        "thumbnail": thumbnail,
        "size": len(file_bytes),
    }

    rows = load_designs(data_dir)
    rows = [row for row in rows if row.get("id") != design_id]
    rows.insert(0, record)
    save_designs(data_dir, rows)

    return {
        "ok": True,
        "design": record,
    }


def recent_designs(data_dir: Path, limit: int = 50) -> list[dict[str, Any]]:
    rows = load_designs(data_dir)
    cap = max(1, min(limit, _MAX_DESIGNS))
    out = []
    for row in rows[:cap]:
        out.append({
            "id": row.get("id"),
            "name": row.get("name"),
            "format": row.get("format"),
            "part": row.get("part"),
            "exported_at": row.get("exported_at"),
            "watermark_serial": row.get("watermark_serial"),
            "vault_path": row.get("vault_path"),
            "sidecar_path": row.get("sidecar_path"),
            "thumbnail": row.get("thumbnail"),
            "size": row.get("size"),
        })
    return out


def _find_design(data_dir: Path, design_id: str) -> dict[str, Any] | None:
    design_id = (design_id or "").strip()
    if not design_id:
        return None
    for row in load_designs(data_dir):
        if str(row.get("id")) == design_id:
            return row
    return None


def design_params(
    data_dir: Path,
    library_root: Path,
    design_id: str,
    safe_join_under: Callable[..., Path],
) -> dict[str, Any]:
    row = _find_design(data_dir, design_id)
    if not row:
        raise MakerDeckLibraryError("Design not found.", status=404)
    sidecar_rel = str(row.get("sidecar_path") or "").strip()
    if not sidecar_rel:
        raise MakerDeckLibraryError("Design sidecar missing.", status=404)
    sidecar = safe_join_under(library_root.resolve(), sidecar_rel, missing_ok=True)
    if not sidecar.is_file():
        raise MakerDeckLibraryError("Design sidecar not found on disk.", status=404)
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except Exception as exc:
        raise MakerDeckLibraryError("Could not read design sidecar.") from exc
    if not isinstance(payload, dict):
        raise MakerDeckLibraryError("Invalid design sidecar.")
    return payload


def delete_design(
    data_dir: Path,
    library_root: Path,
    design_id: str,
    safe_join_under: Callable[..., Path],
) -> bool:
    row = _find_design(data_dir, design_id)
    if not row:
        return False
    for key in ("vault_path", "sidecar_path"):
        rel = str(row.get(key) or "").strip()
        if not rel:
            continue
        try:
            path = safe_join_under(library_root.resolve(), rel, missing_ok=True)
            if path.is_file():
                path.unlink()
        except Exception:
            log.warning("makerdeck: could not delete %s for design %s", key, design_id)
    rows = [r for r in load_designs(data_dir) if str(r.get("id")) != design_id]
    save_designs(data_dir, rows)
    return True
