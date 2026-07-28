"""Design grouping: one design for sibling printables that share a stem.

v1 rule: same root_id + same parent folder + same normalized stem.
Dump folders (Downloads/Desktop/…) still use stem grouping (never whole-folder merge).
"""
from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

_SUFFIXES = (
    ".gcode.3mf",
    ".3mf",
    ".stl",
    ".obj",
    ".gcode",
    ".gco",
    ".zip",
)

# Light slicer / plate tails so model.stl joins model_plate_1.gcode.3mf
_STEM_TAILS = (
    re.compile(r"_plate_\d+$", re.I),
    re.compile(r"_plater_\d+$", re.I),
    re.compile(r"_\d+(\.\d+)?mm$", re.I),
)

DUMP_FOLDER_NAMES = frozenset({
    "downloads",
    "desktop",
    "documents",
    "pictures",
    "videos",
    "music",
    "onedrive",
    "dropbox",
    "google drive",
    "telegram files",
    "temp",
    "tmp",
})


def strip_printable_suffix(filename: str) -> str:
    name = Path(filename or "").name
    lower = name.lower()
    for suf in _SUFFIXES:
        if lower.endswith(suf):
            return name[: -len(suf)]
    return Path(name).stem


def normalize_stem(filename: str) -> str:
    stem = strip_printable_suffix(filename).strip()
    if not stem:
        return "unnamed"
    changed = True
    while changed:
        changed = False
        for rx in _STEM_TAILS:
            nxt = rx.sub("", stem)
            if nxt != stem and nxt:
                stem = nxt
                changed = True
    # Collapse whitespace / case for the key; keep display name separate.
    key = re.sub(r"\s+", " ", stem).strip().lower()
    return key or "unnamed"


def parent_dir(rel_path: str) -> str:
    rel = (rel_path or "").replace("\\", "/").strip("/")
    if not rel or "/" not in rel:
        return ""
    return str(PurePosixPath(rel).parent).replace("\\", "/")


def is_dump_folder(parent: str) -> bool:
    """True when parent is empty (root) or a known dump directory name."""
    if not parent or parent in (".", "/"):
        return True
    base = PurePosixPath(parent).name.lower()
    return base in DUMP_FOLDER_NAMES


def design_group_key(root_id: str, rel_path: str, file_name: str | None = None) -> str:
    """Stable key: root|parent|stem."""
    rid = (root_id or "folder").strip() or "folder"
    rel = (rel_path or "").replace("\\", "/").strip("/")
    name = file_name or (PurePosixPath(rel).name if rel else "")
    parent = parent_dir(rel)
    stem = normalize_stem(name)
    return f"{rid}|{parent}|{stem}"


def design_display_name(rel_path: str, file_name: str | None = None) -> str:
    """Human label: parent folder when nested (and not a dump), else stem."""
    rel = (rel_path or "").replace("\\", "/").strip("/")
    name = file_name or (PurePosixPath(rel).name if rel else "design")
    parent = parent_dir(rel)
    stem_display = strip_printable_suffix(name).strip() or Path(name).stem or "design"
    if parent and not is_dump_folder(parent):
        return PurePosixPath(parent).name
    return stem_display
