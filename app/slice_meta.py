"""Extract estimated print time and filament grams from sliced vault files."""
from __future__ import annotations

import gzip
import io
import json
import re
import zipfile
from xml.etree import ElementTree as ET


def _local(tag: str) -> str:
    return tag.split("}")[-1].lower()


def _fmt_hours(seconds: float | None) -> float | None:
    if seconds is None or seconds <= 0:
        return None
    return round(float(seconds) / 3600.0, 2)


def parse_slice_totals(filename: str, data: bytes) -> dict:
    name = str(filename or "").lower()
    result = {
        "sliced": False,
        "seconds": None,
        "grams": None,
        "material": None,
        "plate_count": 0,
        "status": "not_sliced",
        "status_detail": "Not sliced yet",
    }
    if name.endswith(".gcode.3mf") or name.endswith(".3mf"):
        parsed = _parse_3mf_slice(data)
        result.update(parsed)
        return result
    if name.endswith(".gcode.gz"):
        try:
            text = gzip.decompress(data).decode("utf-8", "ignore")
        except Exception:
            return result
        parsed = _parse_gcode_slice(text)
        result.update(parsed)
        return result
    if name.endswith(".gcode") or name.endswith(".ufp"):
        parsed = _parse_gcode_slice(data.decode("utf-8", "ignore"))
        result.update(parsed)
        return result
    return result


def _status_for(out: dict, *, has_gcode: bool, has_slice_file: bool, plate_previews: int) -> dict:
    if out.get("seconds") or out.get("grams"):
        out["sliced"] = True
        out["status"] = "sliced"
        out["status_detail"] = "Sliced"
        return out
    if has_gcode:
        out["sliced"] = False
        out["status"] = "gcode_no_totals"
        out["status_detail"] = "Has plate gcode but no time/weight totals"
        return out
    if has_slice_file or plate_previews > 0:
        out["sliced"] = False
        out["status"] = "project_archive"
        out["status_detail"] = (
            "Bambu project file — Save Project keeps previews only. "
            "Export each plate as .gcode.3mf for quotes."
        )
        return out
    out["sliced"] = False
    out["status"] = "not_sliced"
    out["status_detail"] = "Not sliced yet"
    return out


def _parse_3mf_slice(data: bytes) -> dict:
    out = {
        "sliced": False,
        "seconds": None,
        "grams": None,
        "material": None,
        "plate_count": 0,
        "status": "not_sliced",
        "status_detail": "Not sliced yet",
    }
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n.replace("\\", "/") for n in z.namelist()]
            lower_map = {n.lower(): n for n in names}
            slice_name = next(
                (lower_map[n] for n in lower_map if n.endswith("metadata/slice_info.config") or n == "metadata/slice_info.config"),
                None,
            )
            if not slice_name:
                slice_name = next((lower_map[n] for n in lower_map if n.endswith("slice_info.config")), None)
            gcode_names = [
                n for n in names
                if n.replace("\\", "/").lower().startswith("metadata/")
                and n.lower().endswith(".gcode")
                and "/plate_" in n.replace("\\", "/").lower()
            ]
            plate_previews = sum(
                1 for n in names
                if re.search(r"(?i)metadata/plate_\d+\.png$", n.replace("\\", "/"))
            )
            xml = ""
            if slice_name:
                xml = z.read(slice_name).decode("utf-8", "ignore")
            seconds, grams, material, plates = _sum_slice_info_xml(xml)
            # Fall back: sum totals from embedded plate_*.gcode comments.
            if (seconds is None or grams is None) and gcode_names:
                g_secs = 0
                g_grams = 0.0
                g_mat = material
                g_plates = 0
                for gn in gcode_names:
                    try:
                        text = z.read(gn).decode("utf-8", "ignore")
                    except Exception:
                        continue
                    parsed = _parse_gcode_slice(text)
                    if parsed.get("seconds"):
                        g_secs += int(parsed["seconds"])
                        g_plates += 1
                    if parsed.get("grams"):
                        g_grams += float(parsed["grams"])
                        if not g_plates:
                            g_plates += 1
                    if not g_mat and parsed.get("material"):
                        g_mat = parsed["material"]
                if g_secs > 0 and seconds is None:
                    seconds = g_secs
                if g_grams > 0 and grams is None:
                    grams = g_grams
                if g_mat:
                    material = g_mat
                if g_plates and plates <= 0:
                    plates = g_plates
            out["seconds"] = int(seconds) if seconds and seconds > 0 else None
            out["grams"] = round(grams, 2) if grams and grams > 0 else None
            out["material"] = str(material).strip() if material else None
            out["plate_count"] = int(plates or 0)
            return _status_for(
                out,
                has_gcode=bool(gcode_names),
                has_slice_file=bool(slice_name),
                plate_previews=plate_previews,
            )
    except Exception:
        return out


