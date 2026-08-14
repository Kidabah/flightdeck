"""Extract estimated print time and filament grams from sliced vault files."""
from __future__ import annotations

import gzip
import io
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


def _parse_3mf_slice(data: bytes) -> dict:
    out = {"sliced": False, "seconds": None, "grams": None, "material": None, "plate_count": 0}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n.replace("\\", "/") for n in z.namelist()]
            slice_name = next((n for n in names if n.lower().endswith("metadata/slice_info.config") or n.lower() == "metadata/slice_info.config"), None)
            if not slice_name:
                slice_name = next((n for n in names if n.lower().endswith("slice_info.config")), None)
            if not slice_name:
                return out
            xml = z.read(slice_name).decode("utf-8", "ignore")
    except Exception:
        return out
    try:
        root = ET.fromstring(xml)
    except Exception:
        return out
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
    out["sliced"] = plates > 0 or seconds > 0 or grams > 0
    out["seconds"] = int(seconds) if seconds > 0 else None
    out["grams"] = round(grams, 2) if grams > 0 else None
    out["material"] = str(material).strip() if material else None
    out["plate_count"] = plates
    return out


_RE_TIME = re.compile(r"\bTIME\s*:\s*(\d+)", re.I)
_RE_PRUSA_TIME = re.compile(r"estimated printing time(?: \(normal mode\))?\s*=\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?", re.I)
_RE_WEIGHT = re.compile(
    r"(?:total filament used|filament used)\s*(?:\[[gG]\])?\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.I,
)
_RE_MATERIAL = re.compile(r"filament[_ -]?type\s*[:=]\s*([A-Za-z0-9+/* -]+)", re.I)


def _prusa_time_seconds(match: re.Match) -> int:
    days, hours, mins, secs = (int(g or 0) for g in match.groups())
    return days * 86400 + hours * 3600 + mins * 60 + secs


def _parse_gcode_slice(text: str) -> dict:
    head = "\n".join(text.splitlines()[:4000])
    tail = "\n".join(text.splitlines()[-400:])
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
    m_w = _RE_WEIGHT.search(blob)
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
    }


def hours_from_seconds(seconds: int | None) -> float | None:
    return _fmt_hours(seconds)
