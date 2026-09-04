from __future__ import annotations

from pathlib import Path
from typing import Any

from .obj import parse_obj
from .stl import parse_stl
from .threemf import parse_3mf
from .ziparchive import parse_zip

# Plain .gcode/.gco files are intentionally not library assets. They are
# printer/profile-specific output rather than reusable designs. Keep
# .gcode.3mf because Bambu Studio and FlightDeck use that packaged format.
PRINTABLE_EXTS = {".stl", ".obj", ".3mf", ".gcode.3mf", ".zip"}


def detect_kind(path: Path) -> str | None:
    name = path.name.lower()
    if name.endswith(".gcode.3mf"):
        return "gcode.3mf"
    suf = path.suffix.lower()
    if suf == ".stl":
        return "stl"
    if suf == ".obj":
        return "obj"
    if suf == ".3mf":
        return "3mf"
    if suf == ".zip":
        return "zip"
    return None


def parse_asset(path: Path, kind: str | None = None) -> dict[str, Any]:
    kind = kind or detect_kind(path)
    if kind == "stl":
        return parse_stl(path)
    if kind in ("3mf", "gcode.3mf"):
        return parse_3mf(path, kind=kind)
    if kind == "obj":
        return parse_obj(path)
    if kind == "zip":
        return parse_zip(path)
    return {"kind": kind or "unknown", "meta": {}, "sidecars": [], "error": "unsupported"}