def _sum_slice_info_xml(xml: str) -> tuple[float | None, float | None, str | None, int]:
    if not xml.strip():
        return None, None, None, 0
    try:
        root = ET.fromstring(xml)
    except Exception:
        return None, None, None, 0
    seconds = 0.0
    grams = 0.0
    material = None
    plates = 0
    for plate in root.iter():
        if _local(plate.tag) != "plate":
            continue
        plates += 1
        pred = None
        weight = None
        for child in list(plate):
            tag = _local(child.tag)
            if tag == "metadata":
                key = (child.attrib.get("key") or "").lower()
                value = child.attrib.get("value")
                if key == "prediction":
                    pred = value
                elif key == "weight":
                    weight = value
            elif tag == "filament" and material is None:
                material = child.attrib.get("type") or None
                used_g = child.attrib.get("used_g")
                if weight is None and used_g:
                    weight = used_g
        try:
            if pred:
                seconds += float(pred)
        except (TypeError, ValueError):
            pass
        try:
            if weight:
                grams += float(weight)
        except (TypeError, ValueError):
            pass
    return (
        seconds if seconds > 0 else None,
        grams if grams > 0 else None,
        material,
        plates,
    )


_RE_TIME = re.compile(r"\bTIME\s*:\s*(\d+)", re.I)
_RE_PRUSA_TIME = re.compile(
    r"estimated printing time(?: \(normal mode\))?\s*=\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?",
    re.I,
)
_RE_WEIGHT = re.compile(
    r"(?:total filament used|filament used)\s*(?:\[[gG]\])?\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.I,
)
_RE_MATERIAL = re.compile(r"filament[_ -]?type\s*[:=]\s*([A-Za-z0-9+/* -]+)", re.I)
_RE_BAMBU_MODEL_TIME = re.compile(r";\s*model printing time:\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?", re.I)
_RE_BAMBU_TOTAL_TIME = re.compile(r";\s*total estimated time:\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?", re.I)
_RE_BAMBU_WEIGHT = re.compile(r";\s*total filament weight \[g\]\s*:\s*([0-9]+(?:\.[0-9]+)?)", re.I)


def _hms_to_seconds(hours, mins, secs) -> int:
    return int(hours or 0) * 3600 + int(mins or 0) * 60 + int(secs or 0)


def _prusa_time_seconds(match: re.Match) -> int:
    days, hours, mins, secs = (int(g or 0) for g in match.groups())
    return days * 86400 + hours * 3600 + mins * 60 + secs


def _parse_gcode_slice(text: str) -> dict:
    head = "\n".join(text.splitlines()[:4000])
    tail = "\n".join(text.splitlines()[-800:])
    blob = head + "\n" + tail
    seconds = None
    grams = None
    material = None
    m_time = _RE_TIME.search(blob)
    if m_time:
        try:
            seconds = int(m_time.group(1))
        except ValueError:
            seconds = None
    if seconds is None:
        m_prusa = _RE_PRUSA_TIME.search(blob)
        if m_prusa:
            seconds = _prusa_time_seconds(m_prusa) or None
    if seconds is None:
        for rx in (_RE_BAMBU_TOTAL_TIME, _RE_BAMBU_MODEL_TIME):
            m = rx.search(blob)
            if m:
                seconds = _hms_to_seconds(*m.groups()) or None
                if seconds:
                    break
    m_w = _RE_WEIGHT.search(blob) or _RE_BAMBU_WEIGHT.search(blob)
    if m_w:
        try:
            grams = float(m_w.group(1))
        except ValueError:
            grams = None
    m_mat = _RE_MATERIAL.search(blob)
    if m_mat:
        material = m_mat.group(1).strip() or None
    sliced = seconds is not None or grams is not None
    return {
        "sliced": sliced,
        "seconds": seconds if seconds and seconds > 0 else None,
        "grams": round(grams, 2) if grams and grams > 0 else None,
        "material": material,
        "plate_count": 1 if sliced else 0,
        "status": "sliced" if sliced else "not_sliced",
        "status_detail": "Sliced" if sliced else "Not sliced yet",
    }


