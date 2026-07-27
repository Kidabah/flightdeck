from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any

PRINTABLE_SUFFIXES = (".stl", ".obj", ".3mf", ".gcode.3mf")
MAX_LISTED = 120


def _is_printable(name: str) -> bool:
    lower = name.lower().replace("\\", "/")
    if lower.endswith("/") or "/__macosx/" in f"/{lower}" or lower.startswith("__macosx/"):
        return False
    base = Path(lower).name
    if base.startswith("."):
        return False
    return any(lower.endswith(suf) for suf in PRINTABLE_SUFFIXES)


def _kind_inside(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    if lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".stl"):
        return "stl"
    if lower.endswith(".obj"):
        return "obj"
    return None


def parse_zip(path: Path) -> dict[str, Any]:
    """Index a .zip in place — list members, count printables. No extract."""
    entries: list[dict[str, Any]] = []
    printable: list[dict[str, Any]] = []
    by_kind: dict[str, int] = {}
    total_files = 0
    total_uncompressed = 0
    error = None

    try:
        with zipfile.ZipFile(path, "r") as zf:
            infos = zf.infolist()
            for info in infos:
                name = info.filename.replace("\\", "/")
                if not name or name.endswith("/"):
                    continue
                lower = name.lower()
                if "/__macosx/" in f"/{lower}" or lower.startswith("__macosx/"):
                    continue
                total_files += 1
                total_uncompressed += int(info.file_size or 0)
                row = {
                    "name": name,
                    "size_bytes": int(info.file_size or 0),
                    "compressed_bytes": int(info.compress_size or 0),
                }
                if len(entries) < MAX_LISTED:
                    entries.append(row)
                pk = _kind_inside(name)
                if pk:
                    by_kind[pk] = by_kind.get(pk, 0) + 1
                    if len(printable) < MAX_LISTED:
                        printable.append({**row, "kind": pk})
    except zipfile.BadZipFile as exc:
        error = f"Bad zip: {exc}"
    except Exception as exc:
        error = str(exc)

    printable_count = sum(by_kind.values())
    return {
        "kind": "zip",
        "triangle_count": None,
        "bbox": None,
        "has_textures": False,
        "is_sliced": False,
        "thumb_bytes": None,
        "sidecars": [],
        "error": error,
        "meta": {
            "archive": True,
            "entry_count": total_files,
            "listed_count": len(entries),
            "list_truncated": total_files > len(entries),
            "uncompressed_bytes": total_uncompressed,
            "printable_count": printable_count,
            "printable_by_kind": by_kind,
            "entries": entries,
            "printables": printable,
            "error": error,
        },
    }
