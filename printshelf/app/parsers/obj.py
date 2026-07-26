from __future__ import annotations

import re
from pathlib import Path
from typing import Any

TEX_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tga", ".tif", ".tiff", ".webp"}


def _parse_mtl_textures(mtl_path: Path) -> list[str]:
    refs: list[str] = []
    try:
        text = mtl_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return refs
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0].lower() in {
            "map_kd", "map_ka", "map_ks", "map_bump", "bump", "disp", "map_d", "refl",
        }:
            # last token is usually the filename
            refs.append(parts[-1].strip().strip('"'))
    return refs


def parse_obj(path: Path) -> dict[str, Any]:
    verts = 0
    faces = 0
    mtllibs: list[str] = []
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("v "):
                    verts += 1
                elif line.startswith("f "):
                    faces += 1
                elif line.startswith("mtllib "):
                    mtllibs.append(line.split(None, 1)[1].strip())
    except Exception as exc:
        return {
            "kind": "obj",
            "triangle_count": None,
            "bbox": None,
            "meta": {"error": str(exc)},
            "sidecars": [],
            "thumb_bytes": None,
            "is_sliced": False,
            "has_textures": False,
        }

    sidecars: list[dict[str, Any]] = []
    texture_names: list[str] = []
    parent = path.parent
    for mtl_name in mtllibs:
        mtl_path = (parent / mtl_name).resolve()
        if mtl_path.exists():
            sidecars.append({
                "role": "mtl",
                "abs_path": str(mtl_path),
                "file_name": mtl_path.name,
                "size_bytes": mtl_path.stat().st_size,
            })
            for tex in _parse_mtl_textures(mtl_path):
                texture_names.append(tex)
                tex_path = (parent / tex).resolve()
                if tex_path.exists():
                    sidecars.append({
                        "role": "texture",
                        "abs_path": str(tex_path),
                        "file_name": tex_path.name,
                        "size_bytes": tex_path.stat().st_size,
                    })

    # also pick up sibling image files commonly shipped with OBJ packs
    if not texture_names:
        for p in parent.iterdir():
            if p.is_file() and p.suffix.lower() in TEX_EXTS:
                sidecars.append({
                    "role": "texture",
                    "abs_path": str(p.resolve()),
                    "file_name": p.name,
                    "size_bytes": p.stat().st_size,
                })

    # dedupe sidecars by path
    seen = set()
    uniq = []
    for s in sidecars:
        if s["abs_path"] in seen:
            continue
        seen.add(s["abs_path"])
        uniq.append(s)

    has_textures = any(s["role"] == "texture" for s in uniq)
    missing_tex = []
    for name in texture_names:
        if not (parent / name).exists():
            missing_tex.append(name)

    thumb_bytes = None
    for s in uniq:
        if s["role"] != "texture":
            continue
        try:
            thumb_bytes = Path(s["abs_path"]).read_bytes()
            break
        except Exception:
            continue

    return {
        "kind": "obj",
        "triangle_count": faces,
        "bbox": None,
        "meta": {
            "vertex_count": verts,
            "face_count": faces,
            "mtllibs": mtllibs,
            "texture_refs": texture_names,
            "missing_textures": missing_tex,
            "texture_pack_complete": not missing_tex and (has_textures or not texture_names),
        },
        "sidecars": uniq,
        "thumb_bytes": thumb_bytes,
        "is_sliced": False,
        "has_textures": has_textures,
    }