def hours_from_seconds(seconds: int | None) -> float | None:
    return _fmt_hours(seconds)


# Bambu Studio writes inherit-sentinels into Metadata/project_settings.config.
# The GUI treats them as "use parent preset"; Orca's CLI range-checks them first
# and exits with "Param values in 3mf/config error". Drop those keys so
# --load-settings supplies valid defaults.
_CLI_SENTINEL_MINUS_ONE_KEYS = {
    "raft_first_layer_expansion",
    "tree_support_wall_count",
    "prime_tower_brim_width",
    "prime_tower_width",
    "support_interface_spacing",
    "support_base_pattern_spacing",
}
_CLI_SENTINEL_ZERO_FILAMENT_KEYS = {
    "solid_infill_filament",
    "sparse_infill_filament",
    "wall_filament",
    "support_filament",
    "support_interface_filament",
}
_CLI_PARAM_ERROR_RE = re.compile(
    r"^([A-Za-z0-9_]+):\s+[-0-9.]+ not in range",
    re.MULTILINE,
)


def _cli_scalar_is(value, *, target: float) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)) and float(value) == target:
        return True
    if isinstance(value, str):
        try:
            return float(value.strip()) == target
        except ValueError:
            return False
    return False


def _cli_value_is_sentinel(key: str, value, extra_keys: set[str] | None = None) -> bool:
    extra = extra_keys or set()
    if isinstance(value, list):
        return bool(value) and all(_cli_value_is_sentinel(key, item, extra) for item in value)
    if (key in _CLI_SENTINEL_MINUS_ONE_KEYS or key in extra) and _cli_scalar_is(value, target=-1.0):
        return True
    if (key in _CLI_SENTINEL_ZERO_FILAMENT_KEYS or key in extra) and _cli_scalar_is(value, target=0.0):
        return True
    return False


def parse_3mf_cli_param_keys(detail: str) -> set[str]:
    return {match.group(1) for match in _CLI_PARAM_ERROR_RE.finditer(detail or "")}


def sanitize_3mf_cli_sentinels(data: bytes, extra_keys: set[str] | None = None) -> bytes:
    """Strip Bambu inherit-sentinels so Orca CLI can slice MakerWorld/Save Project 3MFs."""
    if not data or data[:2] != b"PK":
        return data
    extra = {str(k) for k in (extra_keys or set()) if str(k).strip()}
    try:
        source = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return data
    try:
        names = source.namelist()
        targets = [
            name for name in names
            if "project_settings.config" in name.replace("\\", "/").lower()
        ]
        if not targets:
            return data
        replacements: dict[str, bytes] = {}
        for name in targets:
            raw_settings = source.read(name)
            try:
                parsed = json.loads(raw_settings.decode("utf-8", "ignore"))
            except Exception:
                continue
            if not isinstance(parsed, dict):
                continue
            cleaned = {
                key: value
                for key, value in parsed.items()
                if not _cli_value_is_sentinel(str(key), value, extra)
            }
            if cleaned == parsed:
                continue
            replacements[name] = json.dumps(cleaned, indent=4).encode("utf-8")
        if not replacements:
            return data
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as dest:
            for info in source.infolist():
                if info.is_dir():
                    continue
                payload = replacements.get(info.filename)
                if payload is None:
                    payload = source.read(info.filename)
                dest.writestr(info.filename, payload)
        return out.getvalue()
    except Exception:
        return data
    finally:
        source.close()
