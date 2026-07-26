from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


def _read_zip_text(z: zipfile.ZipFile, name: str) -> str:
    try:
        return z.read(name).decode("utf-8", "ignore")
    except Exception:
        return ""


def _parse_project_settings(raw: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _filament_summary(settings: dict[str, Any], plate: dict[str, Any] | None) -> list[dict[str, Any]]:
    colours = settings.get("filament_colour") or settings.get("filament_colors") or []
    types_ = settings.get("filament_type") or []
    ids = []
    if isinstance(plate, dict):
        ids = plate.get("filament_ids") or plate.get("filaments") or []
    out = []
    if isinstance(ids, list) and ids:
        for fid in ids:
            try:
                i = int(fid) - 1
            except Exception:
                continue
            entry = {"filament_id": fid}
            if isinstance(colours, list) and 0 <= i < len(colours):
                entry["colour"] = colours[i]
            if isinstance(types_, list) and 0 <= i < len(types_):
                entry["type"] = types_[i]
            out.append(entry)
        return out
    # fallback: list all colours
    if isinstance(colours, list):
        for i, c in enumerate(colours[:16]):
            out.append({"filament_id": i + 1, "colour": c, "type": (types_[i] if isinstance(types_, list) and i < len(types_) else None)})
    return out


def parse_3mf(path: Path, kind: str = "3mf") -> dict[str, Any]:
    meta: dict[str, Any] = {"plates": [], "objects": [], "filaments": []}
    thumb_bytes = None
    is_sliced = kind == "gcode.3mf" or path.name.lower().endswith(".gcode.3mf")
    triangle_count = None

    try:
        with zipfile.ZipFile(path, "r") as z:
            names = z.namelist()
            name_map = {n.replace("\\", "/"): n for n in names}
            # Prefer Bambu / 3D Builder / common embedded previews
            preferred = (
                "Metadata/plate_1.png",
                "Metadata/plate_no_light_1.png",
                "Metadata/top_1.png",
                "Metadata/pick_1.png",
                "Metadata/thumbnail.png",
                "Metadata/Thumbnail.png",
                "Metadata/thumbnail.jpg",
                "Thumbnails/thumbnail.png",
                "Thumbnails/Thumbnail.png",
            )
            for candidate in preferred:
                real = name_map.get(candidate)
                if real:
                    try:
                        thumb_bytes = z.read(real)
                        break
                    except Exception:
                        pass
            if thumb_bytes is None:
                # Any image under Metadata/ or Thumbnails/
                for n in names:
                    nl = n.replace("\\", "/").lower()
                    if not nl.endswith((".png", ".jpg", ".jpeg")):
                        continue
                    if nl.startswith("metadata/") or nl.startswith("thumbnails/") or "thumb" in nl:
                        try:
                            thumb_bytes = z.read(n)
                            break
                        except Exception:
                            pass
            if thumb_bytes is None:
                # Last resort: first raster in the package
                for n in names:
                    if n.lower().endswith((".png", ".jpg", ".jpeg")):
                        try:
                            thumb_bytes = z.read(n)
                            break
                        except Exception:
                            pass

            settings = _parse_project_settings(_read_zip_text(z, "Metadata/project_settings.config"))
            if not settings:
                settings = _parse_project_settings(_read_zip_text(z, "project_settings.config"))

            # plate_*.json
            plate_files = sorted(
                n for n in names
                if re.match(r"Metadata/plate_\d+\.json$", n.replace("\\", "/"))
            )
            for pf in plate_files:
                try:
                    plate = json.loads(z.read(pf).decode("utf-8", "ignore"))
                except Exception:
                    continue
                if not isinstance(plate, dict):
                    continue
                meta["plates"].append({
                    "file": pf,
                    "name": plate.get("name") or plate.get("plate_name") or Path(pf).stem,
                    "filament_ids": plate.get("filament_ids") or [],
                })
                if not meta["filaments"]:
                    meta["filaments"] = _filament_summary(settings, plate)

            if not meta["filaments"] and settings:
                meta["filaments"] = _filament_summary(settings, None)

            # slice markers
            if any(n.endswith(".gcode") for n in names) or any("slice_info" in n for n in names):
                is_sliced = True

            # object names from model XML (best-effort)
            model_names = [n for n in names if n.endswith(".model") or n.endswith("3dmodel.model")]
            for mn in model_names[:5]:
                try:
                    root = ET.fromstring(z.read(mn))
                except Exception:
                    continue
                for el in root.iter():
                    tag = el.tag.split("}")[-1].lower()
                    if tag == "object":
                        name = el.attrib.get("name") or el.attrib.get("id")
                        if name:
                            meta["objects"].append(str(name))
                    if tag == "triangle":
                        triangle_count = (triangle_count or 0) + 1

            meta["settings_keys"] = sorted(list(settings.keys()))[:40] if settings else []
            if settings.get("printer_model"):
                meta["printer_model"] = settings.get("printer_model")
            if settings.get("print_settings_id"):
                meta["print_settings_id"] = settings.get("print_settings_id")

    except Exception as exc:
        return {
            "kind": kind,
            "triangle_count": None,
            "bbox": None,
            "meta": {"error": str(exc)},
            "sidecars": [],
            "thumb_bytes": None,
            "is_sliced": is_sliced,
            "has_textures": False,
        }

    return {
        "kind": kind,
        "triangle_count": triangle_count,
        "bbox": None,
        "meta": meta,
        "sidecars": [],
        "thumb_bytes": thumb_bytes,
        "is_sliced": is_sliced,
        "has_textures": False,
    }
